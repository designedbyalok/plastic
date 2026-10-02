/**
 * The spatial editing environment: a viewport containing a transformed "world" layer of
 * artboards (real DOM) and a screen-space overlay. Pointer input is routed to gestures.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { canEditText } from '../editor/commands.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import { ArtboardHost } from './ArtboardHost.tsx';
import { zoomAround } from './coords.ts';
import { nodeIdAt, setViewportElement, toScreen } from './dom.ts';
import { insertAt, startFrameDraw, startPan, startSelectGesture } from './gestures.ts';
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
  useTextEditing();

  useEffect(() => {
    const el = ref.current!;
    setViewportElement(el);
    // Wheel pans; pinch (ctrl+wheel on trackpads) or cmd/ctrl+wheel zooms around the pointer.
    const onWheel = (e: WheelEvent) => {
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
    };
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const native = e.nativeEvent;
    const store = useEditor.getState();
    // The editing artboard receives its own pointer events, so anything reaching here is outside it.
    if (store.editingTextId) finishTextEditing(true);
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) active.blur?.();
    if (e.button === 1 || (e.button === 0 && (store.spacePressed || store.tool.kind === 'hand'))) {
      e.preventDefault();
      startPan(native);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
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
    if (store.tool.kind === 'pen' && !e.buttons) {
      // The preview follows the snapped position, with guides, like where a click would land.
      const at = penPoint(e.clientX, e.clientY, true);
      useGesture.getState().set({ pen: { ...toScreen(at.x, at.y), shift: e.shiftKey } });
    }
    if (e.buttons) return;
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

  return (
    <div
      ref={ref}
      className={`canvas tool-${tool.kind}${spacePressed || tool.kind === 'hand' ? ' is-panning' : ''}`}
      style={canvasColor ? { background: canvasColor } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
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
      {pageEmpty && (
        <div className="canvas-empty">
          <p>
            Paste a design here, or press <kbd>F</kbd> and drag to draw a frame.
          </p>
        </div>
      )}
    </div>
  );
}
