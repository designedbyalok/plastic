/**
 * Editable vector paths. An SVG path's `d` becomes subpaths of anchors with optional in/out
 * handles (absolute positions, in the path's own user space), and back. Parsing normalizes any
 * path (relative, shorthand, arcs, quadratics) through svgpath (MIT) into cubic curves, so every
 * imported or hand-written path is editable.
 */
import SvgPath from 'svgpath';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How an anchor's two handles move together (Figma's "mirroring"). */
export type Mirror = 'none' | 'angle' | 'angle-length';

export interface Anchor {
  readonly x: number;
  readonly y: number;
  /** Handle shaping the curve arriving at this anchor; null = straight. */
  readonly in: Point | null;
  /** Handle shaping the curve leaving this anchor; null = straight. */
  readonly out: Point | null;
  readonly mirror: Mirror;
  /** Corner radius (Figma's per-point radius); only rounds corners between straight segments. */
  readonly radius?: number;
}

export interface SubPath {
  readonly anchors: readonly Anchor[];
  readonly closed: boolean;
}

export type VectorPath = readonly SubPath[];

/** One editable thing on a path: an anchor or one of its handles. */
export interface PointRef {
  readonly sub: number;
  readonly index: number;
  readonly part: 'anchor' | 'in' | 'out';
}

const EPS = 1e-6;
const near = (a: Point, b: Point, eps = 1e-3) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

/** Infer the mirroring mode from the handles: opposite and equal, opposite only, or neither. */
export function inferMirror(a: Point, h1: Point | null, h2: Point | null): Mirror {
  if (!h1 || !h2) return 'none';
  const v1 = { x: h1.x - a.x, y: h1.y - a.y };
  const v2 = { x: h2.x - a.x, y: h2.y - a.y };
  const l1 = Math.hypot(v1.x, v1.y);
  const l2 = Math.hypot(v2.x, v2.y);
  if (l1 < EPS || l2 < EPS) return 'none';
  const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
  if (cos > -0.999) return 'none';
  return Math.abs(l1 - l2) / Math.max(l1, l2) < 0.01 ? 'angle-length' : 'angle';
}

export function parsePath(d: string): VectorPath {
  const subs: { anchors: Anchor[]; closed: boolean }[] = [];
  let current: { anchors: Anchor[]; closed: boolean } | null = null;
  let last: Point = { x: 0, y: 0 };
  const push = (anchor: Anchor) => current!.anchors.push(anchor);
  const setOut = (out: Point | null) => {
    const a = current!.anchors[current!.anchors.length - 1]!;
    current!.anchors[current!.anchors.length - 1] = { ...a, out };
  };
  let path: ReturnType<typeof SvgPath>;
  try {
    path = SvgPath(d).abs().unarc().unshort();
  } catch {
    return [];
  }
  path.iterate((seg: (string | number)[]) => {
    const cmd = seg[0] as string;
    const n = seg.slice(1) as number[];
    switch (cmd) {
      case 'M':
        current = { anchors: [], closed: false };
        subs.push(current);
        last = { x: n[0]!, y: n[1]! };
        push({ ...last, in: null, out: null, mirror: 'none' });
        break;
      case 'L':
      case 'H':
      case 'V': {
        const p = cmd === 'H' ? { x: n[0]!, y: last.y } : cmd === 'V' ? { x: last.x, y: n[0]! } : { x: n[0]!, y: n[1]! };
        if (!current) break;
        push({ ...p, in: null, out: null, mirror: 'none' });
        last = p;
        break;
      }
      case 'C': {
        if (!current) break;
        const c1 = { x: n[0]!, y: n[1]! };
        const c2 = { x: n[2]!, y: n[3]! };
        const p = { x: n[4]!, y: n[5]! };
        setOut(near(c1, last) ? null : c1);
        push({ ...p, in: near(c2, p) ? null : c2, out: null, mirror: 'none' });
        last = p;
        break;
      }
      case 'Q': {
        if (!current) break;
        // Quadratic → cubic: control points at 2/3 of the way to the quadratic one.
        const q = { x: n[0]!, y: n[1]! };
        const p = { x: n[2]!, y: n[3]! };
        const c1 = { x: last.x + (2 / 3) * (q.x - last.x), y: last.y + (2 / 3) * (q.y - last.y) };
        const c2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
        setOut(c1);
        push({ ...p, in: c2, out: null, mirror: 'none' });
        last = p;
        break;
      }
      case 'Z':
      case 'z': {
        if (!current) break;
        current.closed = true;
        const anchors = current.anchors;
        // A closing segment that ends on the start point: merge the duplicate anchor.
        if (anchors.length > 1 && near(anchors[0]!, anchors[anchors.length - 1]!)) {
          const end = anchors.pop()!;
          anchors[0] = { ...anchors[0]!, in: end.in };
        }
        last = anchors[0] ?? last;
        break;
      }
    }
  });
  return subs
    .filter((s) => s.anchors.length > 0)
    .map((s) => ({
      closed: s.closed,
      anchors: s.anchors.map((a) => ({ ...a, mirror: inferMirror(a, a.in, a.out) })),
    }));
}

