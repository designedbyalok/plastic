/**
 * Keep a page's content in view when it opens: each page remembers where you were looking (for
 * this session), and when a page opens onto empty canvas (a saved position from another page, or
 * content that moved), the view fits its artboards instead.
 */
import { useEffect, useRef } from 'react';
import { zoomToFit } from '../editor/commands.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import type { Viewport } from './coords.ts';
import { getViewportElement, hostOf } from './dom.ts';

/** Artboards lay out after their frames load; wait this long at most before deciding. */
const SETTLE_FRAMES = 90;

/** Does any artboard of the active page overlap the visible canvas? (null: none laid out yet) */
export function contentVisible(): boolean | null {
  const state = useEditor.getState();
  const canvas = getViewportElement();
  const roots = activeRoots(state);
  if (!canvas || !roots.length) return true;
  const { x, y, zoom } = state.viewport;
  let measured = false;
  for (const id of roots) {
    const host = hostOf(id);
    const width = parseFloat(host?.style.width ?? '');
    const height = parseFloat(host?.style.height ?? '');
    if (!width || !height) continue;
    measured = true;
    const frame = state.doc.frames[id] ?? { x: 0, y: 0 };
    const left = x + frame.x * zoom;
    const top = y + frame.y * zoom;
    if (left < canvas.clientWidth && left + width * zoom > 0 && top < canvas.clientHeight && top + height * zoom > 0) return true;
  }
  return measured ? false : null;
}

export function useContentInView(): void {
  const page = useEditor((s) => s.activePage);
  const opened = useRef(false);

  useEffect(() => {
    // A link to a frame or comment brings that into view itself when the file opens.
    const first = !opened.current;
    opened.current = true;
    const url = new URL(location.href);
    if (first && (url.searchParams.has('frame') || url.searchParams.has('comment'))) return;
    let frames = 0;
    let raf = 0;
    const check = () => {
      const visible = contentVisible();
      if (visible === false) zoomToFit();
      else if (visible === null && ++frames < SETTLE_FRAMES) raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [page]);

  // Each page keeps its own view while you move between pages.
  useEffect(() => {
    const views = new Map<string, Viewport>();
    return useEditor.subscribe((state, previous) => {
      if (state.activePage === previous.activePage) return;
      views.set(previous.activePage, previous.viewport);
      const saved = views.get(state.activePage);
      if (saved) state.setViewport(saved);
    });
  }, []);
}
