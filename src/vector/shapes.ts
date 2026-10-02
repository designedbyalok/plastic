/**
 * Shape tools: rectangle, ellipse, line, arrow, polygon, star.
 *
 * Rectangles and ellipses are boxes (a div with a fill; the ellipse is `border-radius: 50%`), like
 * Figma rectangles become on import, so Fill, Radius, Border and Shadow all apply and resizing
 * keeps the radius. Lines, arrows, polygons and stars are SVG that stretches with its box
 * (preserveAspectRatio="none") while strokes keep their width; polygons and stars record their
 * parameters (data-pl-sides, data-pl-ratio) so they can be edited later.
 */
import { instantiate, type NodeSpec } from '../document/factory.ts';
import { insertChild, insertRoot, setFrame, setStyleOnNodes } from '../document/ops.ts';
import type { DesignDocument, NodeId, Point } from '../document/types.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import { rectFromPoints, screenToWorld, type Rect } from '../canvas/coords.ts';
import { clientRectOf, domElement, nodeIdAt, styleOf, toScreen } from '../canvas/dom.ts';
import { clearGuides, collectTargets, snapPoint, toClient } from '../canvas/snap.ts';
import { trackPointer, transactional } from '../canvas/gestures.ts';
import { containerAt } from '../canvas/layout.ts';

export type ShapeKind = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'star';

export const SHAPES: readonly { kind: ShapeKind; label: string; shortcut?: string }[] = [
  { kind: 'rectangle', label: 'Rectangle', shortcut: 'R' },
  { kind: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { kind: 'line', label: 'Line', shortcut: '⇧L' },
  { kind: 'arrow', label: 'Arrow' },
  { kind: 'polygon', label: 'Polygon' },
  { kind: 'star', label: 'Star' },
];

/** Figma's defaults: light grey fill, 100 × 100 on a plain click. */
const FILL = '#d9d9d9';
const STROKE = '#000000';
const DEFAULT_SIZE = 100;
export const DEFAULT_SIDES = 3;
export const DEFAULT_STAR_POINTS = 5;
export const DEFAULT_STAR_RATIO = 0.382;

const round = (n: number) => Math.round(n * 100) / 100;
const px = (n: number) => `${round(n)}px`;

// --- geometry ----------------------------------------------------------------------------------

/** Points around a circle (first at the top), then stretched to exactly fill w × h. */
function fitPoints(points: Point[], w: number, h: number): Point[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  return points.map((p) => ({ x: round(((p.x - minX) / spanX) * w), y: round(((p.y - minY) / spanY) * h) }));
}

export function polygonPoints(sides: number, w: number, h: number): Point[] {
  const n = Math.max(3, Math.round(sides));
  const points = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
  return fitPoints(points, w, h);
}

export function starPoints(count: number, ratio: number, w: number, h: number): Point[] {
  const n = Math.max(3, Math.round(count));
  const points = Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? ratio : 1;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  return fitPoints(points, w, h);
}

const pointsAttr = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(' ');

// --- elements ----------------------------------------------------------------------------------

interface Placement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** The shape is a canvas root (no container): no position styles; the frame holds it. */
  readonly root: boolean;
}

function boxStyle(p: Placement, extra: Record<string, string>): Record<string, string> {
  return p.root
    ? { width: px(p.width), height: px(p.height), ...extra }
    : { position: 'absolute', left: px(p.left), top: px(p.top), width: px(p.width), height: px(p.height), ...extra };
}

/**
 * The element for a shape in a box. `from`/`to` (box-relative) give lines and arrows their
 * direction; the box is their bounds.
 */