const num = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

function segment(from: Anchor, to: Anchor): string {
  if (!from.out && !to.in) return `L${num(to.x)} ${num(to.y)}`;
  const c1 = from.out ?? from;
  const c2 = to.in ?? to;
  return `C${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(to.x)} ${num(to.y)}`;
}

export function serializePath(path: VectorPath): string {
  return path
    .filter((s) => s.anchors.length > 0)
    .map((s) => {
      const a = s.anchors;
      let d = `M${num(a[0]!.x)} ${num(a[0]!.y)}`;
      for (let i = 1; i < a.length; i++) d += segment(a[i - 1]!, a[i]!);
      if (s.closed && a.length > 1) {
        const closing = segment(a[a.length - 1]!, a[0]!);
        // A straight closing segment is implied by Z.
        if (!closing.startsWith('L')) d += closing;
        d += 'Z';
      }
      return d;
    })
    .join('');
}

// --- geometry ----------------------------------------------------------------------------------

export type Cubic = readonly [Point, Point, Point, Point];

/** The curve from anchor `i` to the next one (wrapping on closed subpaths). */
export function segmentCurve(sub: SubPath, i: number): Cubic | null {
  const next = i + 1 < sub.anchors.length ? i + 1 : sub.closed ? 0 : -1;
  if (next < 0 || (next === 0 && sub.anchors.length < 2)) return null;
  const a = sub.anchors[i]!;
  const b = sub.anchors[next]!;
  return [a, a.out ?? a, b.in ?? b, b];
}

export function segmentCount(sub: SubPath): number {
  return sub.anchors.length < 2 ? 0 : sub.closed ? sub.anchors.length : sub.anchors.length - 1;
}

export function pointAt(c: Cubic, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const cc = 3 * mt * t * t;
  const d = t * t * t;
  return { x: a * c[0].x + b * c[1].x + cc * c[2].x + d * c[3].x, y: a * c[0].y + b * c[1].y + cc * c[2].y + d * c[3].y };
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** de Casteljau split at t: the two halves. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c[0], c[1], t);
  const p12 = lerp(c[1], c[2], t);
  const p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  return [
    [c[0], p01, p012, mid],
    [mid, p123, p23, c[3]],
  ];
}

/** Closest point on a curve to `p` (sampling, then refining), with its parameter and distance. */
export function nearestOnCubic(c: Cubic, p: Point): { t: number; point: Point; distance: number } {
  let bestT = 0;
  let best = Infinity;
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const q = pointAt(c, t);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < best) {
      best = d;
      bestT = t;
    }
  }
  let span = 1 / steps;
  for (let k = 0; k < 20; k++) {
    span /= 2;
    for (const t of [bestT - span, bestT + span]) {
      if (t < 0 || t > 1) continue;
      const q = pointAt(c, t);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < best) {
        best = d;
        bestT = t;
      }
    }
  }
  return { t: bestT, point: pointAt(c, bestT), distance: Math.sqrt(best) };
}

export const isStraight = (c: Cubic) => near(c[0], c[1]) && near(c[2], c[3]);

// --- edits (pure) -----------------------------------------------------------------------------

