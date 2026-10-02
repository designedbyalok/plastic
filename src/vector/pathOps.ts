/**
 * Path operations on the selection, like Figma's: Union, Subtract, Intersect, Exclude, Flatten and
 * Outline stroke. Operands are vectors (svg) and plain boxes (a childless div — rectangles and
 * ellipses, with their corner radius). Their geometry is read from the live DOM into the parent's
 * coordinate space, combined, and replaced by one new vector at the same place: one undo step.
 * The result is styled like the bottom-most operand (Figma does the same).
 */
import SvgPath from 'svgpath';
import { instantiate, type NodeSpec } from '../document/factory.ts';
import { insertChild, removeNodes, setAttribute, setStyleOnNodes } from '../document/ops.ts';
import { getElement, getParentId, isRoot } from '../document/tree.ts';
import type { DesignDocument, NodeId } from '../document/types.ts';
import { useEditor } from '../editor/store.ts';
import { domElement, styleOf } from '../canvas/dom.ts';
import { notify } from '../canvas/gestureStore.ts';
import { EDITABLE_SHAPES, gradientOf } from './edit.ts';
import { parseCssGradient, svgGradientSpec, type Gradient } from '../paint/gradient.ts';
import { shapeToPathData } from './path.ts';
import { booleanPaths, outlineStroke, pathBounds, type BooleanOp } from './booleans.ts';

export type PathOp = BooleanOp | 'flatten';

export const PATH_OP_LABELS: Record<PathOp, string> = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude', flatten: 'Flatten' };

const editor = () => useEditor.getState();
const round = (n: number) => Math.round(n * 100) / 100;
const px = (n: number) => `${round(n)}px`;
const K = 0.5522847498;

function shapesUnder(doc: DesignDocument, id: NodeId): NodeId[] {
  const el = getElement(doc, id);
  if (!el) return [];
  if (EDITABLE_SHAPES.has(el.tag)) return [id];
  return el.children.flatMap((c) => shapesUnder(doc, c));
}

/** Can this element be an operand: a whole vector, or a childless box (rectangle, ellipse)? */
function operandKind(doc: DesignDocument, id: NodeId): 'vector' | 'box' | null {
  const el = getElement(doc, id);
  if (!el || isRoot(doc, id)) return null;
  if (el.tag === 'svg') return shapesUnder(doc, id).length ? 'vector' : null;
  if (el.tag === 'div' && !el.children.some((c) => doc.nodes[c]?.kind === 'element')) return 'box';
  return null;
}

/** What the current selection can do. */
export function pathOpsFor(doc: DesignDocument, ids: readonly NodeId[]): { booleans: boolean; flatten: boolean; outline: boolean } {
  const kinds = ids.map((id) => operandKind(doc, id));
  if (!ids.length || kinds.some((k) => !k)) return { booleans: false, flatten: false, outline: false };
  const stroked = ids.some((id) => shapesUnder(doc, id).some((s) => hasStroke(doc, s)));
  return {
    booleans: ids.length >= 2,
    flatten: ids.length >= 2 || kinds[0] === 'box' || shapesUnder(doc, ids[0]!).length > 1,
    outline: ids.length === 1 && kinds[0] === 'vector' && stroked,
  };
}

function hasStroke(doc: DesignDocument, id: NodeId): boolean {
  for (let current: NodeId | null = id; current; current = getParentId(doc, current)) {
    const v = getElement(doc, current)?.attrs.stroke;
    if (v !== undefined) return v !== 'none' && v !== '';
    if (getElement(doc, current)?.tag === 'svg') break;
  }
  return false;
}

// --- geometry from the DOM --------------------------------------------------------------------

interface Operand {
  readonly id: NodeId;
  /** Path data in the parent's padding-box coordinates (CSS px). */
  readonly d: string;
  readonly paint: Record<string, string>;
  /** A gradient fill, carried into the result's own <defs> (the original lives in its source svg). */
  readonly gradient: Gradient | null;
}

