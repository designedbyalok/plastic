/**
 * Pointer gestures for vector editing and the pen. Like the canvas gestures, each one runs in a
 * transaction, so a whole drag (or a pen click-and-drag) is one undo step.
 */
import type { NodeId, Point } from '../document/types.ts';
import { useEditor, type VectorEdit } from '../editor/store.ts';
import { trackPointer, transactional } from '../canvas/gestures.ts';
import { useGesture } from '../canvas/gestureStore.ts';
import { rectFromPoints, type Rect } from '../canvas/coords.ts';
import { toScreen } from '../canvas/dom.ts';
import { apply, clientToUser, createVectorAt, readPath, screenDeltaToUser, userToScreenMatrix, vectorRootOf, writePath } from './edit.ts';
import {
  anchorRefs,
  bendSegment,
  insertAnchor,
  moveRefs,
  nearestOnCubic,
  segmentCount,
  segmentCurve,
  setHandle,
  type Anchor,
  type PointRef,
  type VectorPath,
} from './path.ts';

const editor = () => useEditor.getState();
const sameRef = (a: PointRef, b: PointRef) => a.sub === b.sub && a.index === b.index && a.part === b.part;
/** How close (screen px) the pointer must be to a point or segment to hit it. */
export const HIT_RADIUS = 7;

function setEdit(patch: Partial<VectorEdit>): void {
  const edit = editor().vectorEdit;
  if (edit) editor().setVectorEdit({ ...edit, ...patch });
}

