/**
 * Inline text editing: the real element becomes contenteditable (plaintext) while the store's
 * `editingTextId` is set. The document only changes once, on commit.
 */
import { useEffect } from 'react';
import { setText } from '../document/ops';
import { useEditor } from '../editor/store';
import { domElement, requestRerender } from './dom';

let finishActive: ((commit: boolean) => void) | null = null;

/** Commit (or cancel) the current inline edit, if any. */
export function finishTextEditing(commit = true): void {
  finishActive?.(commit);
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
    store.setEditingText(null);
    if (commit && text !== original) store.apply('Edit text', (d) => setText(d, id, text));
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
    () =>
      useEditor.subscribe((state, prev) => {
        if (state.editingTextId === prev.editingTextId) return;
        if (prev.editingTextId) finishTextEditing(true);
        if (state.editingTextId) begin(state.editingTextId);
      }),
    [],
  );
}
