/**
 * Vector edit mode: entering and leaving it, reading and writing the edited path, and mapping
 * between the path's own coordinates and the canvas screen (through the artboard iframe, the
 * svg's viewBox, any transforms, and the zoom — whatever the browser applies, via getScreenCTM).
 */
import { instantiate, type NodeSpec } from '../document/factory.ts';
import { insertChild, insertRoot, removeNodes, setAttribute, setFrame, setStyleOnNodes, setTag } from '../document/ops.ts';
import { getElement, getParentId } from '../document/tree.ts';
import type { DesignDocument, NodeId, Point } from '../document/types.ts';
import { activeRoots, useEditor, type VectorEdit } from '../editor/store.ts';
import { screenToWorld } from '../canvas/coords.ts';
import { clientRectOf, domElement, styleOf, toScreen } from '../canvas/dom.ts';
import { containerAt } from '../canvas/layout.ts';
import { SHAPE_GEOMETRY_ATTRS, parsePath, serializePath, shapeToPathData, type PointRef, type VectorPath } from './path.ts';

const editor = () => useEditor.getState();
const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** Shapes inside an svg that can be edited as paths. */
export const EDITABLE_SHAPES: ReadonlySet<string> = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

/** The outermost <svg> containing `id` (or `id` itself), if any. */
export function vectorRootOf(doc: DesignDocument, id: NodeId | null | undefined): NodeId | null {
  let found: NodeId | null = null;
  let current: NodeId | null = id ?? null;
  while (current) {
    if (getElement(doc, current)?.tag === 'svg') found = current;
    current = getParentId(doc, current);
  }
  return found;
}

/** Every editable shape inside an svg, in document order. */
function shapesIn(doc: DesignDocument, id: NodeId): NodeId[] {
  const el = getElement(doc, id);
  if (!el) return [];
  if (EDITABLE_SHAPES.has(el.tag)) return [id];
  return el.children.flatMap((c) => shapesIn(doc, c));
}

/**
 * The path to edit for a click on `hit`: the shape itself, or the only shape of its svg.
 * Returns null when it's ambiguous (an icon of many shapes clicked on its background).
 */
export function vectorTargetFor(doc: DesignDocument, hit: NodeId): NodeId | null {
  const el = getElement(doc, hit);
  if (!el) return null;
  if (EDITABLE_SHAPES.has(el.tag) && vectorRootOf(doc, hit)) return hit;
  const root = vectorRootOf(doc, hit);
  if (!root) return null;
  const shapes = shapesIn(doc, root);
  return shapes.length === 1 ? shapes[0]! : null;
}

export function readPath(doc: DesignDocument, id: NodeId): VectorPath {
  const el = getElement(doc, id);
  return el?.tag === 'path' ? parsePath(el.attrs.d ?? '') : [];
}

export function writePath(doc: DesignDocument, id: NodeId, path: VectorPath): DesignDocument {
  return setAttribute(doc, id, 'd', serializePath(path));
}

/** Turn a basic shape into an equivalent <path> (editing needs points). */
function asPath(doc: DesignDocument, id: NodeId): DesignDocument {
  const el = getElement(doc, id);
  if (!el || el.tag === 'path') return doc;
  const d = shapeToPathData(el.tag, el.attrs);
  if (!d) return doc;
  let next = setTag(doc, id, 'path');
  for (const attr of SHAPE_GEOMETRY_ATTRS[el.tag] ?? []) next = setAttribute(next, id, attr, null);
  // Polygon/star parameters no longer describe a free-form path.
  for (const attr of ['data-pl-sides', 'data-pl-ratio']) next = setAttribute(next, id, attr, null);
  return setAttribute(next, id, 'd', d);
}

export function enterVectorEdit(id: NodeId, options: Partial<Omit<VectorEdit, 'id'>> = {}): void {
  const doc = editor().doc;
  const el = getElement(doc, id);
  if (!el || !EDITABLE_SHAPES.has(el.tag)) return;
  if (el.tag !== 'path') editor().apply('Convert to path', (d) => asPath(d, id));
  const root = vectorRootOf(editor().doc, id);
  editor().setEditingText(null);
  editor().select(root ? [root] : [id]);
  editor().setVectorEdit({ id, points: options.points ?? [], drawing: options.drawing ?? null });
}

