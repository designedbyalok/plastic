import { useEffect } from 'react';
import { INSERTABLES } from '../elements/insertables.ts';
import {
  addFlexOrWrap, deleteSelection, toggleClipContent, duplicateSelection, enterSelection, nudgeSelection, selectParent,
  zoomBy, zoomTo, zoomToFit, zoomToSelection,
} from './commands.ts';
import { navigate } from '../app/router.ts';
import { saveNow } from './persistence.ts';
import { useEditor } from './store.ts';

function isTyping(e: KeyboardEvent): boolean {
  const target = e.composedPath()[0] as HTMLElement | undefined;
  if (!target || target.nodeType !== 1) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const store = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (isTyping(e)) return;
      // A dialog owns the keyboard while open.
      if (store.agentsOpen) return;

      if (e.code === 'Space') {
        e.preventDefault();
        store.setSpacePressed(true);
        return;
      }
      if (mod) {
        if (key === 'z') store[e.shiftKey ? 'redo' : 'undo']();
        else if (key === 'y') store.redo();
        else if (key === 'd' && e.shiftKey) navigate('/');
        else if (key === 'd') duplicateSelection();
        else if (key === '=' || key === '+') zoomBy(1.25);
        else if (key === '-') zoomBy(0.8);
        else if (key === '0') zoomTo(1);
        else if (key === '\\') store.setLayersOpen(!store.layersOpen);
        else return;
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        if (key === 'a') addFlexOrWrap();
        else if (e.code === 'Digit0') zoomTo(1);
        else if (e.code === 'Digit1') zoomToFit();
        else if (e.code === 'Digit2') zoomToSelection();
        else if (!key.startsWith('arrow') && key !== 'enter') return;
      }
      if (e.altKey) {
        if (e.code === 'KeyC' && !e.shiftKey) {
          e.preventDefault();
          toggleClipContent();
        }
        return;
      }

      const step = e.shiftKey ? 10 : 1;
      switch (key) {
        case 'backspace':
        case 'delete':
          deleteSelection();
          break;
        case 'escape':
          if (store.tool.kind !== 'select') store.setTool({ kind: 'select' });
          else selectParent();
          break;
        case 'enter':
          if (e.shiftKey) selectParent();
          else enterSelection();
          break;
        case 'arrowleft':
          nudgeSelection(-step, 0);
          break;
        case 'arrowright':
          nudgeSelection(step, 0);
          break;
        case 'arrowup':
          nudgeSelection(0, -step);
          break;
        case 'arrowdown':
          nudgeSelection(0, step);
          break;
        case 'v':
          store.setTool({ kind: 'select' });
          break;
        case 'f':
          store.setTool({ kind: 'frame' });
          break;
        default: {
          if (e.shiftKey) return;
          const item = INSERTABLES.find((i) => i.shortcut === key);
          if (!item) return;
          store.setTool({ kind: 'insert', itemId: item.id });
        }
      }
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') useEditor.getState().setSpacePressed(false);
    };
    const onBlur = () => useEditor.getState().setSpacePressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
