/** Screen-space rulers and persistent alignment guides. The canvas camera stays unchanged. */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../editor/store.ts';
import { createId } from '../document/ids.ts';
import { rootOf } from '../document/tree.ts';
import { removeRulerGuide, setRulerGuide } from '../document/guides.ts';
import type { RulerGuide } from '../document/types.ts';
import { getViewportElement, screenRectOf, toScreen } from './dom.ts';
import { screenToWorld, unionRects, type Rect } from './coords.ts';
import { startPan, trackPointer, transactional } from './gestures.ts';
import { guideScreenPosition, rulerTicks } from './rulerGeometry.ts';

const SIZE = 20;
const EMPTY: readonly RulerGuide[] = [];
type Measurement = { width: number; height: number; selected: Rect | null; frames: Record<string, Rect>; pointer: { x: number; y: number } | null };
export function Rulers() {
  const visible = useEditor((s) => s.rulersVisible);
  return visible ? <VisibleRulers /> : null;
}

function VisibleRulers() {
  const viewport = useEditor((s) => s.viewport);
  const doc = useEditor((s) => s.doc);
  const page = useEditor((s) => s.activePage);
  const selection = useEditor((s) => s.selection);
  const guides = doc.pages.find((p) => p.file === page)?.guides ?? EMPTY;
  const origin = selection.length ? doc.frames[rootOf(doc, selection.at(-1)!)] : null;
  const [active, setActive] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ guide: RulerGuide; x: number; y: number } | null>(null);
  const [m, setMeasured] = useState<Measurement>({ width: 0, height: 0, selected: null, frames: {}, pointer: null });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0, previous = '';
    const move = (e: PointerEvent) => {
      const el = getViewportElement();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      pointer.current = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
        ? toScreen(e.clientX, e.clientY) : null;
    };
    const deselect = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.guide-menu')) setMenu(null);
      if (!(e.target as Element).closest('.canvas-guide, .canvas-ruler, .guide-menu')) {
        setActive(null);
        const focused = document.activeElement as HTMLElement | null;
        if (focused?.classList.contains('canvas-guide')) focused.blur();
      }
    };
    const measure = () => {
      const el = getViewportElement(), state = useEditor.getState();
      if (el) {
        const frames: Record<string, Rect> = {};
        for (const guide of state.doc.pages.find((p) => p.file === state.activePage)?.guides ?? []) {
          const rect = guide.frame ? screenRectOf(guide.frame) : null;
          if (guide.frame && rect) frames[guide.frame] = rect;
        }
        const selected = state.selection.map((id) => screenRectOf(id)).filter((rect): rect is Rect => !!rect);
        const next = { width: el.clientWidth, height: el.clientHeight, frames, selected: selected.length ? unionRects(selected) : null, pointer: pointer.current };
        const key = JSON.stringify(next);
        if (key !== previous) { previous = key; setMeasured(next); }
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', deselect, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerdown', deselect, true); };
  }, []);

  const focusGuide = (id: string) => requestAnimationFrame(() => surface.current?.querySelector<HTMLElement>(`[data-guide-id="${id}"]`)?.focus());
  const drag = (e: ReactPointerEvent, axis: 'x' | 'y', original?: RulerGuide) => {
    e.stopPropagation(); e.preventDefault();
    const state = useEditor.getState();
    setMenu(null);
    if (e.button === 1 || state.spacePressed || state.tool.kind === 'hand') { startPan(e.nativeEvent); return; }
    if (e.button !== 0 || state.tx || state.editingTextId) return;
    const duplicate = !!original && e.altKey;
    const id = original && !duplicate ? original.id : createId();
    const tx = transactional();
    setActive(id);
    let latest: RulerGuide | null = null;
    const update = (event: PointerEvent) => {
      const camera = useEditor.getState().viewport;
      const point = toScreen(event.clientX, event.clientY);
      const world = screenToWorld(point, camera);
      const roots = state.doc.pages.find((p) => p.file === page)?.roots ?? [];
      const frame = [...roots].reverse().find((key) => {
        const rect = screenRectOf(key);
        return rect && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
      });
      const rect = frame ? screenRectOf(frame) : null;
      let value = rect ? (point[axis] - rect[axis]) / camera.zoom : world[axis];
      // Shift snaps to a ruler tick; ordinary guide coordinates use whole design pixels.
      if (event.shiftKey) {
        const ticks = rulerTicks(axis === 'x' ? m.width : m.height, camera[axis], camera.zoom);
        const step = ticks.length > 1 ? ticks[1]!.value - ticks[0]!.value : 1;
        value = Math.round(value / step) * step;
      } else value = Math.round(value);
      latest = { id, axis, value, ...(frame ? { frame } : {}) };
      tx.preview((base) => setRulerGuide(base, page, latest!));
      return point;
    };
    trackPointer(e.nativeEvent, {
      move: (event) => { update(event); },
      end: (event, moved) => {
        if (event.type === 'pointercancel') { tx.cancel(); setActive(null); return; }
        if (!moved) { if (original) focusGuide(original.id); return; }
        const point = update(event);
        const el = getViewportElement();
        const outside = point.x < SIZE || point.y < SIZE || point.x > (el?.clientWidth ?? 0) || point.y > (el?.clientHeight ?? 0);
        if (outside) {
          tx.cancel();
          if (original && !duplicate) state.apply('Remove Guide', (base) => removeRulerGuide(base, page, original.id));
          setActive(null);
        } else {
          tx.commit(original && !duplicate ? 'Move Guide' : 'Add Guide');
          focusGuide(id);
        }
      },
      cancel: () => { tx.cancel(); setActive(original?.id ?? null); },
    });
  };
  const remove = (guide: RulerGuide) => { useEditor.getState().apply('Remove Guide', (base) => removeRulerGuide(base, page, guide.id)); setActive(null); };
  const ruler = (axis: 'x' | 'y') => {
    const horizontal = axis === 'x', length = horizontal ? m.width : m.height;
    const ticks = rulerTicks(length, viewport[axis], viewport.zoom, origin?.[axis] ?? 0);
    const selected = m.selected;
    const at = m.pointer?.[axis];
    return <svg className={`canvas-ruler ruler-${axis}`} width={horizontal ? length : SIZE} height={horizontal ? SIZE : length}
      role="button" tabIndex={0} aria-label={horizontal ? 'Horizontal Ruler' : 'Vertical Ruler'}
      aria-description="Drag onto the canvas to create a guide. Shift snaps to ruler ticks."
      onPointerDown={(e) => drag(e, horizontal ? 'y' : 'x')}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        const guide: RulerGuide = { id: createId(), axis: horizontal ? 'y' : 'x', value: Math.round(screenToWorld({ x: m.width / 2, y: m.height / 2 }, viewport)[horizontal ? 'y' : 'x']) };
        useEditor.getState().apply('Add Guide', (base) => setRulerGuide(base, page, guide)); setActive(guide.id); focusGuide(guide.id);
      }}>
      {selected && <rect className="ruler-selection" x={horizontal ? selected.x : 0} y={horizontal ? 0 : selected.y} width={horizontal ? selected.width : SIZE} height={horizontal ? SIZE : selected.height} />}
      {ticks.map((tick) => <g key={tick.value}>
        <line x1={horizontal ? tick.position : SIZE - (tick.major ? 7 : 4)} y1={horizontal ? SIZE - (tick.major ? 7 : 4) : tick.position} x2={horizontal ? tick.position : SIZE} y2={horizontal ? SIZE : tick.position} />
        {tick.major && <text x={horizontal ? tick.position + 3 : 0} y={horizontal ? 9 : 0} transform={horizontal ? undefined : `translate(9 ${tick.position - 3}) rotate(-90)`}>{tick.value}</text>}
      </g>)}
      {at !== undefined && <line className="ruler-pointer" x1={horizontal ? at : 0} y1={horizontal ? 0 : at} x2={horizontal ? at : SIZE} y2={horizontal ? SIZE : at} />}
    </svg>;
  };
  return <div className="canvas-rulers" ref={surface} onPointerMove={(e) => e.stopPropagation()}>
    {guides.map((guide) => {
      const rect = guide.frame ? m.frames[guide.frame] : null;
      if (guide.frame && !rect) return null;
      const position = rect ? rect[guide.axis] + guide.value * viewport.zoom : guideScreenPosition(guide, viewport);
      const vertical = guide.axis === 'x';
      if (position < SIZE || position > (vertical ? m.width : m.height)) return null;
      const start = Math.max(SIZE, rect ? (vertical ? rect.y : rect.x) : SIZE);
      const end = Math.min(vertical ? m.height : m.width, rect ? (vertical ? rect.y + rect.height : rect.x + rect.width) : (vertical ? m.height : m.width));
      if (end <= start) return null;
      return <button type="button" data-guide-id={guide.id} key={guide.id} className={`canvas-guide guide-${guide.axis}${active === guide.id ? ' is-active' : ''}${guide.frame ? ' is-frame-guide' : ''}`}
        style={vertical ? { left: position - 3, top: start, height: end - start } : { top: position - 3, left: start, width: end - start }}
        aria-label={`${vertical ? 'Vertical' : 'Horizontal'} Guide ${guide.value}${guide.frame ? ' in Frame' : ''}`}
        title={`${guide.value}px · Drag to move · Alt-drag to duplicate · Delete to remove`}
        onPointerDown={(e) => drag(e, guide.axis, guide)} onFocus={() => setActive(guide.id)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setActive(guide.id); e.currentTarget.focus(); const point = toScreen(e.clientX, e.clientY); setMenu({ guide, x: Math.min(point.x, m.width - 150), y: Math.min(point.y, m.height - 40) }); }}
        onDoubleClick={(e) => e.stopPropagation()}
        onCopy={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onCut={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onPaste={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && ['c', 'x', 'v', 'd'].includes(e.key.toLowerCase())) {
            e.preventDefault(); e.stopPropagation();
            if (e.key.toLowerCase() === 'd') {
              const copy = { ...guide, id: createId(), value: guide.value + 10 };
              useEditor.getState().apply('Duplicate Guide', (base) => setRulerGuide(base, page, copy)); setActive(copy.id); focusGuide(copy.id);
            }
          } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(guide); }
          else if (e.key.startsWith('Arrow')) {
            e.preventDefault(); e.stopPropagation();
            const delta = (vertical ? e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0 : e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0) * (e.shiftKey ? 10 : 1);
            if (delta) useEditor.getState().apply('Move Guide', (base) => setRulerGuide(base, page, { ...guide, value: guide.value + delta }), { coalesce: `guide:${guide.id}` });
          }
        }}><span className="guide-coordinate">{guide.value}</span></button>;
    })}
    {menu && <div className="guide-menu" role="menu" aria-label="Guide Actions" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); setMenu(null); focusGuide(menu.guide.id); } else if (e.key.startsWith('Arrow') || ((e.metaKey || e.ctrlKey) && ['c', 'x', 'v', 'd'].includes(e.key.toLowerCase()))) e.preventDefault(); }}>
      <button type="button" autoFocus role="menuitem" onClick={() => { remove(menu.guide); setMenu(null); }}>Remove Guide</button>
    </div>}
    {ruler('x')}{ruler('y')}
    <button type="button" className="ruler-corner" aria-label="Hide Rulers" title="Hide Rulers ⇧R" onPointerDown={(e) => e.stopPropagation()} onClick={() => useEditor.getState().setRulersVisible(false)} />
  </div>;
}
