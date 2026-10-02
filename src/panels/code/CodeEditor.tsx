/**
 * The code editor in the Code panel, built on CodeMirror 6 (MIT): syntax highlighting per
 * language, line numbers, search, undo, bracket matching. Colors come from the app's theme
 * tokens, so it follows light and dark mode.
 *
 * Editor ids (`data-pl-id`) can be hidden: they stay in the text, so edits keep elements tied to
 * the canvas, but they're drawn as nothing and the cursor steps over them.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

export type CodeLanguage = 'html' | 'css' | 'json';

/** Marks changes made by the Format button (they should reach the design like typing). */
const formatted = Annotation.define<boolean>();

/** Language support is loaded per language when a file needs it (HTML brings CSS and JavaScript). */
const LANGUAGES: Record<CodeLanguage, () => Promise<Extension>> = {
  html: () => import('@codemirror/lang-html').then((m) => m.html({ autoCloseTags: true })),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
};

/** Token colors as theme variables (defined in app.css for light and dark). */
const highlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--code-tag)' },
  { tag: tags.attributeName, color: 'var(--code-attribute)' },
  { tag: [tags.attributeValue, tags.string], color: 'var(--code-string)' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--code-property)' },
  { tag: [tags.number, tags.unit, tags.color, tags.atom, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: [tags.className, tags.labelName, tags.constant(tags.className)], color: 'var(--code-class)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword], color: 'var(--code-keyword)' },
  { tag: [tags.variableName, tags.special(tags.variableName)], color: 'var(--code-variable)' },
  { tag: [tags.comment, tags.processingInstruction, tags.documentMeta], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator, tags.brace, tags.squareBracket, tags.paren], color: 'var(--code-punctuation)' },
  { tag: tags.invalid, color: 'var(--ui-danger)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ui-text)', backgroundColor: 'transparent', fontSize: '11.5px' },
  '.cm-scroller': { fontFamily: 'var(--ui-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--ui-text)' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--ui-faint)', border: 'none', paddingLeft: '8px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'rgb(var(--ink) / 0.035)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ui-secondary)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ui-text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--ui-accent-soft) !important' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'rgb(var(--ink) / 0.1)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--ui-warn) 30%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--ui-warn) 55%, transparent)' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--ui-faint)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--ui-hover)', border: 'none', color: 'var(--ui-muted)' },
  '.cm-tooltip': { backgroundColor: 'var(--ui-popover)', border: 'none', borderRadius: '8px', boxShadow: 'var(--ui-popover-shadow)', color: 'var(--ui-text)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--ui-accent)', color: '#fff' },
  '.cm-panels': { backgroundColor: 'var(--ui-panel)', color: 'var(--ui-text)', borderColor: 'var(--ui-line)' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'inherit', fontSize: '12px' },
  '.cm-textfield': { backgroundColor: 'var(--ui-control)', border: 'none', borderRadius: '5px', color: 'var(--ui-text)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--ui-control)', border: 'none', borderRadius: '5px', color: 'var(--ui-text)' },
});

/** ` data-pl-id="…"` drawn as nothing; atomic so the cursor never lands inside one. */
const idMatcher = new MatchDecorator({ regexp: /\s+data-pl-id="[^"]*"/g, decoration: Decoration.replace({}) });
const hideIds = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = idMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = idMatcher.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

export interface CodeEditorHandle {
  /** The current text (may differ from `value` while typing). */
  text(): string;
  /** Replace all text, as one undoable editor change. */
  replace(text: string): void;
}

interface Props {
  readonly value: string;
  readonly language: CodeLanguage;
  readonly hideIds?: boolean;
  readonly readOnly?: boolean;
  /** Text typed by the person (not the `value` syncs). */
  onEdit(text: string): void;
  /** Focus left the editor (a good moment to show the canonical file again). */
  onBlur?(): void;
  handle?: (handle: CodeEditorHandle | null) => void;
}

export function CodeEditor({ value, language, hideIds: hidden = false, readOnly = false, onEdit, onBlur, handle }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onEdit, onBlur });
  callbacks.current = { onEdit, onBlur };
  const languageSlot = useRef(new Compartment());
  const idSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  /** When the person last typed here; syncs from `value` wait while they're mid-thought. */
  const typedAt = useRef(0);

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          theme,
          syntaxHighlighting(highlight),
          languageSlot.current.of([]),
          idSlot.current.of(hidden ? hideIds : []),
          readOnlySlot.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            // Only the person's own typing goes back to the design; syncs from `value` don't.
            const byPerson = update.transactions.some((t) => ['input', 'delete', 'move', 'undo', 'redo'].some((e) => t.isUserEvent(e)) || t.annotation(formatted));
            if (update.docChanged && byPerson) {
              typedAt.current = Date.now();
              callbacks.current.onEdit(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            blur: () => {
              typedAt.current = 0;
              callbacks.current.onBlur?.();
              sync.current();
            },
          }),
        ],
      }),
    });
    view.current = editor;
    handle?.({
      text: () => editor.state.doc.toString(),
      replace: (text) => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, annotations: formatted.of(true) }),
    });
    return () => {
      handle?.(null);
      editor.destroy();
      view.current = null;
    };
    // Created once; the props below are applied through compartments and syncs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let current = true;
    void LANGUAGES[language]().then((extension) => {
      if (current) view.current?.dispatch({ effects: languageSlot.current.reconfigure(extension) });
    });
    // A newer language (or unmount) wins over a load still in flight.
    return () => {
      current = false;
    };
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: idSlot.current.reconfigure(hidden ? hideIds : []) });
  }, [hidden]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlySlot.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  // The design changed elsewhere (canvas, inspector, an agent): show it, keeping the cursor —
  // unless the person is typing here, in which case their text wins until they pause or leave.
  const latest = useRef(value);
  latest.current = value;
  const sync = useRef(() => {});
  sync.current = () => {
    const editor = view.current;
    if (!editor) return;
    const next = latest.current;
    const current = editor.state.doc.toString();
    if (current === next) return;
    const idle = Date.now() - typedAt.current;
    if (editor.hasFocus && idle < 1500) {
      clearTimeout(retry.current);
      retry.current = setTimeout(() => sync.current(), 1500 - idle);
      return;
    }
    const change = diff(current, next);
    const head = editor.state.selection.main.head;
    // Keep the cursor where it was relative to the text around it.
    const mapped = head <= change.from ? head : head >= change.to ? head + change.insert.length - (change.to - change.from) : change.from + change.insert.length;
    editor.dispatch({ changes: change, selection: { anchor: Math.max(0, Math.min(mapped, next.length)) }, scrollIntoView: false });
  };
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => sync.current(), [value]);
  useEffect(() => () => clearTimeout(retry.current), []);

  return <div ref={host} className="code-editor" />;
}

/** The smallest single replacement turning `a` into `b`, so unchanged text keeps its place. */
function diff(a: string, b: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}
