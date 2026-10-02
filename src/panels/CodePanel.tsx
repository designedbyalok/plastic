/**
 * The files behind the design, editable. The page's HTML, styles.css, tokens.css and
 * project.json are shown exactly as they're saved, with syntax highlighting and line numbers
 * (CodeMirror). Typing applies to the design as you go (one undoable change per burst), and the
 * code follows the canvas when you edit there. Format tidies the code with Prettier.
 */
import { AlignLeft, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PROJECT_FILE, STYLES_FILE, TOKENS_FILE, parseProject, sameFiles, serializeProject } from '../serialization/index.ts';
import { editorMeta, useEditor } from '../editor/store.ts';
import { CodeEditor, type CodeEditorHandle, type CodeLanguage } from './code/CodeEditor.tsx';
import { formatCode } from './code/format.ts';

/** Tab "page" shows the page on the canvas; the others are shared files. */
type Tab = 'page' | typeof STYLES_FILE | typeof TOKENS_FILE | typeof PROJECT_FILE;

const APPLY_DELAY_MS = 300;
const ID_ATTRIBUTE = /\s+data-pl-id="[^"]*"/g;

function languageOf(tab: Tab): CodeLanguage {
  return tab === 'page' ? 'html' : tab === PROJECT_FILE ? 'json' : 'css';
}

/**
 * Apply one edited file to the design: the project is re-read from its files with this one
 * replaced, the same way an outside edit to the files on disk is loaded.
 */
function applyFile(name: string, text: string): string | null {
  const store = useEditor.getState();
  if (name === PROJECT_FILE) {
    try {
      JSON.parse(text);
    } catch (error) {
      return `project.json isn’t valid JSON yet: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const files = serializeProject(store.doc, editorMeta(store));
  if (files[name] === text) return null;
  try {
    const { doc } = parseProject({ ...files, [name]: text });
    const next = { ...doc, frames: { ...store.doc.frames, ...doc.frames } };
    // Formatting-only edits (spacing, indentation) don't change the design: no undo step.
    if (sameFiles(serializeProject(next, editorMeta(store)), files)) return null;
    store.apply('Edit code', (current) => ({ ...doc, frames: { ...current.frames, ...doc.frames } }), { coalesce: `code:${name}` });
    return null;
  } catch (error) {
    return `Couldn’t apply ${name}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function CodePanel() {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const [tab, setTab] = useState<Tab>('page');
  const [clean, setClean] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formatting, setFormatting] = useState(false);
  const editor = useRef<CodeEditorHandle | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const files = useMemo(() => serializeProject(doc, editorMeta(useEditor.getState())), [doc]);
  const page = doc.pages.find((p) => p.file === activePage) ?? doc.pages[0]!;
  const fileName = tab === 'page' ? page.file : tab;
  const text = files[fileName] ?? '';
  const language = languageOf(tab);

  // Switching files applies what was typed in the previous one first.
  const flush = useRef<() => void>(() => {});
  useEffect(() => {
    setError(null);
    return () => flush.current();
  }, [fileName]);
  useEffect(() => () => flush.current(), []);

  const onEdit = (next: string) => {
    clearTimeout(pending.current);
    const target = fileName;
    flush.current = () => {
      clearTimeout(pending.current);
      flush.current = () => {};
      setError(applyFile(target, next));
    };
    pending.current = setTimeout(() => flush.current(), APPLY_DELAY_MS);
  };

  const format = async () => {
    if (!editor.current || formatting) return;
    setFormatting(true);
    try {
      editor.current.replace(await formatCode(editor.current.text(), language));
      setError(null);
    } catch (e) {
      setError(`Couldn’t format: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    } finally {
      setFormatting(false);
    }
  };

  const copy = () => {
    const current = editor.current?.text() ?? text;
    void navigator.clipboard?.writeText(tab === 'page' && clean ? current.replace(ID_ATTRIBUTE, '') : current);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'page', label: page.file },
    { id: STYLES_FILE, label: STYLES_FILE },
    { id: TOKENS_FILE, label: TOKENS_FILE },
    { id: PROJECT_FILE, label: PROJECT_FILE },
  ];

  return (
    <section className="code-panel" aria-label="Code">
      <div className="code-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`code-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <span className="code-spacer" />
        {tab === 'page' && (
          <label className="code-option" title="Element ids link the code to the canvas. Hidden, they stay in the file and the cursor skips them.">
            <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} /> Hide editor ids
          </label>
        )}
        <button type="button" className="code-copy" onClick={() => void format()} disabled={formatting} title="Format with Prettier">
          <AlignLeft size={12} strokeWidth={1.75} />
          {formatting ? 'Formatting…' : 'Format'}
        </button>
        <button type="button" className="code-copy" onClick={copy} title={tab === 'page' && clean ? 'Copy without editor ids' : 'Copy'}>
          <Copy size={12} strokeWidth={1.75} />
          Copy
        </button>
      </div>
      <div className="code-body">
        <CodeEditor key={fileName} value={text} language={language} hideIds={tab === 'page' && clean} onEdit={onEdit} onBlur={() => flush.current()} handle={(h) => (editor.current = h)} />
      </div>
      {error && (
        <div className="code-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
