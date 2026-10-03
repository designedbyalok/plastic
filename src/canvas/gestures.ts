/**
 * Pointer gestures on the canvas. Each gesture reads live layout from the DOM once at the
 * start, then produces document edits inside a transaction so the whole drag is one undo step.
 */
import { canEditText, createFrame } from '../editor/commands.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import { instantiate, withRootStyle } from '../document/factory.ts';
import { insertChild, insertRoot, moveNode, setFrame, setStyleOnNodes } from '../document/ops.ts';
import { getElement, getParentId, isRoot, topmostIds } from '../document/tree.ts';
import type { DesignDocument, NodeId, Point } from '../document/types.ts';
import { DEFAULT_TEXT_FONT, FRAME_SIZE, insertable } from '../elements/insertables.ts';
import { selectFont } from '../document/fonts.ts';
import { elementSpec } from '../elements/registry.ts';
import { rectFromPoints, rectsIntersect, screenToWorld, unionRects, type Rect } from './coords.ts';
import { clearGuides, collectTargets, snapRect } from './snap.ts';
import { clientRectOf, domElement, isOutOfFlow, nodeIdAt, screenRectOf, styleOf, toScreen } from './dom.ts';
import { useGesture } from './gestureStore.ts';
import { vectorRootOf } from '../vector/edit.ts';
import { containerAt, findDropTarget, flowInsertion, insertsInFlow, type DropTarget } from './layout.ts';

const px = (n: number) => `${Math.round(n)}px`;
const editor = () => useEditor.getState();

interface TrackHandlers {
  move?(e: PointerEvent, delta: Point): void;
  end?(e: PointerEvent, moved: boolean): void;
  cancel?(): void;
  threshold?: number;
}

/** Follow one pointer until release. `move` starts once the pointer passes the threshold. */
export function trackPointer(start: PointerEvent, handlers: TrackHandlers): void {
  const threshold = handlers.threshold ?? 3;
  let moved = false;
  const onMove = (e: PointerEvent) => {
    const delta = { x: e.clientX - start.clientX, y: e.clientY - start.clientY };
    if (!moved && Math.hypot(delta.x, delta.y) < threshold) return;
    moved = true;
    handlers.move?.(e, delta);
  };
  const onUp = (e: PointerEvent) => {
    cleanup();
    handlers.end?.(e, moved);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    cleanup();
    handlers.cancel?.();
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKey, true);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey, true);
}

/** Run `recipe` against the gesture's starting document; opens the transaction lazily. */
export function transactional() {
  let open = false;
  return {
    preview(recipe: (base: DesignDocument) => DesignDocument) {
      if (!open) {
        editor().begin();
        open = true;
      }
      editor().preview(recipe);
    },
    commit(label: string, select?: readonly NodeId[]) {
      if (open) editor().commit(label, select);
    },
    cancel() {
      if (open) editor().cancel();
    },
  };
}

// --- pan --------------------------------------------------------------------------------------

export function startPan(e: PointerEvent): void {
  const start = editor().viewport;
  trackPointer(e, { threshold: 0, move: (_, d) => editor().setViewport({ ...start, x: start.x + d.x, y: start.y + d.y }) });
}

// --- select / move ----------------------------------------------------------------------------

export function startSelectGesture(e: PointerEvent): void {
  const { doc, selection } = editor();
  const deepest = nodeIdAt(e.clientX, e.clientY);
  // A click inside an svg selects the whole vector (double-click edits its points).
  const hit = vectorRootOf(doc, deepest) ?? deepest;
  if (!hit) {
    const base = e.shiftKey ? [...selection] : [];
    if (!e.shiftKey) editor().select([]);
    startMarquee(e, null, base);
    return;
  }
  if (e.shiftKey) {
    editor().toggleSelected(hit);
    return;
  }
  const el = getElement(doc, hit);
  if (el && isRoot(doc, hit) && elementSpec(el.tag).acceptsChildren && !selection.includes(hit)) {
    // An artboard's background: click selects it, drag draws a marquee over its children.
    startMarquee(e, hit, [], () => editor().select([hit]));
    return;
  }
  if (!selection.includes(hit)) editor().select([hit]);
  startMove(e, hit);
}

function startMove(e: PointerEvent, hit: NodeId): void {
  const { doc, selection } = editor();
  const ids = topmostIds(doc, selection.includes(hit) ? selection : [hit]);
  if (ids.every((id) => isRoot(doc, id))) return startFrameMove(e, ids);
  const movable = ids.filter((id) => !isRoot(doc, id));
  if (movable.every((id) => isOutOfFlow(domElement(id)))) return startFreeMove(e, movable);
  if (movable.length === 1) return startFlowMove(e, movable[0]!);
}

