/**
 * Invisible drag handle on the left panel's edge. While dragging, the width is written straight
 * to the panel element once per frame (no React re-render of the layer tree), then saved to the
 * store on release. Double-click resets the width.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PANEL_WIDTH, clampPanelWidth, useEditor } from '../editor/store';

export function PanelResizer() {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const panel = handle.parentElement as HTMLElement;
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    let width = startWidth;
    let frame = 0;
    handle.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('is-resizing-panel');

    const onMove = (ev: PointerEvent) => {
      width = clampPanelWidth(startWidth + ev.clientX - startX);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        panel.style.width = `${width}px`;
      });
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.documentElement.classList.remove('is-resizing-panel');
      panel.style.width = `${width}px`;
      useEditor.getState().setLayersWidth(width);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={PANEL_WIDTH.max}
      tabIndex={-1}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useEditor.getState().setLayersWidth(PANEL_WIDTH.default)}
    />
  );
}
