/**
 * Screen-space overlay: selection, hover, handles, artboard titles and gesture feedback.
 * It never transforms with the world, so outlines stay crisp and handles keep their size at
 * any zoom. Positions are measured from the live DOM every frame.
 */
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getParentId, isRoot } from '../document/tree.ts';
import type { NodeId } from '../document/types.ts';
import { layerName } from '../elements/registry.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import type { Rect } from './coords.ts';
import { domElement, hostOf, screenRectOf, styleOf, toScreenRect } from './dom.ts';
import { startFrameMove, startResize, type Handle } from './gestures.ts';
import { useGesture } from './gestureStore.ts';
import { VectorOverlay } from '../vector/VectorOverlay.tsx';

interface Measured {
  readonly selection: { id: NodeId; rect: Rect }[];
  readonly hover: Rect | null;
  readonly parent: Rect | null;
  readonly titles: { id: NodeId; name: string; rect: Rect }[];
}

const EMPTY: Measured = { selection: [], hover: null, parent: null, titles: [] };
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function measure(): Measured {
  const { doc, selection, hoverId } = useEditor.getState();
  const selected = selection.map((id) => ({ id, rect: screenRectOf(id) })).filter((s): s is { id: NodeId; rect: Rect } => !!s.rect);
  const hover = hoverId && !selection.includes(hoverId) ? screenRectOf(hoverId) : null;
  let parent: Rect | null = null;
  const only = selection.length === 1 ? selection[0]! : null;
  const parentId = only ? getParentId(doc, only) : null;
  const parentEl = domElement(parentId);
  if (parentEl && parentId && !isRoot(doc, parentId)) {
    const display = styleOf(parentEl).display;
    if (display.includes('flex') || display.includes('grid')) parent = screenRectOf(parentId);
  }
  const titles = activeRoots(useEditor.getState()).flatMap((id) => {
    const host = hostOf(id);
    if (!host) return [];
    return [{ id, name: layerName(doc, id), rect: toScreenRect(host.getBoundingClientRect()) }];
  });
  return { selection: selected, hover, parent, titles };
}

const box = (r: Rect) => ({ left: r.x, top: r.y, width: r.width, height: r.height });

export function Overlay() {
  const [m, setM] = useState<Measured>(EMPTY);
  const editing = useEditor((s) => s.editingTextId);
  const zoom = useEditor((s) => s.viewport.zoom);
  const selection = useEditor((s) => s.selection);
  const toolIsSelect = useEditor((s) => s.tool.kind === 'select');
  const editingVector = useEditor((s) => !!s.vectorEdit);
  const { marquee, draft, ghost, dropLine, dropTarget, notice, guides } = useGesture();

  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const next = measure();
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setM(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const single = m.selection.length === 1 ? m.selection[0]! : null;

  const onTitleDown = (e: ReactPointerEvent, id: NodeId) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const store = useEditor.getState();
    if (e.shiftKey) store.toggleSelected(id);
    else if (!store.selection.includes(id)) store.select([id]);
    const ids = useEditor.getState().selection.filter((s) => isRoot(store.doc, s));
    startFrameMove(e.nativeEvent, ids.length ? ids : [id]);
  };

  return (
    <div className="overlay">
      {m.titles.map((t) => (
        <div
          key={t.id}
          className={`artboard-title${selection.includes(t.id) ? ' is-selected' : ''}`}
          style={{ left: t.rect.x, top: t.rect.y - 20, maxWidth: Math.max(40, t.rect.width) }}
          onPointerDown={(e) => onTitleDown(e, t.id)}
          title={`${t.name} — drag to move`}
        >
          {t.name}
        </div>
      ))}
      {m.parent && <div className="ov-parent" style={box(m.parent)} />}
      {m.hover && <div className="ov-hover" style={box(m.hover)} />}
      {!editingVector && m.selection.map((s) => (
        <div key={s.id} className="ov-selection" style={box(s.rect)} />
      ))}
      {single && !editing && !editingVector && toolIsSelect && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h}
              className={`ov-handle ov-handle-${h}`}
              style={handlePosition(single.rect, h)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                startResize(e.nativeEvent, single.id, h);
              }}
            />
          ))}
          <div className="ov-size" style={{ left: single.rect.x + single.rect.width / 2, top: single.rect.y + single.rect.height + 6 }}>
            {fmt(single.rect.width / zoom)} × {fmt(single.rect.height / zoom)}
          </div>
        </>
      )}
      {dropTarget && <div className="ov-drop-target" style={box(dropTarget)} />}
      {ghost && <div className="ov-ghost" style={box(ghost)} />}
      {dropLine && (
        <div
          className="ov-drop-line"
          style={{ left: Math.min(dropLine.x1, dropLine.x2), top: Math.min(dropLine.y1, dropLine.y2), width: Math.max(2, Math.abs(dropLine.x2 - dropLine.x1)), height: Math.max(2, Math.abs(dropLine.y2 - dropLine.y1)) }}
        />
      )}
      <VectorOverlay />
      {marquee && <div className="ov-marquee" style={box(marquee)} />}
      {draft && <div className="ov-draft" style={box(draft)} />}
      {guides.length > 0 && (
        <svg className="ov-guides" aria-hidden="true">
          {guides.map((g, i) => (
            <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
          ))}
        </svg>
      )}
      {notice && (
        <div className="ov-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(Math.round(n * 10) / 10) ? String(Math.round(n)) : n.toFixed(1);
}

function handlePosition(r: Rect, h: Handle) {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.width : r.x + r.width / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.height : r.y + r.height / 2;
  return { left: x, top: y };
}
