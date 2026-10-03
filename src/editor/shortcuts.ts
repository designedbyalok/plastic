import { useEffect } from 'react';
import { INSERTABLES } from '../elements/insertables.ts';
import {
  addFlexOrWrap, cycleArtboard, deleteSelection, toggleUi, toggleClipContent, duplicateSelection, enterSelection, nudgeSelection, selectParent,
  zoomBy, zoomTo, zoomToFit, zoomToSelection,
} from './commands.ts';
import { navigate } from '../app/router.ts';
import { saveNow } from './persistence.ts';
import { useEditor } from './store.ts';
import { exitVectorEdit, readPath, screenDeltaToUser, writePath } from '../vector/edit.ts';
import { deleteAnchors, moveRefs } from '../vector/path.ts';
import { runOutlineStroke, runPathOp } from '../vector/pathOps.ts';
import { setSnapPref, snapPrefs } from '../canvas/snap.ts';
import { notify } from '../canvas/gestureStore.ts';
import { copyFrameLink } from './frameLinks.ts';
import { handleCanvasCopy, handleCanvasPaste, pasteFromSystemClipboard, setNextPasteMode } from './clipboard.ts';
import { copyStyles, frameSelection, pasteStyles, reorderSelection, toggleHidden, toggleLocked, ungroupSelection } from './layerActions.ts';

/** Keys in vector edit mode. Returns whether the key was handled. */
function handleVectorKey(e: KeyboardEvent, key: string, mod: boolean): boolean {
  const store = useEditor.getState();
  const edit = store.vectorEdit!;
  if (mod && key === 'a') {
    const path = readPath(store.doc, edit.id);
    store.setVectorEdit({ ...edit, points: path.flatMap((s, sub) => s.anchors.map((_, index) => ({ sub, index, part: 'anchor' as const }))) });
    return true;
  }
  if (mod) return false;
  switch (key) {
    case 'escape':
    case 'enter':
      // First finish the path being drawn, then leave edit mode.
      if (edit.drawing) store.setVectorEdit({ ...edit, drawing: null });
      else exitVectorEdit();
      return true;
    case 'backspace':
    case 'delete': {
      if (!edit.points.length) return true;
      store.apply('Delete points', (d) => writePath(d, edit.id, deleteAnchors(readPath(d, edit.id), edit.points)));
      store.setVectorEdit({ ...edit, points: [], drawing: null });
      if (!readPath(useEditor.getState().doc, edit.id).length) exitVectorEdit();
      return true;
    }
    case 'arrowleft':
    case 'arrowright':
    case 'arrowup':
    case 'arrowdown': {
      const step = (e.shiftKey ? 10 : 1) * store.viewport.zoom;
      const screen = { x: key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, y: key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0 };
      const delta = screenDeltaToUser(edit.id, screen);
      const anchors = edit.points.filter((p) => p.part === 'anchor');
      if (delta && anchors.length) store.apply('Nudge points', (d) => writePath(d, edit.id, moveRefs(readPath(d, edit.id), anchors, delta)), { coalesce: 'nudge-points' });
      return true;
    }
    case 'p':
      store.setTool({ kind: 'pen' });
      return true;
    case 'v':
      store.setTool({ kind: 'select' });
      store.setVectorEdit({ ...edit, drawing: null });
      return true;
    default:
      // Other tools don't apply while editing points.
      return !e.shiftKey && /^[a-z]$/.test(key);
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const target = e.composedPath()[0] as HTMLElement | undefined;
  if (!target || target.nodeType !== 1) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !!target.closest('[role="combobox"], [role="listbox"], [data-plastic-select], [data-plastic-menu]');
}

export function useShortcuts(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
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

      if (mod && !e.shiftKey && !e.altKey && key === 'l') {
        e.preventDefault();
        void copyFrameLink(store.selection.at(-1));
        return;
      }

      if (!mod && !e.altKey && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        store.setRulersVisible(!store.rulersVisible);
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        store.setSpacePressed(true);
        return;
      }
      if (store.vectorEdit && handleVectorKey(e, key, mod)) {
        e.preventDefault();
        return;
      }
      // Path operations (Figma's keys). Alt changes e.key on macOS, so these use e.code.
      if (e.altKey && e.shiftKey && !mod) {
        const op = ({ KeyU: 'union', KeyS: 'subtract', KeyI: 'intersect', KeyX: 'exclude' } as const)[e.code as 'KeyU'];
        if (op) {
          e.preventDefault();
          void runPathOp(op);
          return;
        }
      }
      if (mod && e.altKey && e.code === 'KeyO') {
        e.preventDefault();
        void runOutlineStroke();
        return;
      }
      if (mod && e.shiftKey && e.code === 'Quote') {
        e.preventDefault();
        setSnapPref('pixel', !snapPrefs().pixel);
        notify(snapPrefs().pixel ? 'Snap to pixel grid on' : 'Snap to pixel grid off');
        return;
      }
      if (mod && !e.shiftKey && key === 'e') {
        e.preventDefault();
        void runPathOp('flatten');
        return;
      }
      // Layer actions (the canvas menu's keys). Codes, not keys: Alt and Shift change e.key.
      if (mod && e.shiftKey && !e.altKey && e.code === 'KeyV') {
        // The browser's paste event still fires and carries the clipboard; this marks it "on top".
        setNextPasteMode('over');
        return;
      }
      const layerAction = (() => {
        if (mod && e.altKey && !e.shiftKey) return ({ KeyC: copyStyles, KeyV: pasteStyles } as Record<string, () => void>)[e.code];
        if (mod && e.shiftKey && !e.altKey) {
          return ({
            KeyR: () => void pasteFromSystemClipboard('replace'),
            KeyG: ungroupSelection,
            KeyH: toggleHidden,
            KeyL: toggleLocked,
          } as Record<string, () => void>)[e.code];
        }
        if (e.altKey || e.shiftKey) return e.shiftKey && !mod && e.code === 'KeyF' ? frameSelection : undefined;
        if (e.code === 'BracketRight') return () => reorderSelection(mod ? 'forward' : 'front');
        if (e.code === 'BracketLeft') return () => reorderSelection(mod ? 'backward' : 'back');
        return undefined;
      })();
      if (layerAction) {
        e.preventDefault();
        layerAction();
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
        if (key === 'l') {
          store.setTool({ kind: 'shape', shape: 'line' });
          e.preventDefault();
          return;
        }
        if (key === 'a') addFlexOrWrap();
        else if (key === 'n') cycleArtboard(-1);
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
        case 'p':
          store.setTool({ kind: 'pen' });
          break;
        case 'r':
          store.setTool({ kind: 'shape', shape: 'rectangle' });
          break;
        case 'o':
          store.setTool({ kind: 'shape', shape: 'ellipse' });
          break;
        case 'n':
          cycleArtboard(1);
          break;
        case '.':
          toggleUi();
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
    const onPaste = (e: ClipboardEvent) => handleCanvasPaste(e);
    const onCopy = (e: ClipboardEvent) => handleCanvasCopy(e);
    const onCut = (e: ClipboardEvent) => handleCanvasCopy(e, true);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);
}