/** Free positioning: drag rewrites `left` / `top` in document pixels. */
function startFreeMove(e: PointerEvent, ids: readonly NodeId[]): void {
  const zoom = editor().viewport.zoom;
  const starts = ids.map((id) => {
    const cs = styleOf(domElement(id)!);
    return { id, left: parseFloat(cs.left) || 0, top: parseFloat(cs.top) || 0 };
  });
  // The moving group's box snaps its edges and center to the other objects in the artboard.
  const box = unionRects(ids.map((id) => screenRectOf(id)).filter((r): r is Rect => !!r));
  const targets = collectTargets(ids[0]!, ids);
  const tx = transactional();
  trackPointer(e, {
    move: (_, d) => {
      const fix = box ? snapRect({ ...box, x: box.x + d.x, y: box.y + d.y }, targets) : { x: 0, y: 0 };
      const dx = d.x + fix.x;
      const dy = d.y + fix.y;
      tx.preview((base) =>
        starts.reduce((doc, s) => {
          const moved = setStyleOnNodes(doc, [s.id], 'left', px(s.left + dx / zoom));
          return setStyleOnNodes(moved, [s.id], 'top', px(s.top + dy / zoom));
        }, base),
      );
    },
    end: () => {
      clearGuides();
      tx.commit('Move');
    },
    cancel: () => {
      clearGuides();
      tx.cancel();
    },
  });
}

/** Layout positioning: drag reorders within, or moves between, flow containers. */
function startFlowMove(e: PointerEvent, id: NodeId): void {
  const startRect = screenRectOf(id);
  let target: DropTarget | null = null;
  trackPointer(e, {
    move(ev, d) {
      target = findDropTarget(editor().doc, id, ev.clientX, ev.clientY);
      useGesture.getState().set({
        dropLine: target?.line ?? null,
        dropTarget: target ? screenRectOf(target.parentId) : null,
        ghost: startRect ? { ...startRect, x: startRect.x + d.x, y: startRect.y + d.y } : null,
      });
    },
    end(_, moved) {
      useGesture.getState().clear();
      const drop = target;
      if (!moved || !drop) return;
      const doc = editor().doc;
      const parentId = getParentId(doc, id);
      const unchanged = parentId === drop.parentId && (getElement(doc, parentId)?.children.indexOf(id) ?? -1) === drop.index;
      if (unchanged) return;
      editor().apply('Move', (d) => moveNode(d, id, drop.parentId, drop.index), { select: [id] });
    },
    cancel: () => useGesture.getState().clear(),
  });
}

export function startFrameMove(e: PointerEvent, ids: readonly NodeId[]): void {
  const { doc, viewport } = editor();
  const starts = ids.map((id) => ({ id, ...(doc.frames[id] ?? { x: 0, y: 0 }) }));
  const tx = transactional();
  trackPointer(e, {
    move: (_, d) =>
      tx.preview((base) => starts.reduce((acc, s) => setFrame(acc, s.id, { x: s.x + d.x / viewport.zoom, y: s.y + d.y / viewport.zoom }), base)),
    end: () => tx.commit('Move frame'),
    cancel: () => tx.cancel(),
  });
}

// --- marquee ----------------------------------------------------------------------------------

function marqueeCandidates(scope: NodeId | null): NodeId[] {
  const { doc } = editor();
  const childrenOf = (id: NodeId) => getElement(doc, id)?.children.filter((c) => doc.nodes[c]?.kind === 'element') ?? [];
  if (scope) return childrenOf(scope);
  return activeRoots(editor()).flatMap((r) => {
    const el = getElement(doc, r);
    return el && elementSpec(el.tag).acceptsChildren ? childrenOf(r) : [r];
  });
}

function startMarquee(e: PointerEvent, scope: NodeId | null, base: readonly NodeId[], onClick?: () => void): void {
  const origin = toScreen(e.clientX, e.clientY);
  const candidates = marqueeCandidates(scope);
  trackPointer(e, {
    move(ev) {
      const rect = rectFromPoints(origin, toScreen(ev.clientX, ev.clientY));
      useGesture.getState().set({ marquee: rect });
      const hits = candidates.filter((id) => {
        const r = screenRectOf(id);
        return r && rectsIntersect(r, rect);
      });
      const rootHits = !scope && !hits.length ? activeRoots(editor()).filter((id) => {
        const r = screenRectOf(id);
        return r && rectsIntersect(r, rect);
      }) : [];
      editor().select([...new Set([...base, ...hits, ...rootHits])]);
    },
    end(_, moved) {
      useGesture.getState().set({ marquee: null });
      if (!moved) onClick?.();
    },
    cancel: () => useGesture.getState().set({ marquee: null }),
  });
}