/** Snap `p` to the nearest 45° direction from `from` (Shift). */
function constrain45(from: Point, p: Point): Point {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const len = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

// --- edit mode ---------------------------------------------------------------------------------

/** Press on an anchor: select it (Shift toggles), then drag moves every selected anchor. */
export function startAnchorDrag(e: PointerEvent, ref: PointRef): void {
  const edit = editor().vectorEdit;
  if (!edit) return;
  const selected = edit.points.some((p) => sameRef(p, ref));
  if (e.shiftKey) {
    setEdit({ points: selected ? edit.points.filter((p) => !sameRef(p, ref)) : [...edit.points, ref] });
    if (selected) return;
  } else if (!selected) {
    setEdit({ points: [ref] });
  }
  const refs = anchorRefs(editor().vectorEdit!.points.filter((p) => p.part === 'anchor'));
  const tx = transactional();
  trackPointer(e, {
    move(ev, d) {
      const screen = ev.shiftKey ? (Math.abs(d.x) > Math.abs(d.y) ? { x: d.x, y: 0 } : { x: 0, y: d.y }) : d;
      const delta = screenDeltaToUser(edit.id, screen);
      if (!delta) return;
      tx.preview((base) => writePath(base, edit.id, moveRefs(readPath(base, edit.id), refs, delta)));
    },
    end: () => tx.commit('Move points'),
    cancel: () => tx.cancel(),
  });
}

/** Drag a curve handle. Its anchor's mirroring moves the opposite handle; Alt breaks it. */
export function startHandleDrag(e: PointerEvent, ref: PointRef): void {
  const edit = editor().vectorEdit;
  if (!edit) return;
  const m = userToScreenMatrix(edit.id);
  if (!m) return;
  const inv = m.inverse();
  const tx = transactional();
  trackPointer(e, {
    threshold: 0,
    move(ev) {
      const to = apply(inv, toScreen(ev.clientX, ev.clientY));
      tx.preview((base) => {
        const path = readPath(base, edit.id);
        const anchor = path[ref.sub]?.anchors[ref.index];
        if (!anchor) return base;
        const target = ev.shiftKey ? constrain45(anchor, to) : to;
        return writePath(base, edit.id, setHandle(path, ref, target, ev.altKey ? 'none' : undefined));
      });
    },
    end: () => tx.commit('Move handle'),
    cancel: () => tx.cancel(),
  });
}

/**
 * Press on a segment: a click adds a point there; a drag moves the segment's two anchors;
 * ⌘/Ctrl-drag bends the segment through the pointer.
 */
export function startSegmentGesture(e: PointerEvent, sub: number, index: number): void {
  const edit = editor().vectorEdit;
  if (!edit) return;
  const m = userToScreenMatrix(edit.id);
  if (!m) return;
  const inv = m.inverse();
  const startPath = readPath(editor().doc, edit.id);
  const curve = segmentCurve(startPath[sub]!, index);
  if (!curve) return;
  const at = apply(inv, toScreen(e.clientX, e.clientY));
  const { t } = nearestOnCubic(curve, at);
  const bend = e.metaKey || e.ctrlKey;
  const count = startPath[sub]!.anchors.length;
  const ends: PointRef[] = [
    { sub, index, part: 'anchor' },
    { sub, index: (index + 1) % count, part: 'anchor' },
  ];
  const tx = transactional();
  trackPointer(e, {
    move(ev, d) {
      if (bend) {
        const to = apply(inv, toScreen(ev.clientX, ev.clientY));
        tx.preview((base) => writePath(base, edit.id, bendSegment(readPath(base, edit.id), sub, index, t, to)));
      } else {
        const delta = screenDeltaToUser(edit.id, d);
        if (!delta) return;
        setEdit({ points: ends });
        tx.preview((base) => writePath(base, edit.id, moveRefs(readPath(base, edit.id), ends, delta)));
      }
    },
    end(_, moved) {
      if (moved) return tx.commit(bend ? 'Bend segment' : 'Move segment');
      let ref: PointRef | null = null;
      editor().apply('Add point', (d) => {
        const made = insertAnchor(readPath(d, edit.id), sub, index, t);
        ref = made.ref;
        return writePath(d, edit.id, made.path);
      });
      if (ref) setEdit({ points: [ref] });
    },
    cancel: () => tx.cancel(),
  });
}

/** Drag on empty space in edit mode: select the anchors inside the box (Shift adds). */
export function startPointMarquee(e: PointerEvent, onClick: () => void): void {
  const edit = editor().vectorEdit;
  if (!edit) return;
  const origin = toScreen(e.clientX, e.clientY);
  const base = e.shiftKey ? edit.points : [];
  trackPointer(e, {
    move(ev) {
      const rect = rectFromPoints(origin, toScreen(ev.clientX, ev.clientY));
      useGesture.getState().set({ marquee: rect });
      const m = userToScreenMatrix(edit.id);
      if (!m) return;
      const hits = anchorsInRect(readPath(editor().doc, edit.id), m, rect);
      setEdit({ points: [...base, ...hits.filter((h) => !base.some((b) => sameRef(b, h)))] });
    },
    end(_, moved) {
      useGesture.getState().set({ marquee: null });
      if (!moved) onClick();
    },
    cancel: () => useGesture.getState().set({ marquee: null }),
  });
}

function anchorsInRect(path: VectorPath, m: DOMMatrix, r: Rect): PointRef[] {
  const out: PointRef[] = [];
  path.forEach((s, sub) =>
    s.anchors.forEach((a, index) => {
      const p = apply(m, a);
      if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) out.push({ sub, index, part: 'anchor' });
    }),
  );
  return out;
}

// --- hit testing (screen space) ----------------------------------------------------------------

export type VectorHit = { kind: 'anchor'; ref: PointRef } | { kind: 'segment'; sub: number; index: number; t: number } | null;

export function hitTest(path: VectorPath, m: DOMMatrix, screen: Point): VectorHit {
  let best: VectorHit = null;
  let bestDistance = HIT_RADIUS;
  path.forEach((s, sub) =>
    s.anchors.forEach((a, index) => {
      const p = apply(m, a);
      const d = Math.hypot(p.x - screen.x, p.y - screen.y);
      if (d <= bestDistance) {
        bestDistance = d;
        best = { kind: 'anchor', ref: { sub, index, part: 'anchor' } };
      }
    }),
  );
  if (best) return best;
  const inv = m.inverse();
  const user = apply(inv, screen);
  path.forEach((s, sub) => {
    for (let index = 0; index < segmentCount(s); index++) {
      const c = segmentCurve(s, index)!;
      const near = nearestOnCubic(c, user);
      const p = apply(m, near.point);
      const d = Math.hypot(p.x - screen.x, p.y - screen.y);
      if (d <= bestDistance) {
        bestDistance = d;
        best = { kind: 'segment', sub, index, t: near.t };
      }
    }
  });
  return best;
}

