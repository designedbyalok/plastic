import { AiReadingOverlay } from './AiReadingOverlay.tsx';
/**
 * The spatial editing environment: a viewport containing a transformed "world" layer of
 * artboards (real DOM) and a screen-space overlay. Pointer input is routed to gestures.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { selectableTarget } from '../editor/layerActions.ts';
import { CanvasMenu, type CanvasMenuAt } from './CanvasMenu.tsx';
import { useContentInView } from './useContentInView.ts';
import { CommentLayer, anchorAt } from '../comments/CommentLayer.tsx';
import { useComments } from '../comments/store.ts';
import { canEditText } from '../editor/commands.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import { ArtboardHost } from './ArtboardHost.tsx';
import { screenToWorld, zoomAround } from './coords.ts';
import { PresenceOverlay } from './PresenceOverlay.tsx';
import { moveCursor } from '../editor/presence.ts';
import { nodeIdAt, setHitFilter, setViewportElement, toScreen } from './dom.ts';
import { insertAt, startFrameDraw, startPan, startSelectGesture } from './gestures.ts';
import { Rulers } from './Rulers.tsx';
import { Overlay } from './Overlay.tsx';
import { finishTextEditing, useTextEditing } from './textEditing.ts';
import { useGesture } from './gestureStore.ts';
import { enterVectorEdit, exitVectorEdit, vectorRootOf, vectorTargetFor } from '../vector/edit.ts';
import { penDown, penPoint, startPointMarquee } from '../vector/gestures.ts';
import { startShapeDraw } from '../vector/shapes.ts';

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const roots = useEditor(activeRoots);
  const canvasColor = useEditor((s) => s.doc.pages.find((p) => p.file === s.activePage)?.canvas);
  const pageEmpty = roots.length === 0;
  const viewport = useEditor((s) => s.viewport);
  const tool = useEditor((s) => s.tool);
  const spacePressed = useEditor((s) => s.spacePressed);
  const readOnly = useEditor((s) => s.readOnly);
  const owner = useEditor((s) => s.storageLocation);
  const [menuAt, setMenuAt] = useState<CanvasMenuAt>(null);
  const uiHidden = useEditor((s) => s.uiHidden);
  useTextEditing();
  useContentInView();

  useEffect(() => {
    const el = ref.current!;
    setViewportElement(el);
    // Locked layers can't be picked on the canvas: clicks go to the layer that contains them.
    setHitFilter((id) => selectableTarget(useEditor.getState().doc, id));
    // Wheel pans; pinch (ctrl+wheel on trackpads) or cmd/ctrl+wheel zooms around the pointer.
    const onWheel = (e: WheelEvent) => {
      // A comment thread scrolls itself.
      if ((e.target as Element | null)?.closest?.('.comment-card')) return;
      finishTextEditing(true);
      e.preventDefault();
      const store = useEditor.getState();
      const v = store.viewport;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
        store.setViewport(zoomAround(v, toScreen(e.clientX, e.clientY), v.zoom * factor));
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        store.setViewport({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // Keep the design still on screen when the canvas's left edge moves (side panel shown,
    // hidden or resized): shift the pan offset by the same amount.
    let left = el.getBoundingClientRect().left;
    const resize = new ResizeObserver(() => {
      const next = el.getBoundingClientRect().left;
      if (next === left) return;
      const store = useEditor.getState();
      store.setViewport({ ...store.viewport, x: store.viewport.x + (left - next) });
      left = next;
    });
    resize.observe(el);
    return () => {
      resize.disconnect();
      el.removeEventListener('wheel', onWheel);
      setViewportElement(null);
      setHitFilter(null);
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const native = e.nativeEvent;
    const store = useEditor.getState();
    // The editing artboard receives its own pointer events, so anything reaching here is outside it.
    finishTextEditing(true);
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) active.blur?.();
    if (e.button === 1 || (e.button === 0 && (store.spacePressed || store.tool.kind === 'hand'))) {
      e.preventDefault();
      startPan(native);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (store.tool.kind === 'comment') {
      // A click closes an open thread (or an unsent comment); the next one leaves a comment.
      const comments = useComments.getState();
      if (comments.openId || comments.draft) comments.set({ openId: null, draft: null });
      else comments.set({ draft: { ...anchorAt(native.clientX, native.clientY), page: store.activePage } });
      return;
    }
    if (store.tool.kind === 'pen') return penDown(native);
    if (store.tool.kind === 'shape') {
      if (store.vectorEdit) exitVectorEdit();
      return startShapeDraw(native, store.tool.shape);
    }
    if (store.vectorEdit && store.tool.kind === 'select') {
      // In vector edit mode, empty space box-selects points; a click on another element leaves.
      const edited = vectorRootOf(store.doc, store.vectorEdit.id);
      startPointMarquee(native, () => {
        const hit = nodeIdAt(native.clientX, native.clientY);
        if (hit && vectorRootOf(store.doc, hit) !== edited) {
          exitVectorEdit();
          useEditor.getState().select([vectorRootOf(useEditor.getState().doc, hit) ?? hit]);
        } else {
          const edit = useEditor.getState().vectorEdit;
          if (edit) useEditor.getState().setVectorEdit({ ...edit, points: [] });
        }
      });
      return;
    }
    if (store.vectorEdit) exitVectorEdit();
    if (store.tool.kind === 'frame') startFrameDraw(native);
    else if (store.tool.kind === 'insert') insertAt(native, store.tool.itemId);
    else startSelectGesture(native);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const store = useEditor.getState();
    moveCursor({ ...screenToWorld(toScreen(e.clientX, e.clientY), store.viewport), page: store.activePage });
    if (store.tool.kind === 'pen' && !e.buttons) {
      // The preview follows the snapped position, with guides, like where a click would land.
      const at = penPoint(e.clientX, e.clientY, true);
      useGesture.getState().set({ pen: { ...toScreen(at.x, at.y), shift: e.shiftKey } });
    }
    if (e.buttons) return;
    if (store.tool.kind === 'comment') return store.setHover(null);
    const hit = nodeIdAt(e.clientX, e.clientY);
    // Shapes inside an svg hover (and select) as the whole vector, like Figma's groups.
    store.setHover(store.vectorEdit ? null : (vectorRootOf(store.doc, hit) ?? hit));
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const store = useEditor.getState();
    if (store.tool.kind !== 'select') return;
    const hit = nodeIdAt(e.clientX, e.clientY);
    if (store.vectorEdit) {
      if (!hit || vectorRootOf(store.doc, hit) !== vectorRootOf(store.doc, store.vectorEdit.id)) exitVectorEdit();
      return;
    }
    const vector = hit ? vectorTargetFor(store.doc, hit) : null;
    if (vector) {
      enterVectorEdit(vector);
      return;
    }
    if (hit && canEditText(store.doc, hit)) {
      store.select([hit]);
      store.setEditingText(hit);
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const store = useEditor.getState();
    if (store.vectorEdit || store.editingTextId) return;
    if (store.tool.kind !== 'select') store.setTool({ kind: 'select' });
    // Right-click acts on what's under the pointer: it joins nothing, it replaces the selection.
    const deepest = nodeIdAt(e.clientX, e.clientY);
    const hit = vectorRootOf(store.doc, deepest) ?? deepest;
    if (!hit) store.select([]);
    else if (!store.selection.includes(hit)) store.select([hit]);
    setMenuAt({ x: e.clientX, y: e.clientY, target: hit ? 'layers' : 'canvas' });
  };

  // The menu sits outside the canvas: React events from its portal would otherwise bubble into
  // the canvas's pointer handlers and select whatever is under the clicked item.
  return (
    <>
    <div
      ref={ref}
      onContextMenu={onContextMenu}
      className={`canvas tool-${tool.kind}${tool.kind === 'insert' && ['text', 'heading'].includes(tool.itemId) ? ' tool-text' : ''}${spacePressed || tool.kind === 'hand' ? ' is-panning' : ''}`}
      style={canvasColor ? { background: canvasColor } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        moveCursor(null);
        useEditor.getState().setHover(null);
        useGesture.getState().set({ pen: null, guides: [] });
      }}
      onDoubleClick={onDoubleClick}
    >
      <div className="world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        {roots.map((id) => (
          <ArtboardHost key={id} id={id} />
        ))}
      </div>
      <Overlay />
      {!uiHidden && <CommentLayer />}
      <AiReadingOverlay />
      <PresenceOverlay />
      {readOnly && (
        <div className="canvas-view-only" role="status">
          <strong>View only</strong>
          <span>{owner}. Press <kbd>/</kbd> to chat.</span>
        </div>
      )}
      <Rulers />
      {pageEmpty && !readOnly && (
        <div className="canvas-empty">
          <p>
            Paste a design here, or press <kbd>F</kbd> and drag to draw a frame.
          </p>
        </div>
      )}
    </div>
    <CanvasMenu at={menuAt} onClose={() => setMenuAt(null)} />
    </>
  );
}