// --- resize -----------------------------------------------------------------------------------

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function startResize(e: PointerEvent, id: NodeId, handle: Handle): void {
  const el = domElement(id);
  if (!el) return;
  const { doc, viewport } = editor();
  const zoom = viewport.zoom;
  const cs = styleOf(el);
  const rect = clientRectOf(el);
  const startW = rect.width / zoom;
  const startH = rect.height / zoom;
  const contentBox = cs.boxSizing !== 'border-box';
  const extraX = contentBox ? sum(cs.paddingLeft, cs.paddingRight, cs.borderLeftWidth, cs.borderRightWidth) : 0;
  const extraY = contentBox ? sum(cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.borderBottomWidth) : 0;
  const root = isRoot(doc, id);
  const free = !root && isOutOfFlow(el);
  const startLeft = parseFloat(cs.left) || 0;
  const startTop = parseFloat(cs.top) || 0;
  const frame = doc.frames[id] ?? { x: 0, y: 0 };
  const heightProp = root ? 'min-height' : 'height';
  const tx = transactional();

  trackPointer(e, {
    threshold: 0,
    move(_, d) {
      const dx = d.x / zoom;
      const dy = d.y / zoom;
      const w = Math.max(1, startW + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0));
      const h = Math.max(1, startH + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0));
      tx.preview((base) => {
        let next = base;
        if (handle.includes('e') || handle.includes('w')) next = setStyleOnNodes(next, [id], 'width', px(w - extraX));
        if (handle.includes('n') || handle.includes('s')) next = setStyleOnNodes(next, [id], heightProp, px(h - extraY));
        const shiftX = handle.includes('w') ? startW - w : 0;
        const shiftY = handle.includes('n') ? startH - h : 0;
        if (root && (shiftX || shiftY)) next = setFrame(next, id, { x: frame.x + shiftX, y: frame.y + shiftY });
        if (free && shiftX) next = setStyleOnNodes(next, [id], 'left', px(startLeft + shiftX));
        if (free && shiftY) next = setStyleOnNodes(next, [id], 'top', px(startTop + shiftY));
        return next;
      });
    },
    end: () => tx.commit('Resize'),
    cancel: () => tx.cancel(),
  });
}

function sum(...values: string[]): number {
  return values.reduce((acc, v) => acc + (parseFloat(v) || 0), 0);
}

// --- frame tool -------------------------------------------------------------------------------

export function startFrameDraw(e: PointerEvent): void {
  const origin = toScreen(e.clientX, e.clientY);
  const finish = (rect: Rect) => {
    createFrame(rect);
    editor().setTool({ kind: 'select' });
  };
  trackPointer(e, {
    threshold: 2,
    move: (ev) => useGesture.getState().set({ draft: rectFromPoints(origin, toScreen(ev.clientX, ev.clientY)) }),
    end(ev, moved) {
      useGesture.getState().set({ draft: null });
      const { viewport } = editor();
      const a = screenToWorld(origin, viewport);
      const b = screenToWorld(toScreen(ev.clientX, ev.clientY), viewport);
      const rect = rectFromPoints(a, b);
      finish(moved && rect.width >= 16 && rect.height >= 16 ? rect : { x: a.x, y: a.y, ...FRAME_SIZE });
    },
    cancel: () => useGesture.getState().set({ draft: null }),
  });
}

// --- insert tool ------------------------------------------------------------------------------

/** Click-to-insert: into the container under the pointer, in flow or freely positioned. */
export function insertAt(e: PointerEvent, itemId: string): void {
  const item = insertable(itemId);
  if (!item) return;
  const { doc, viewport } = editor();
  const container = containerAt(doc, e.clientX, e.clientY);
  let newId: NodeId = '';
  const make = (d: DesignDocument, spec = item.spec()) => {
    const made = instantiate(d, spec);
    return item.editTextOnInsert ? { ...made, doc: selectFont(made.doc, [made.id], DEFAULT_TEXT_FONT) } : made;
  };

  if (!container) {
    const world = screenToWorld(toScreen(e.clientX, e.clientY), viewport);
    editor().apply(`Insert ${item.label}`, (d) => {
      const made = make(d);
      newId = made.id;
      return setFrame(insertRoot(made.doc, editor().activePage, Number.MAX_SAFE_INTEGER, made.id), made.id, world);
    });
  } else if (insertsInFlow(doc, container)) {
    const insertion = flowInsertion(doc, container, new Set(), e.clientX, e.clientY);
    editor().apply(`Insert ${item.label}`, (d) => {
      const made = make(d);
      newId = made.id;
      return insertChild(made.doc, container.id, insertion?.index ?? container.children.length, made.id);
    });
  } else {
    const el = domElement(container.id)!;
    const r = clientRectOf(el);
    const left = (e.clientX - r.left) / viewport.zoom - el.clientLeft;
    const top = (e.clientY - r.top) / viewport.zoom - el.clientTop;
    const needsPositioning = styleOf(el).position === 'static';
    editor().apply(`Insert ${item.label}`, (d) => {
      const made = make(d, withRootStyle(item.spec(), { position: 'absolute', left: px(left), top: px(top) }));
      newId = made.id;
      let next = insertChild(made.doc, container.id, container.children.length, made.id);
      if (needsPositioning) next = setStyleOnNodes(next, [container.id], 'position', 'relative');
      return next;
    });
  }

  editor().select([newId]);
  editor().setTool({ kind: 'select' });
  if (item.editTextOnInsert && canEditText(editor().doc, newId)) requestAnimationFrame(() => editor().setEditingText(newId));
}