export function shapeSpec(kind: ShapeKind, p: Placement, from: Point, to: Point): NodeSpec {
  const w = Math.max(p.width, 1);
  const h = Math.max(p.height, 1);
  const svg = (className: string, children: NodeSpec[], extra: Record<string, string> = {}): NodeSpec => ({
    tag: 'svg',
    className,
    attrs: { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${round(w)} ${round(h)}`, preserveAspectRatio: 'none', fill: 'none', ...extra },
    style: boxStyle({ ...p, width: w, height: h }, { overflow: 'visible' }),
    children,
  });
  const stroke = { stroke: STROKE, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
  switch (kind) {
    case 'rectangle':
      return { tag: 'div', className: 'rectangle', style: boxStyle(p, { background: FILL }) };
    case 'ellipse':
      return { tag: 'div', className: 'ellipse', style: boxStyle(p, { background: FILL, 'border-radius': '50%' }) };
    case 'line':
      return svg('line', [{ tag: 'line', attrs: { x1: String(round(from.x)), y1: String(round(from.y)), x2: String(round(to.x)), y2: String(round(to.y)), ...stroke } }]);
    case 'arrow': {
      // A shaft and an open arrowhead at `to`, one path (editable as points later).
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.min(12, Math.hypot(to.x - from.x, to.y - from.y) / 2);
      const wing = (side: number) => ({ x: to.x - head * Math.cos(angle + side * (Math.PI / 6)), y: to.y - head * Math.sin(angle + side * (Math.PI / 6)) });
      const a = wing(1);
      const b = wing(-1);
      const d = `M${round(from.x)} ${round(from.y)}L${round(to.x)} ${round(to.y)}M${round(a.x)} ${round(a.y)}L${round(to.x)} ${round(to.y)}L${round(b.x)} ${round(b.y)}`;
      return svg('arrow', [{ tag: 'path', attrs: { d, ...stroke } }]);
    }
    case 'polygon':
      return svg('polygon', [{ tag: 'polygon', attrs: { points: pointsAttr(polygonPoints(DEFAULT_SIDES, w, h)), fill: FILL, 'data-pl-sides': String(DEFAULT_SIDES) } }]);
    case 'star':
      return svg('star', [
        {
          tag: 'polygon',
          attrs: { points: pointsAttr(starPoints(DEFAULT_STAR_POINTS, DEFAULT_STAR_RATIO, w, h)), fill: FILL, 'data-pl-sides': String(DEFAULT_STAR_POINTS), 'data-pl-ratio': String(DEFAULT_STAR_RATIO) },
        },
      ]);
  }
}

// --- drawing -----------------------------------------------------------------------------------

const editor = () => useEditor.getState();

/**
 * The rect a drag describes, Figma-style: Shift keeps it square (circles, 45° lines), Alt draws
 * from the center. Lines keep their direction in `from` → `to`.
 */
export function dragRect(kind: ShapeKind, a: Point, b: Point, shift: boolean, alt: boolean): { rect: Rect; from: Point; to: Point } {
  let to = b;
  const line = kind === 'line' || kind === 'arrow';
  if (shift) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (line) {
      const len = Math.hypot(dx, dy);
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      to = { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
    } else {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      to = { x: a.x + Math.sign(dx || 1) * size, y: a.y + Math.sign(dy || 1) * size };
    }
  }
  const from = alt ? { x: 2 * a.x - to.x, y: 2 * a.y - to.y } : a;
  return { rect: rectFromPoints(from, to), from, to };
}

/** Where a shape drawn from `clientStart` goes: the container under it, or the canvas. */
function target(clientX: number, clientY: number) {
  const { doc, viewport } = editor();
  const container = containerAt(doc, clientX, clientY);
  if (!container) return { container: null, toLocal: (cx: number, cy: number) => screenToWorld(toScreen(cx, cy), viewport) };
  const el = domElement(container.id)!;
  const r = clientRectOf(el);
  return {
    container,
    needsPositioning: styleOf(el).position === 'static',
    toLocal: (cx: number, cy: number) => ({ x: (cx - r.left) / viewport.zoom - el.clientLeft, y: (cy - r.top) / viewport.zoom - el.clientTop }),
  };
}

function place(doc: DesignDocument, kind: ShapeKind, where: ReturnType<typeof target>, rect: Rect, from: Point, to: Point): { doc: DesignDocument; id: NodeId } {
  const placement: Placement = { left: rect.x, top: rect.y, width: rect.width, height: rect.height, root: !where.container };
  const local = (p: Point) => ({ x: p.x - rect.x, y: p.y - rect.y });
  const made = instantiate(doc, shapeSpec(kind, placement, local(from), local(to)));
  const label = SHAPES.find((s) => s.kind === kind)!.label;
  let next = { ...made.doc, names: { ...made.doc.names, [made.id]: label } };
  if (!where.container) {
    next = setFrame(insertRoot(next, editor().activePage, activeRoots(editor()).length, made.id), made.id, { x: rect.x, y: rect.y });
  } else {
    next = insertChild(next, where.container.id, where.container.children.length, made.id);
    if (where.needsPositioning) next = setStyleOnNodes(next, [where.container.id], 'position', 'relative');
  }
  return { doc: next, id: made.id };
}

/** Drag (or click) with a shape tool. The whole draw is one undo step; then back to Move. */
export function startShapeDraw(e: PointerEvent, kind: ShapeKind): void {
  const targets = collectTargets(nodeIdAt(e.clientX, e.clientY), []);
  const snapClient = (cx: number, cy: number, show: boolean) => toClient(snapPoint(toScreen(cx, cy), targets, show));
  const first = snapClient(e.clientX, e.clientY, false);
  const where = target(first.x, first.y);
  const start = where.toLocal(first.x, first.y);
  const tx = transactional();
  let created: NodeId | null = null;
  const draw = (rect: Rect, from: Point, to: Point) =>
    tx.preview((base) => {
      const made = place(base, kind, where, rect, from, to);
      created = made.id;
      return made.doc;
    });
  const finish = (label: string) => {
    tx.commit(label, created ? [created] : undefined);
    editor().setTool({ kind: 'select' });
  };
  trackPointer(e, {
    threshold: 2,
    move(ev) {
      const at = snapClient(ev.clientX, ev.clientY, true);
      const { rect, from, to } = dragRect(kind, start, where.toLocal(at.x, at.y), ev.shiftKey, ev.altKey);
      draw(rect, from, to);
      if (created) editor().select([created]);
    },
    end(ev, moved) {
      clearGuides();
      const label = `Add ${SHAPES.find((s) => s.kind === kind)!.label.toLowerCase()}`;
      if (!moved) {
        // A click places the default size there (lines run left to right).
        const line = kind === 'line' || kind === 'arrow';
        const rect = { x: start.x, y: start.y, width: DEFAULT_SIZE, height: line ? 0 : DEFAULT_SIZE };
        draw(rect, start, { x: start.x + DEFAULT_SIZE, y: start.y });
      } else {
        const at = snapClient(ev.clientX, ev.clientY, false);
        const { rect, from, to } = dragRect(kind, start, where.toLocal(at.x, at.y), ev.shiftKey, ev.altKey);
        draw(rect, from, to);
      }
      finish(label);
    },
    cancel: () => {
      clearGuides();
      tx.cancel();
      editor().setTool({ kind: 'select' });
    },
  });
}