/** Leave vector edit mode; the svg's box is tightened around what was drawn. */
export function exitVectorEdit(): void {
  const edit = editor().vectorEdit;
  if (!edit) return;
  editor().setVectorEdit(null);
  if (editor().tool.kind === 'pen') editor().setTool({ kind: 'select' });
  const doc = editor().doc;
  if (!getElement(doc, edit.id)) return;
  // A path with no segments left is removed (with its svg if that's now empty).
  if (!readPath(doc, edit.id).some((s) => s.anchors.length >= 2)) {
    const root = vectorRootOf(doc, edit.id);
    const svg = root ? getElement(doc, root) : null;
    const target = svg && svg.children.length === 1 ? root! : edit.id;
    editor().apply('Delete vector', (d) => removeNodes(d, [target]), { select: [] });
    return;
  }
  const root = vectorRootOf(doc, edit.id);
  if (root) fitSvg(root);
}

// --- coordinates ------------------------------------------------------------------------------

/** Path user space → canvas screen space for the edited element, measured now. */
export function userToScreenMatrix(id: NodeId): DOMMatrix | null {
  const el = domElement(id) as unknown as SVGGraphicsElement | null;
  const ctm = el?.getScreenCTM?.();
  if (!el || !ctm) return null;
  const frame = el.ownerDocument.defaultView?.frameElement as HTMLIFrameElement | null | undefined;
  const origin = toScreen(0, 0);
  if (!frame || el.ownerDocument === document) return new DOMMatrix([ctm.a, ctm.b, ctm.c, ctm.d, ctm.e + origin.x, ctm.f + origin.y]);
  const fr = frame.getBoundingClientRect();
  const scale = frame.offsetWidth ? fr.width / frame.offsetWidth : 1;
  const toEditor = new DOMMatrix([scale, 0, 0, scale, fr.left + frame.clientLeft * scale + origin.x, fr.top + frame.clientTop * scale + origin.y]);
  return toEditor.multiply(new DOMMatrix([ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f]));
}