// --- pen ---------------------------------------------------------------------------------------

/** Handles for a pen drag from `anchor` toward `to`: out follows the pointer, in mirrors it. */
function penHandles(anchor: Point, to: Point): Pick<Anchor, 'in' | 'out' | 'mirror'> {
  if (Math.hypot(to.x - anchor.x, to.y - anchor.y) < 0.5) return { in: null, out: null, mirror: 'none' };
  return { out: to, in: { x: 2 * anchor.x - to.x, y: 2 * anchor.y - to.y }, mirror: 'angle-length' };
}

export function updateAnchor(path: VectorPath, sub: number, index: number, fn: (a: Anchor) => Anchor): VectorPath {
  return path.map((s, i) => (i !== sub ? s : { ...s, anchors: s.anchors.map((a, j) => (j === index ? fn(a) : a)) }));
}

/**
 * After placing an anchor, dragging pulls out its handles: "out" follows the pointer and "in"
 * mirrors it. Alt breaks the mirror (only "out" moves); Shift snaps the angle to 45°.
 *
 * `role` says where the handles live: an appended end point keeps "out" pending in the drawing
 * state (no segment leaves it yet); a new subpath's first point keeps both pending; a closing
 * point has segments on both sides, so both go into the path.
 */
function dragNewHandles(e: PointerEvent, id: NodeId, sub: number, index: number, label: string, role: 'end' | 'start' | 'close'): void {
  const tx = transactional();
  let frozenIn: Point | null | undefined;
  const anchorAt = () => readPath(editor().doc, id)[sub]?.anchors[index];
  const start = anchorAt();
  if (!start) return;
  const startIn = role === 'start' ? (editor().vectorEdit?.drawing?.startIn ?? null) : start.in;
  trackPointer(e, {
    threshold: 2,
    move(ev) {
      const to0 = clientToUser(id, ev.clientX, ev.clientY);
      if (!to0) return;
      const to = ev.shiftKey ? constrain45(start, to0) : to0;
      const handles = penHandles(start, to);
      if (ev.altKey) frozenIn ??= startIn;
      else frozenIn = undefined;
      const handleIn = ev.altKey ? (frozenIn ?? null) : handles.in;
      const mirror = ev.altKey ? 'none' : handles.mirror;
      if (role === 'start') {
        const edit = editor().vectorEdit;
        if (edit?.drawing) editor().setVectorEdit({ ...edit, drawing: { ...edit.drawing, out: handles.out, startIn: handleIn } });
        return;
      }
      if (role === 'end') {
        const edit = editor().vectorEdit;
        if (edit?.drawing) editor().setVectorEdit({ ...edit, drawing: { ...edit.drawing, out: handles.out } });
      }
      tx.preview((base) =>
        writePath(base, id, updateAnchor(readPath(base, id), sub, index, (a) => ({ ...a, in: handleIn, mirror, ...(role === 'close' ? { out: handles.out } : {}) }))),
      );
    },
    end(_, moved) {
      if (moved) tx.commit(label);
      else tx.cancel();
    },
    cancel: () => tx.cancel(),
  });
}