function replaceAnchor(path: VectorPath, sub: number, index: number, fn: (a: Anchor) => Anchor): VectorPath {
  return path.map((s, si) => (si !== sub ? s : { ...s, anchors: s.anchors.map((a, ai) => (ai === index ? fn(a) : a)) }));
}

const add = (a: Point, d: Point): Point => ({ x: a.x + d.x, y: a.y + d.y });

/** Move anchors (with their handles) and loose handles by `delta`. */
export function moveRefs(path: VectorPath, refs: readonly PointRef[], delta: Point): VectorPath {
  let next = path;
  const anchorKeys = new Set(refs.filter((r) => r.part === 'anchor').map((r) => `${r.sub}:${r.index}`));
  for (const key of anchorKeys) {
    const [sub, index] = key.split(':').map(Number) as [number, number];
    next = replaceAnchor(next, sub, index, (a) => ({ ...a, ...add(a, delta), in: a.in && add(a.in, delta), out: a.out && add(a.out, delta) }));
  }
  return next;
}

/** Drag one handle to `to`, moving the opposite one according to the anchor's mirroring. */
export function setHandle(path: VectorPath, ref: PointRef, to: Point, mirror?: Mirror): VectorPath {
  if (ref.part === 'anchor') return path;
  return replaceAnchor(path, ref.sub, ref.index, (a) => {
    const mode = mirror ?? a.mirror;
    const otherKey = ref.part === 'in' ? 'out' : 'in';
    const other = a[otherKey];
    const v = { x: to.x - a.x, y: to.y - a.y };
    const len = Math.hypot(v.x, v.y);
    let opposite = other;
    if (mode === 'angle-length') opposite = { x: a.x - v.x, y: a.y - v.y };
    else if (mode === 'angle' && other && len > EPS) {
      const otherLen = Math.hypot(other.x - a.x, other.y - a.y);
      opposite = { x: a.x - (v.x / len) * otherLen, y: a.y - (v.y / len) * otherLen };
    }
    const nearAnchor = len < 0.5;
    return { ...a, mirror: mode, [ref.part]: nearAnchor ? null : to, [otherKey]: opposite } as Anchor;
  });
}

export function setMirror(path: VectorPath, refs: readonly PointRef[], mirror: Mirror): VectorPath {
  let next = path;
  for (const r of refs) {
    next = replaceAnchor(next, r.sub, r.index, (a) => {
      if (mirror === 'none' || (!a.in && !a.out)) return { ...a, mirror };
      // Snap the handles to the new rule, keeping the "out" handle as the reference.
      const ref = a.out ?? a.in!;
      const part = a.out ? 'out' : 'in';
      const v = { x: ref.x - a.x, y: ref.y - a.y };
      const otherKey = part === 'out' ? 'in' : 'out';
      const other = a[otherKey];
      const len = Math.hypot(v.x, v.y);
      const otherLen = other ? Math.hypot(other.x - a.x, other.y - a.y) : len;
      const scale = mirror === 'angle-length' ? 1 : otherLen / Math.max(len, EPS);
      return { ...a, mirror, [otherKey]: { x: a.x - v.x * scale, y: a.y - v.y * scale } } as Anchor;
    });
  }
  return next;
}