export function apply(m: DOMMatrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** A pointer position (client coordinates) in the edited path's user space. */
export function clientToUser(id: NodeId, clientX: number, clientY: number): Point | null {
  const m = userToScreenMatrix(id);
  if (!m) return null;
  return apply(m.inverse(), toScreen(clientX, clientY));
}

/** A screen-space vector (e.g. a drag) in user units. */
export function screenDeltaToUser(id: NodeId, d: Point): Point | null {
  const m = userToScreenMatrix(id);
  if (!m) return null;
  const inv = m.inverse();
  return { x: inv.a * d.x + inv.c * d.y, y: inv.b * d.x + inv.d * d.y };
}

// --- creating vectors (pen) -------------------------------------------------------------------

/** A new, empty vector (svg + path) at a pointer position, ready for the pen. Returns the path id. */
export function createVectorAt(clientX: number, clientY: number): NodeId | null {
  const { doc, viewport } = editor();
  const container = containerAt(doc, clientX, clientY);
  let pathId: NodeId = '';
  const spec = (left: number, top: number, root: boolean): NodeSpec => ({
    tag: 'svg',
    className: 'vector',
    attrs: { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 1 1', fill: 'none' },
    style: root
      ? { width: '1px', height: '1px', overflow: 'visible' }
      : { position: 'absolute', left: px(left), top: px(top), width: '1px', height: '1px', overflow: 'visible' },
    children: [{ tag: 'path', attrs: { d: 'M0 0', stroke: '#000000', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } }],
  });

  if (!container) {
    const world = screenToWorld(toScreen(clientX, clientY), viewport);
    editor().apply('Add vector', (d) => {
      const made = instantiate(d, spec(0, 0, true));
      pathId = getElement(made.doc, made.id)!.children[0]!;
      return setFrame(insertRoot(made.doc, editor().activePage, activeRoots(editor()).length, made.id), made.id, world);
    });
  } else {
    const el = domElement(container.id)!;
    const r = clientRectOf(el);
    const left = (clientX - r.left) / viewport.zoom - el.clientLeft;
    const top = (clientY - r.top) / viewport.zoom - el.clientTop;
    const needsPositioning = styleOf(el).position === 'static';
    editor().apply('Add vector', (d) => {
      const made = instantiate(d, spec(left, top, false));
      pathId = getElement(made.doc, made.id)!.children[0]!;
      let next = insertChild(made.doc, container.id, container.children.length, made.id);
      if (needsPositioning) next = setStyleOnNodes(next, [container.id], 'position', 'relative');
      return next;
    });
  }
  return pathId || null;
}

/**
 * Fit an svg's box to its drawing: the viewBox becomes the drawing's bounds (plus room for the
 * stroke), the CSS size follows at the same scale, and a freely positioned svg shifts so nothing
 * moves on screen.
 */
export function fitSvg(svgId: NodeId): void {
  const svg = domElement(svgId) as unknown as SVGSVGElement | null;
  if (!svg?.getBBox) return;
  let box: DOMRect;
  try {
    box = svg.getBBox();
  } catch {
    return;
  }
  if (!box.width && !box.height) return;
  const doc = editor().doc;
  const el = getElement(doc, svgId);
  if (!el) return;
  const vb = (el.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite) ? (vb as [number, number, number, number]) : [0, 0, svg.clientWidth || 1, svg.clientHeight || 1];
  const cs = styleOf(svg as unknown as Element);
  const cssW = parseFloat(cs.width) || vw;
  const cssH = parseFloat(cs.height) || vh;
  const sx = vw ? cssW / vw : 1;
  const sy = vh ? cssH / vh : 1;
  // Room for strokes, which getBBox leaves out.
  let pad = 0;
  svg.querySelectorAll('*').forEach((child) => {
    const w = parseFloat(styleOf(child).strokeWidth);
    if (styleOf(child).stroke !== 'none' && Number.isFinite(w)) pad = Math.max(pad, w / 2);
  });
  const nx = box.x - pad;
  const ny = box.y - pad;
  const nw = Math.max(box.width + pad * 2, 1);
  const nh = Math.max(box.height + pad * 2, 1);
  const round = (n: number) => Math.round(n * 100) / 100;
  const free = cs.position === 'absolute' || cs.position === 'fixed';
  const root = !getParentId(doc, svgId);
  const left = parseFloat(cs.left) || 0;
  const top = parseFloat(cs.top) || 0;
  const frame = doc.frames[svgId] ?? { x: 0, y: 0 };
  const same = round(nx) === round(vx) && round(ny) === round(vy) && round(nw) === round(vw) && round(nh) === round(vh);
  if (same) return;
  editor().apply('Fit vector', (d) => {
    let next = setAttribute(d, svgId, 'viewBox', `${round(nx)} ${round(ny)} ${round(nw)} ${round(nh)}`);
    next = setStyleOnNodes(next, [svgId], 'width', px(nw * sx));
    next = setStyleOnNodes(next, [svgId], 'height', px(nh * sy));
    if (el.attrs.width !== undefined) next = setAttribute(next, svgId, 'width', String(round(nw * sx)));
    if (el.attrs.height !== undefined) next = setAttribute(next, svgId, 'height', String(round(nh * sy)));
    if (free) {
      next = setStyleOnNodes(next, [svgId], 'left', px(left + (nx - vx) * sx));
      next = setStyleOnNodes(next, [svgId], 'top', px(top + (ny - vy) * sy));
    } else if (root) {
      next = setFrame(next, svgId, { x: frame.x + (nx - vx) * sx, y: frame.y + (ny - vy) * sy });
    }
    return next;
  });
}

/** Keep point refs valid after the path changed shape (undo, deletes). */
export function validRefs(path: VectorPath, refs: readonly PointRef[]): PointRef[] {
  return refs.filter((r) => {
    const a = path[r.sub]?.anchors[r.index];
    return !!a && (r.part === 'anchor' || !!a[r.part]);
  });
}