/** One press of the pen tool on the canvas. */
export function penDown(e: PointerEvent): void {
  const edit = editor().vectorEdit;

  // Not editing a vector yet: start a new one here.
  if (!edit) {
    const id = createVectorAt(e.clientX, e.clientY);
    if (!id) return;
    const svg = vectorRootOf(editor().doc, id);
    if (svg) editor().select([svg]);
    editor().setVectorEdit({ id, points: [{ sub: 0, index: 0, part: 'anchor' }], drawing: { sub: 0, out: null, startIn: null } });
    dragNewHandles(e, id, 0, 0, 'Pen', 'start');
    return;
  }

  const id = edit.id;
  const m = userToScreenMatrix(id);
  const user = clientToUser(id, e.clientX, e.clientY);
  if (!m || !user) return;
  const path = readPath(editor().doc, id);
  const screen = toScreen(e.clientX, e.clientY);
  const hit = hitTest(path, m, screen);

  if (edit.drawing) {
    const sub = path[edit.drawing.sub];
    if (!sub) return setEdit({ drawing: null });
    const last = sub.anchors[sub.anchors.length - 1]!;
    const drawing = edit.drawing;
    /** The pending handles become real once there are segments for them. */
    const settle = (s: VectorPath[number]): VectorPath[number] => {
      const anchors = [...s.anchors];
      const end = anchors.length - 1;
      if (drawing.out) anchors[end] = { ...anchors[end]!, out: drawing.out, mirror: anchors[end]!.in ? anchors[end]!.mirror : 'none' };
      if (drawing.startIn && !anchors[0]!.in) anchors[0] = { ...anchors[0]!, in: drawing.startIn, mirror: 'angle-length' };
      return { ...s, anchors };
    };
    // Back on the first anchor: close the shape.
    if (hit?.kind === 'anchor' && hit.ref.sub === drawing.sub && hit.ref.index === 0 && sub.anchors.length >= 2) {
      editor().apply('Close path', (d) => writePath(d, id, readPath(d, id).map((s, i) => (i === drawing.sub ? { ...settle(s), closed: true } : s))));
      setEdit({ drawing: null, points: [hit.ref] });
      dragNewHandles(e, id, hit.ref.sub, 0, 'Close path', 'close');
      return;
    }
    const at = e.shiftKey ? constrain45(last, user) : user;
    const index = sub.anchors.length;
    editor().apply('Add point', (d) =>
      writePath(d, id, readPath(d, id).map((s, i) => (i === drawing.sub ? { ...settle(s), anchors: [...settle(s).anchors, { x: at.x, y: at.y, in: null, out: null, mirror: 'none' as const }] } : s))),
    );
    // The first anchor's pending "in" waits for the close; the last "out" was just used.
    setEdit({ points: [{ sub: drawing.sub, index, part: 'anchor' }], drawing: { sub: drawing.sub, out: null, startIn: drawing.startIn ?? null } });
    dragNewHandles(e, id, drawing.sub, index, 'Pen', 'end');
    return;
  }

  // Not drawing: an open end continues its path, a segment gets a new point, anywhere else
  // starts a new subpath in the same vector.
  if (hit?.kind === 'anchor') {
    const s = path[hit.ref.sub]!;
    if (!s.closed && (hit.ref.index === 0 || hit.ref.index === s.anchors.length - 1)) {
      if (hit.ref.index === 0 && s.anchors.length > 1) {
        // Continue from the start: reverse the subpath so new points append at the end.
        editor().apply('Continue path', (d) => writePath(d, id, readPath(d, id).map((x, i) => (i === hit.ref.sub ? reverse(x) : x))));
      }
      const len = readPath(editor().doc, id)[hit.ref.sub]!.anchors.length;
      setEdit({ drawing: { sub: hit.ref.sub, out: null, startIn: null }, points: [{ sub: hit.ref.sub, index: len - 1, part: 'anchor' }] });
      return;
    }
    setEdit({ points: [hit.ref] });
    return;
  }
  if (hit?.kind === 'segment') {
    let ref: PointRef | null = null;
    editor().apply('Add point', (d) => {
      const made = insertAnchor(readPath(d, id), hit.sub, hit.index, hit.t);
      ref = made.ref;
      return writePath(d, id, made.path);
    });
    if (ref) setEdit({ points: [ref] });
    return;
  }
  const sub = path.length;
  editor().apply('Pen', (d) => writePath(d, id, [...readPath(d, id), { closed: false, anchors: [{ x: user.x, y: user.y, in: null, out: null, mirror: 'none' }] }]));
  setEdit({ drawing: { sub, out: null, startIn: null }, points: [{ sub, index: 0, part: 'anchor' }] });
  dragNewHandles(e, id, sub, 0, 'Pen', 'start');
}

function reverse(s: VectorPath[number]): VectorPath[number] {
  return { ...s, anchors: [...s.anchors].reverse().map((a) => ({ ...a, in: a.out, out: a.in })) };
}