/** Corner ↔ smooth. Smooth handles follow the neighbours (a third of the way, like Figma). */
export function toggleSmooth(path: VectorPath, ref: PointRef): VectorPath {
  const sub = path[ref.sub];
  if (!sub) return path;
  const a = sub.anchors[ref.index]!;
  if (a.in || a.out) return replaceAnchor(path, ref.sub, ref.index, (x) => ({ ...x, in: null, out: null, mirror: 'none' }));
  const n = sub.anchors.length;
  const prev = ref.index > 0 ? sub.anchors[ref.index - 1] : sub.closed ? sub.anchors[n - 1] : undefined;
  const next = ref.index < n - 1 ? sub.anchors[ref.index + 1] : sub.closed ? sub.anchors[0] : undefined;
  const from = prev ?? { x: a.x - 20, y: a.y };
  const to = next ?? { x: a.x + 20, y: a.y };
  const dir = { x: to.x - from.x, y: to.y - from.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const reach = Math.min(Math.hypot(a.x - from.x, a.y - from.y), Math.hypot(to.x - a.x, to.y - a.y)) / 3 || 10;
  const u = { x: (dir.x / len) * reach, y: (dir.y / len) * reach };
  return replaceAnchor(path, ref.sub, ref.index, (x) => ({ ...x, in: { x: a.x - u.x, y: a.y - u.y }, out: { x: a.x + u.x, y: a.y + u.y }, mirror: 'angle-length' }));
}

/** Insert an anchor on segment `index` (from anchor index to the next) at parameter t. */
export function insertAnchor(path: VectorPath, sub: number, index: number, t: number): { path: VectorPath; ref: PointRef } {
  const s = path[sub]!;
  const curve = segmentCurve(s, index)!;
  const nextIndex = (index + 1) % s.anchors.length;
  const straight = isStraight(curve);
  const [left, right] = splitCubic(curve, t);
  const mid = left[3];
  const anchors = [...s.anchors];
  const a = anchors[index]!;
  const b = anchors[nextIndex]!;
  anchors[index] = { ...a, out: straight ? a.out : left[1] };
  anchors[nextIndex] = { ...b, in: straight ? b.in : right[2] };
  const created: Anchor = { x: mid.x, y: mid.y, in: straight ? null : left[2], out: straight ? null : right[1], mirror: straight ? 'none' : 'angle' };
  anchors.splice(index + 1, 0, created);
  return { path: path.map((x, i) => (i === sub ? { ...x, anchors } : x)), ref: { sub, index: index + 1, part: 'anchor' } };
}

/** Remove anchors; a subpath with fewer than two anchors left is removed. */
export function deleteAnchors(path: VectorPath, refs: readonly PointRef[]): VectorPath {
  const remove = new Set(refs.filter((r) => r.part === 'anchor').map((r) => `${r.sub}:${r.index}`));
  const handles = refs.filter((r) => r.part !== 'anchor');
  let next: VectorPath = path.map((s, si) => ({ ...s, anchors: s.anchors.filter((_, ai) => !remove.has(`${si}:${ai}`)) }));
  // Deleting a handle makes that side straight.
  for (const h of handles) if (!remove.has(`${h.sub}:${h.index}`)) next = replaceAnchor(next, h.sub, h.index, (a) => ({ ...a, [h.part]: null, mirror: 'none' }) as Anchor);
  return next.filter((s) => s.anchors.length >= 2).map((s) => (s.anchors.length < 3 ? { ...s, closed: false } : s));
}

/**
 * Bend a segment so it passes through `to` at parameter t (Figma's ⌘-drag): moves both
 * control handles by the amount that puts B(t) on the pointer.
 */
export function bendSegment(path: VectorPath, sub: number, index: number, t: number, to: Point): VectorPath {
  const s = path[sub]!;
  const c = segmentCurve(s, index)!;
  const at = pointAt(c, t);
  const d = { x: to.x - at.x, y: to.y - at.y };
  // B(t) moves by (b1 + b2) · k when both handles move by k·d, with b1 = 3(1-t)²t, b2 = 3(1-t)t².
  const weight = 3 * (1 - t) * (1 - t) * t + 3 * (1 - t) * t * t;
  const k = weight > EPS ? 1 / weight : 0;
  const move = { x: d.x * k, y: d.y * k };
  const nextIndex = (index + 1) % s.anchors.length;
  let next = replaceAnchor(path, sub, index, (a) => ({ ...a, out: add(c[1], move), mirror: a.in ? a.mirror : 'none' }));
  next = replaceAnchor(next, sub, nextIndex, (b) => ({ ...b, in: add(c[2], move), mirror: b.out ? b.mirror : 'none' }));
  return next;
}

/** Points of one anchor in a ref list. */
export function anchorRefs(refs: readonly PointRef[]): PointRef[] {
  const seen = new Set<string>();
  return refs
    .map((r) => ({ sub: r.sub, index: r.index, part: 'anchor' as const }))
    .filter((r) => {
      const key = `${r.sub}:${r.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function refPoint(path: VectorPath, ref: PointRef): Point | null {
  const a = path[ref.sub]?.anchors[ref.index];
  if (!a) return null;
  return ref.part === 'anchor' ? a : a[ref.part];
}

export function bounds(path: VectorPath): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of path) {
    for (let i = 0; i < segmentCount(s); i++) {
      const c = segmentCurve(s, i)!;
      for (let k = 0; k <= 16; k++) {
        const p = pointAt(c, k / 16);
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    for (const a of s.anchors) {
      minX = Math.min(minX, a.x);
      minY = Math.min(minY, a.y);
      maxX = Math.max(maxX, a.x);
      maxY = Math.max(maxY, a.y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

// --- shapes → paths ---------------------------------------------------------------------------

const K = 0.5522847498; // circle-by-cubics handle length ratio

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const a = (x: number, y: number, inx: number, iny: number, outx: number, outy: number): Anchor => ({ x, y, in: { x: inx, y: iny }, out: { x: outx, y: outy }, mirror: 'angle-length' });
  return serializePath([
    {
      closed: true,
      anchors: [
        a(cx, cy - ry, cx - rx * K, cy - ry, cx + rx * K, cy - ry),
        a(cx + rx, cy, cx + rx, cy - ry * K, cx + rx, cy + ry * K),
        a(cx, cy + ry, cx + rx * K, cy + ry, cx - rx * K, cy + ry),
        a(cx - rx, cy, cx - rx, cy + ry * K, cx - rx, cy - ry * K),
      ],
    },
  ]);
}

/** Path data equivalent to an SVG basic shape (rect, circle, ellipse, line, polyline, polygon). */
export function shapeToPathData(tag: string, attrs: Readonly<Record<string, string>>): string | null {
  const n = (k: string, d = 0) => {
    const v = parseFloat(attrs[k] ?? '');
    return Number.isFinite(v) ? v : d;
  };
  switch (tag) {
    case 'rect': {
      const x = n('x');
      const y = n('y');
      const w = n('width');
      const h = n('height');
      let rx = Math.min(n('rx', n('ry')), w / 2);
      let ry = Math.min(n('ry', n('rx')), h / 2);
      if (!rx || !ry) {
        rx = 0;
        ry = 0;
      }
      if (!rx) return `M${num(x)} ${num(y)}H${num(x + w)}V${num(y + h)}H${num(x)}Z`;
      const kx = rx * (1 - K);
      const ky = ry * (1 - K);
      return (
        `M${num(x + rx)} ${num(y)}H${num(x + w - rx)}C${num(x + w - kx)} ${num(y)} ${num(x + w)} ${num(y + ky)} ${num(x + w)} ${num(y + ry)}` +
        `V${num(y + h - ry)}C${num(x + w)} ${num(y + h - ky)} ${num(x + w - kx)} ${num(y + h)} ${num(x + w - rx)} ${num(y + h)}` +
        `H${num(x + rx)}C${num(x + kx)} ${num(y + h)} ${num(x)} ${num(y + h - ky)} ${num(x)} ${num(y + h - ry)}` +
        `V${num(y + ry)}C${num(x)} ${num(y + ky)} ${num(x + kx)} ${num(y)} ${num(x + rx)} ${num(y)}Z`
      );
    }
    case 'circle':
      return ellipsePath(n('cx'), n('cy'), n('r'), n('r'));
    case 'ellipse':
      return ellipsePath(n('cx'), n('cy'), n('rx'), n('ry'));
    case 'line':
      return `M${num(n('x1'))} ${num(n('y1'))}L${num(n('x2'))} ${num(n('y2'))}`;
    case 'polyline':
    case 'polygon': {
      const values = (attrs.points ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (values.length < 4) return null;
      let d = `M${num(values[0]!)} ${num(values[1]!)}`;
      for (let i = 2; i + 1 < values.length; i += 2) d += `L${num(values[i]!)} ${num(values[i + 1]!)}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    default:
      return null;
  }
}

/** Geometry attributes a basic shape stops needing once it's a path. */
export const SHAPE_GEOMETRY_ATTRS: Readonly<Record<string, readonly string[]>> = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
};

// --- corner radius -----------------------------------------------------------------------------

/**
 * Per-point radii are kept beside the path: `data-pl-radius="sub:index:r,…"` on the element, with
 * the un-rounded points in `data-pl-d`; `d` holds the rounded result the browser draws.
 */
export function serializeRadii(path: VectorPath): string {
  const parts: string[] = [];
  path.forEach((s, sub) => s.anchors.forEach((a, i) => a.radius && a.radius > 0 && parts.push(`${sub}:${i}:${num(a.radius)}`)));
  return parts.join(',');
}

export function applyRadii(path: VectorPath, radii: string | undefined): VectorPath {
  if (!radii) return path;
  const map = new Map<string, number>();
  for (const part of radii.split(',')) {
    const [sub, index, r] = part.split(':').map(Number);
    if (Number.isFinite(sub) && Number.isFinite(index) && Number.isFinite(r) && r! > 0) map.set(`${sub}:${index}`, r!);
  }
  return path.map((s, sub) => ({ ...s, anchors: s.anchors.map((a, i) => (map.has(`${sub}:${i}`) ? { ...a, radius: map.get(`${sub}:${i}`) } : a)) }));
}

export const hasRadii = (path: VectorPath) => path.some((s) => s.anchors.some((a) => (a.radius ?? 0) > 0));

/**
 * The drawn path: each rounded corner becomes two points joined by a circular arc (as a cubic),
 * cut back along both straight segments — at most half of either, like Figma.
 */
export function roundCorners(path: VectorPath): VectorPath {
  return path.map((s) => {
    const n = s.anchors.length;
    if (n < 3 && !s.closed) return s;
    const out: Anchor[] = [];
    s.anchors.forEach((a, i) => {
      const r = a.radius ?? 0;
      const hasPrev = i > 0 || s.closed;
      const hasNext = i < n - 1 || s.closed;
      const prev = s.anchors[(i - 1 + n) % n]!;
      const next = s.anchors[(i + 1) % n]!;
      // Only corners between straight segments are rounded.
      const straight = !a.in && !a.out && !prev.out && !next.in;
      if (!r || !hasPrev || !hasNext || !straight) {
        out.push({ ...a, radius: undefined });
        return;
      }
      const toPrev = { x: prev.x - a.x, y: prev.y - a.y };
      const toNext = { x: next.x - a.x, y: next.y - a.y };
      const lp = Math.hypot(toPrev.x, toPrev.y);
      const ln = Math.hypot(toNext.x, toNext.y);
      if (lp < EPS || ln < EPS) {
        out.push({ ...a, radius: undefined });
        return;
      }
      const up = { x: toPrev.x / lp, y: toPrev.y / lp };
      const un = { x: toNext.x / ln, y: toNext.y / ln };
      const cos = Math.max(-1, Math.min(1, up.x * un.x + up.y * un.y));
      const angle = Math.acos(cos); // interior angle at the corner
      if (angle < 1e-3 || Math.PI - angle < 1e-3) {
        out.push({ ...a, radius: undefined });
        return;
      }
      // Distance from the corner to where the arc starts, capped at half of each segment.
      const maxCut = Math.min(lp, ln) / 2;
      let cut = r / Math.tan(angle / 2);
      const radius = cut > maxCut ? maxCut * Math.tan(angle / 2) : r;
      cut = Math.min(cut, maxCut);
      const turn = Math.PI - angle;
      const k = (4 / 3) * Math.tan(turn / 4) * radius;
      const p1 = { x: a.x + up.x * cut, y: a.y + up.y * cut };
      const p2 = { x: a.x + un.x * cut, y: a.y + un.y * cut };
      out.push({ x: p1.x, y: p1.y, in: null, out: { x: p1.x - up.x * k, y: p1.y - up.y * k }, mirror: 'none' });
      out.push({ x: p2.x, y: p2.y, in: { x: p2.x - un.x * k, y: p2.y - un.y * k }, out: null, mirror: 'none' });
    });
    return { ...s, anchors: out };
  });
}

export function setRadius(path: VectorPath, refs: readonly PointRef[], radius: number): VectorPath {
  const keys = new Set(refs.filter((r) => r.part === 'anchor').map((r) => `${r.sub}:${r.index}`));
  return path.map((s, sub) => ({ ...s, anchors: s.anchors.map((a, i) => (keys.has(`${sub}:${i}`) ? { ...a, radius: radius > 0 ? radius : undefined } : a)) }));
}
