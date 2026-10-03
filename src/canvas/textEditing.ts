/**
 * Inline text editing: the real element becomes contenteditable (plaintext) while the store's
 * `editingTextId` is set. The document only changes once, on commit.
 */
import { DEFAULT_TEXT_FONT } from '../elements/insertables.ts';
import { useEffect } from 'react';
import { setText } from '../document/ops.ts';
import { useEditor } from '../editor/store.ts';
import { domElement, getViewportElement, requestRerender } from './dom.ts';

let finishActive: ((commit: boolean) => void) | null = null;

/** Commit (or cancel) the current inline edit, if any. */
export function finishTextEditing(commit = true): void {
  finishActive?.(commit);
}

/** Empty text stays outside the document until the user has something to keep. */
export function beginTextInsertion(point: { x: number; y: number }, color: string, onCommit: (text: string) => void, typography: Readonly<Record<string, string>> = {}): void {
  finishTextEditing(true);
  const canvas = getViewportElement();
  if (!canvas) return;
  const draft = document.createElement('span');
  draft.className = 'canvas-text-draft';
  draft.tabIndex = 0;
  draft.setAttribute('contenteditable', 'plaintext-only');
  draft.setAttribute('role', 'textbox');
  draft.setAttribute('aria-label', 'New Text');
  draft.setAttribute('aria-multiline', 'true');
  const rect = canvas.getBoundingClientRect();
  Object.assign(draft.style, { left: `${point.x - rect.left}px`, top: `${point.y - rect.top}px`, color,
    fontFamily: DEFAULT_TEXT_FONT, transform: `scale(${useEditor.getState().viewport.zoom})` });
  for (const prop of ['font-size', 'font-weight', 'line-height', 'letter-spacing']) {
    if (typography[prop]) draft.style.setProperty(prop, typography[prop]!);
  }
  canvas.append(draft);
  let done = false;
  let unsubscribe = () => {};
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    const text = draft.innerText ?? draft.textContent ?? '';
    finishActive = null;
    unsubscribe(); draft.remove(); window.focus();
    if (commit && text.trim()) onCommit(text);
  };
  finishActive = finish;
  draft.addEventListener('pointerdown', event => event.stopPropagation());
  draft.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault(); finish(true);
    }
  });
  draft.addEventListener('blur', () => finish(true));
  unsubscribe = useEditor.subscribe((state, previous) => {
    if (state.tool !== previous.tool || state.activePage !== previous.activePage || state.viewport !== previous.viewport) {
      finish(state.activePage === previous.activePage);
      if (state.tool !== previous.tool) useEditor.getState().setTool(state.tool);
    }
  });
  draft.focus();
  const selection = draft.ownerDocument.getSelection();
  const range = draft.ownerDocument.createRange(); range.selectNodeContents(draft); range.collapse(false);
  selection?.removeAllRanges(); selection?.addRange(range);
}

function begin(id: string): void {
  const el = domElement(id);
  if (!el) {
    useEditor.getState().setEditingText(null);
    return;
  }
  const original = el.textContent ?? '';
  el.setAttribute('contenteditable', 'plaintext-only');
  el.focus();
  el.ownerDocument.getSelection()?.selectAllChildren(el);

  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    finishActive = null;
    const text = el.textContent ?? '';
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    el.removeAttribute('contenteditable');
    el.ownerDocument.getSelection()?.removeAllRanges();
    el.blur();
    // Keyboard focus was inside the artboard iframe; hand it back so shortcuts work again.
    window.focus();
    const store = useEditor.getState();
    // Commit the text while external updates are still queued; releasing editing first
    // would let synchronization replace the document before this text is recorded.
    if (commit && text !== original) store.apply('Edit text', (d) => setText(d, id, text));
    store.setEditingText(null);
    requestRerender();
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    }
  };
  const onBlur = () => finish(true);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
  finishActive = finish;
}

export function useTextEditing(): void {
  useEffect(
    () => {
      const unsubscribe = useEditor.subscribe((state, prev) => {
        if (state.editingTextId === prev.editingTextId) return;
        if (prev.editingTextId) finishTextEditing(true);
        if (state.editingTextId) begin(state.editingTextId);
      });
      return () => { finishTextEditing(true); unsubscribe(); };
    },
    [],
  );
}