function radius(value: string, size: number): number {
  const first = value.trim().split(/\s+/)[0] ?? '0';
  const n = parseFloat(first);
  if (!Number.isFinite(n)) return 0;
  return first.endsWith('%') ? (n / 100) * size : n;
}

/** A box with (possibly different, possibly elliptical) corner radii as path data. */
function roundedBox(x: number, y: number, w: number, h: number, cs: CSSStyleDeclaration): string {
  const corner = (value: string) => {
    const parts = value.trim().split(/\s+/);
    return { rx: Math.min(radius(parts[0] ?? '0', w), w / 2), ry: Math.min(radius(parts[1] ?? parts[0] ?? '0', h), h / 2) };
  };
  const tl = corner(cs.borderTopLeftRadius);
  const tr = corner(cs.borderTopRightRadius);
  const br = corner(cs.borderBottomRightRadius);
  const bl = corner(cs.borderBottomLeftRadius);
  const n = (v: number) => round(v);
  let d = `M${n(x + tl.rx)} ${n(y)}H${n(x + w - tr.rx)}`;
  if (tr.rx && tr.ry) d += `C${n(x + w - tr.rx * (1 - K))} ${n(y)} ${n(x + w)} ${n(y + tr.ry * (1 - K))} ${n(x + w)} ${n(y + tr.ry)}`;
  d += `V${n(y + h - br.ry)}`;
  if (br.rx && br.ry) d += `C${n(x + w)} ${n(y + h - br.ry * (1 - K))} ${n(x + w - br.rx * (1 - K))} ${n(y + h)} ${n(x + w - br.rx)} ${n(y + h)}`;
  d += `H${n(x + bl.rx)}`;
  if (bl.rx && bl.ry) d += `C${n(x + bl.rx * (1 - K))} ${n(y + h)} ${n(x)} ${n(y + h - bl.ry * (1 - K))} ${n(x)} ${n(y + h - bl.ry)}`;
  d += `V${n(y + tl.ry)}`;
  if (tl.rx && tl.ry) d += `C${n(x)} ${n(y + tl.ry * (1 - K))} ${n(x + tl.rx * (1 - K))} ${n(y)} ${n(x + tl.rx)} ${n(y)}`;
  return `${d}Z`;
}

/** "rgb(99, 102, 241)" → "#6366f1"; a translucent color → hex plus its alpha. */
export function cssColorToHex(value: string): { hex: string; alpha: number } | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(value.trim());
  if (!m) return null;
  const hex = `#${[m[1], m[2], m[3]].map((n) => Math.round(Math.min(255, parseFloat(n!))).toString(16).padStart(2, '0')).join('')}`;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { hex, alpha: Math.round(a * 1000) / 1000 };
}

/** Set a paint attribute, turning computed rgb() colors into hex (and alpha into *-opacity). */
function putColor(out: Record<string, string>, attr: 'fill' | 'stroke', value: string): void {
  const color = cssColorToHex(value);
  if (!color) {
    out[attr] = value;
    return;
  }
  if (color.alpha === 0) {
    out[attr] = 'none';
    return;
  }
  out[attr] = color.hex;
  if (color.alpha < 1) out[`${attr}-opacity`] = String(color.alpha);
}

const PAINT_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray'] as const;

/** The paint a vector shape actually uses, as attributes for the result. */
function shapePaint(el: Element): Record<string, string> {
  const cs = styleOf(el);
  const out: Record<string, string> = {};
  for (const prop of PAINT_PROPS) {
    const v = cs.getPropertyValue(prop).trim();
    if (!v) continue;
    if (prop.endsWith('opacity') && v === '1') continue;
    if (prop === 'stroke-dasharray' && v === 'none') continue;
    if (prop === 'fill' || prop === 'stroke') putColor(out, prop, v);
    else out[prop] = v.replace(/px$/, '');
  }
  return out;
}

