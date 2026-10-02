/**
 * The spatial editing environment: a viewport containing a transformed "world" layer of
 * artboards (real DOM) and a screen-space overlay. Pointer input is routed to gestures.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { canEditText } from '../editor/commands';
import { useEditor } from '../editor/store';
import { ArtboardHost } from './ArtboardHost';
import { zoomAround } from './coords';
import { nodeIdAt, setViewportElement, toScreen } from './dom';
import { insertAt, startFrameDraw, startPan, startSelectGesture } from './gestures';
import { Overlay } from './Overlay';
import { finishTextEditing, useTextEditing } from './textEditing';

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const roots = useEditor((s) => s.doc.roots);
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
    return () => {
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
    if (e.button === 1 || (e.button === 0 && store.spacePressed)) {
      e.preventDefault();
      startPan(native);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (store.tool.kind === 'frame') startFrameDraw(native);
    else if (store.tool.kind === 'insert') insertAt(native, store.tool.itemId);
    else startSelectGesture(native);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons) return;
    useEditor.getState().setHover(nodeIdAt(e.clientX, e.clientY));
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const store = useEditor.getState();
    if (store.tool.kind !== 'select') return;
    const hit = nodeIdAt(e.clientX, e.clientY);
    if (hit && canEditText(store.doc, hit)) {
      store.select([hit]);
      store.setEditingText(hit);
    }
  };

  const grid = 24 * viewport.zoom;
  return (
    <div
      ref={ref}
      className={`canvas tool-${tool.kind}${spacePressed ? ' is-panning' : ''}`}
      style={{
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => useEditor.getState().setHover(null)}
      onDoubleClick={onDoubleClick}
    >
      <div className="world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        {roots.map((id) => (
          <ArtboardHost key={id} id={id} />
        ))}
      </div>
      <Overlay />
    </div>
  );
}