/** A box's fill (and border, as a stroke). */
function boxPaint(el: Element): Record<string, string> {
  const cs = styleOf(el);
  const out: Record<string, string> = {};
  const bg = cs.backgroundColor;
  if (!bg || bg === 'transparent') out.fill = 'none';
  else putColor(out, 'fill', bg);
  const bw = parseFloat(cs.borderTopWidth);
  if (bw > 0 && cs.borderTopStyle !== 'none') {
    putColor(out, 'stroke', cs.borderTopColor);
    out['stroke-width'] = String(bw);
  }
  return out;
}

function operandOf(doc: DesignDocument, id: NodeId, parent: HTMLElement): Operand | null {
  const el = domElement(id);
  if (!el) return null;
  const pr = parent.getBoundingClientRect();
  const ox = pr.left + parent.clientLeft;
  const oy = pr.top + parent.clientTop;
  if (operandKind(doc, id) === 'box') {
    const r = el.getBoundingClientRect();
    return { id, d: roundedBox(r.left - ox, r.top - oy, r.width, r.height, styleOf(el)), paint: boxPaint(el), gradient: parseCssGradient(styleOf(el).backgroundImage) };
  }
  const parts: string[] = [];
  let paint: Record<string, string> | null = null;
  let gradient: Gradient | null = null;
  for (const shapeId of shapesUnder(doc, id)) {
    const node = getElement(doc, shapeId)!;
    const shapeEl = domElement(shapeId) as unknown as SVGGraphicsElement | null;
    const ctm = shapeEl?.getScreenCTM?.();
    const raw = node.tag === 'path' ? node.attrs.d : shapeToPathData(node.tag, node.attrs);
    if (!shapeEl || !ctm || !raw) continue;
    parts.push(SvgPath(raw).matrix([ctm.a, ctm.b, ctm.c, ctm.d, ctm.e - ox, ctm.f - oy]).round(2).toString());
    if (!paint) {
      paint = shapePaint(shapeEl as unknown as Element);
      gradient = paint.fill ? gradientOf(doc, shapeId, paint.fill) : null;
    }
  }
  return parts.length ? { id, d: parts.join(''), paint: paint ?? { fill: '#000000' }, gradient } : null;
}

// --- running ----------------------------------------------------------------------------------

/** Run a boolean or Flatten on the selection. Resolves when the result is in the document. */
export async function runPathOp(op: PathOp): Promise<void> {
  const { doc, selection } = editor();
  const ids = selection.filter((id) => operandKind(doc, id));
  const can = pathOpsFor(doc, ids);
  if (op === 'flatten' ? !can.flatten : !can.booleans) return;
  const parentId = getParentId(doc, ids[0]!);
  const parentEl = domElement(parentId);
  if (!parentId || !parentEl) return;
  if (ids.some((id) => domElement(id)?.ownerDocument !== parentEl.ownerDocument)) {
    notify('Path operations work on shapes in the same artboard.');
    return;
  }
  // Bottom-most first: document order within the parent decides.
  const parent = getElement(doc, parentId)!;
  const order = (id: NodeId) => {
    const own = parent.children.indexOf(id);
    return own >= 0 ? own : Number.MAX_SAFE_INTEGER;
  };
  const sorted = [...ids].sort((a, b) => order(a) - order(b));
  const operands = sorted.map((id) => operandOf(doc, id, parentEl)).filter((o): o is Operand => !!o);
  if (!operands.length) return;

  const d = op === 'flatten' ? operands.map((o) => o.d).join('') : await booleanPaths(op, operands.map((o) => o.d));
  if (!d.trim()) {
    notify(`${PATH_OP_LABELS[op]} left nothing — the shapes don’t overlap.`);
    return;
  }
  const b = await pathBounds(d);
  const local = SvgPath(d).translate(-b.x, -b.y).round(2).toString();
  const w = Math.max(b.width, 1);
  const h = Math.max(b.height, 1);
  const label = PATH_OP_LABELS[op];
  const needsPositioning = styleOf(parentEl).position === 'static';
  const topIndex = Math.max(...sorted.map((id) => parent.children.indexOf(id)));
  const before = parent.children.slice(0, topIndex).filter((c) => sorted.includes(c)).length;
  let created: NodeId | null = null;
  // The result's paint, with a gradient fill re-created in its own <defs>.
  const base = operands[0]!;
  const gradientId = base.gradient ? `pl-gradient-${Math.random().toString(36).slice(2, 8)}` : null;
  const paint = gradientId ? { ...base.paint, fill: `url(#${gradientId})`, 'fill-opacity': undefined } : base.paint;
  const children: NodeSpec[] = [{ tag: 'path', attrs: Object.fromEntries(Object.entries({ d: local, ...paint }).filter((e): e is [string, string] => e[1] !== undefined)) }];
  if (gradientId) children.unshift({ tag: 'defs', children: [svgGradientSpec(base.gradient!, gradientId)] });

  editor().apply(
    label,
    (current) => {
      const made = instantiate(current, {
        tag: 'svg',
        className: op,
        attrs: { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${round(w)} ${round(h)}`, fill: 'none' },
        style: { position: 'absolute', left: px(b.x), top: px(b.y), width: px(w), height: px(h), overflow: 'visible' },
        children,
      });
      created = made.id;
      let next = removeNodes(made.doc, sorted);
      next = insertChild(next, parentId, Math.max(0, topIndex - before), made.id);
      next = { ...next, names: { ...next.names, [made.id]: label } };
      if (needsPositioning) next = setStyleOnNodes(next, [parentId], 'position', 'relative');
      return next;
    },
    {},
  );
  if (created) editor().select([created]);
}

/**
 * Outline stroke: every stroked shape of the selected vector gets its stroke turned into a filled
 * outline (in the same svg, right above it). The shape keeps its fill; a shape with no fill is
 * replaced by its outline.
 */
export async function runOutlineStroke(): Promise<void> {
  const { doc, selection } = editor();
  if (!pathOpsFor(doc, selection).outline) return;
  const svgId = selection[0]!;
  const work: { id: NodeId; outline: string; color: string; opacity: string | null; keep: boolean }[] = [];
  for (const shapeId of shapesUnder(doc, svgId)) {
    if (!hasStroke(doc, shapeId)) continue;
    const node = getElement(doc, shapeId)!;
    const el = domElement(shapeId);
    const raw = node.tag === 'path' ? node.attrs.d : shapeToPathData(node.tag, node.attrs);
    if (!el || !raw) continue;
    const cs = styleOf(el);
    const width = parseFloat(cs.strokeWidth) || 1;
    const outline = await outlineStroke(raw, width, cs.strokeLinejoin, cs.strokeLinecap);
    if (!outline.trim()) continue;
    const opacity = cs.getPropertyValue('stroke-opacity').trim();
    const paint: Record<string, string> = {};
    putColor(paint, 'fill', cs.stroke);
    work.push({ id: shapeId, outline, color: paint.fill ?? cs.stroke, opacity: opacity && opacity !== '1' ? opacity : (paint['fill-opacity'] ?? null), keep: cs.fill !== 'none' && cs.fill !== '' });
  }
  if (!work.length) return;
  editor().apply('Outline stroke', (current) => {
    let next = current;
    for (const item of work) {
      const parentId = getParentId(next, item.id)!;
      const parent = getElement(next, parentId)!;
      const made = instantiate(next, { tag: 'path', attrs: { d: item.outline, fill: item.color, ...(item.opacity ? { 'fill-opacity': item.opacity } : {}) } });
      next = insertChild(made.doc, parentId, parent.children.indexOf(item.id) + 1, made.id);
      if (item.keep) {
        for (const attr of ['stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin']) next = setAttribute(next, item.id, attr, null);
        next = setAttribute(next, item.id, 'stroke', 'none');
      } else {
        next = removeNodes(next, [item.id]);
      }
    }
    return next;
  });
}
