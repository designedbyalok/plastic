/**
 * Inspector sections for vectors (SVG): Shape (polygon sides, star points and ratio), Fill and
 * Stroke, and — in vector edit mode — the selected point's position. They edit the shapes'
 * presentation attributes (fill, stroke, stroke-width…), which is how SVG paints, so the result
 * stays plain SVG. A shape's value may be inherited from the svg (new vectors have fill="none"
 * on the svg); the effective value is shown and editing sets it on the shapes themselves.
 */
import { setAttribute } from '../../document/ops.ts';
import { getElement, getParentId } from '../../document/tree.ts';
import type { DesignDocument, ElementNode, NodeId } from '../../document/types.ts';
import { useEditor } from '../../editor/store.ts';
import { EDITABLE_SHAPES, readPath, vectorRootOf, writePath } from '../../vector/edit.ts';
import { moveRefs } from '../../vector/path.ts';
import { DEFAULT_STAR_RATIO, polygonPoints, starPoints } from '../../vector/shapes.ts';
import { cssColorToHex } from '../../vector/pathOps.ts';
import { Checkbox, MIXED, Row, Section, Segmented, Select, TextInput } from './fields.tsx';

const editor = () => useEditor.getState();

/** SVG's initial values for the properties edited here. */
const INITIAL: Record<string, string> = {
  fill: '#000000',
  stroke: 'none',
  'stroke-width': '1',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-dasharray': 'none',
  'fill-opacity': '1',
  'stroke-opacity': '1',
};

/** The shapes a vector selection edits: the edited path in edit mode, else every shape inside. */
export function vectorShapes(doc: DesignDocument, ids: readonly NodeId[], editing: NodeId | null): NodeId[] {
  if (editing) return [editing];
  const out: NodeId[] = [];
  const walk = (id: NodeId) => {
    const el = getElement(doc, id);
    if (!el) return;
    if (EDITABLE_SHAPES.has(el.tag)) out.push(id);
    el.children.forEach(walk);
  };
  ids.forEach(walk);
  return out;
}

/** The value a shape actually uses: its own attribute, else the nearest svg ancestor's, else SVG's default. */
function effective(doc: DesignDocument, id: NodeId, attr: string): string {
  for (let current: NodeId | null = id; current; current = getParentId(doc, current)) {
    const el = getElement(doc, current);
    if (!el) break;
    const v = el.attrs[attr];
    if (v !== undefined && v !== 'inherit') return v.trim();
    if (el.tag === 'svg' && current !== id && !vectorRootOf(doc, getParentId(doc, current))) break;
  }
  return INITIAL[attr] ?? '';
}

function useShared(shapes: readonly NodeId[], attr: string): string {
  return useEditor((s) => {
    const values = new Set(shapes.map((id) => effective(s.doc, id, attr)));
    return values.size === 1 ? [...values][0]! : values.size ? MIXED : '';
  });
}

function setAll(shapes: readonly NodeId[], attrs: Record<string, string | null>, label: string, coalesce?: string): void {
  editor().apply(
    label,
    (d) => shapes.reduce((acc, id) => Object.entries(attrs).reduce((x, [k, v]) => setAttribute(x, id, k, v), acc), d),
    coalesce ? { coalesce } : {},
  );
}

const isNone = (v: string) => v === 'none' || v === 'transparent' || v === '';

function hexOf(value: string): string {
  const rgb = cssColorToHex(value);
  if (rgb) return rgb.hex;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7).toLowerCase();
  return '#000000';
}

/** Color swatch + value + opacity % for one paint (fill or stroke). */
function PaintRow({ shapes, attr, opacityAttr, label }: { shapes: readonly NodeId[]; attr: 'fill' | 'stroke'; opacityAttr: string; label: string }) {
  const value = useShared(shapes, attr);
  const opacity = useShared(shapes, opacityAttr);
  const paint = value === MIXED ? '' : value;
  const gradient = /^url\(/i.test(paint);
  const pct = opacity === MIXED ? '' : String(Math.round((parseFloat(opacity) || 0) * 100));
  return (
    <Row>
      <span className="insp-field">
        <TextInput
          ariaLabel={`${label} color`}
          value={gradient ? 'Gradient' : paint}
          placeholder={value === MIXED ? 'Mixed' : ''}
          mono
          prefix={<span />}
          onChange={(v) => v.trim() && !gradient && setAll(shapes, { [attr]: v.trim() }, label, `vector-${attr}`)}
        />
        <span className="insp-prefix">
          <input
            type="color"
            className="insp-swatch"
            aria-label={`${label} color picker`}
            value={hexOf(paint)}
            disabled={gradient}
            onChange={(e) => setAll(shapes, { [attr]: e.target.value }, label, `vector-${attr}`)}
          />
        </span>
      </span>
      <span className="insp-narrow">
        <TextInput
          ariaLabel={`${label} opacity`}
          value={pct}
          placeholder={opacity === MIXED ? 'Mixed' : '100'}
          suffix="%"
          onChange={(v) => {
            const n = parseFloat(v);
            if (!Number.isFinite(n)) return;
            const a = Math.max(0, Math.min(100, n)) / 100;
            setAll(shapes, { [opacityAttr]: a >= 1 ? null : String(a) }, `${label} opacity`, `vector-${opacityAttr}`);
          }}
        />
      </span>
    </Row>
  );
}

export function VectorFillSection({ shapes }: { shapes: readonly NodeId[] }) {
  const fill = useShared(shapes, 'fill');
  const empty = fill !== MIXED && isNone(fill);
  return (
    <Section
      title="Fill"
      empty={empty}
      onAdd={() => setAll(shapes, { fill: '#d9d9d9', 'fill-opacity': null }, 'Add fill')}
      onRemove={() => setAll(shapes, { fill: 'none', 'fill-opacity': null }, 'Remove fill')}
    >
      <PaintRow shapes={shapes} attr="fill" opacityAttr="fill-opacity" label="Fill" />
    </Section>
  );
}

const CAPS = [
  { value: 'butt', label: 'No cap' },
  { value: 'round', label: 'Round cap' },
  { value: 'square', label: 'Square cap' },
];
const JOINS = [
  { value: 'miter', label: 'Miter join' },
  { value: 'round', label: 'Round join' },
  { value: 'bevel', label: 'Bevel join' },
];

export function VectorStrokeSection({ shapes }: { shapes: readonly NodeId[] }) {
  const stroke = useShared(shapes, 'stroke');
  const width = useShared(shapes, 'stroke-width');
  const cap = useShared(shapes, 'stroke-linecap');
  const join = useShared(shapes, 'stroke-linejoin');
  const dash = useShared(shapes, 'stroke-dasharray');
  const scaling = useShared(shapes, 'vector-effect');
  const empty = stroke !== MIXED && isNone(stroke);
  const dashed = dash !== MIXED && !isNone(dash);
  const [dashLength, dashGap] = dashed ? dash.split(/[\s,]+/) : ['', ''];
  return (
    <Section
      title="Stroke"
      empty={empty}
      onAdd={() => setAll(shapes, { stroke: '#000000', 'stroke-width': '1', 'stroke-opacity': null }, 'Add stroke')}
      onRemove={() => setAll(shapes, { stroke: 'none' }, 'Remove stroke')}
    >
      <PaintRow shapes={shapes} attr="stroke" opacityAttr="stroke-opacity" label="Stroke" />
      <Row>
        <TextInput
          ariaLabel="Stroke width"
          prefix="W"
          value={width === MIXED ? '' : width.replace(/px$/, '')}
          placeholder={width === MIXED ? 'Mixed' : '1'}
          onChange={(v) => {
            const n = parseFloat(v);
            if (Number.isFinite(n) && n >= 0) setAll(shapes, { 'stroke-width': String(n) }, 'Stroke width', 'vector-stroke-width');
          }}
        />
        <Select ariaLabel="Stroke cap" value={cap === MIXED ? '' : cap} placeholder={cap === MIXED ? 'Mixed' : undefined} options={CAPS} onChange={(v) => setAll(shapes, { 'stroke-linecap': v }, 'Stroke cap')} />
      </Row>
      <Row>
        <Select ariaLabel="Stroke join" value={join === MIXED ? '' : join} placeholder={join === MIXED ? 'Mixed' : undefined} options={JOINS} onChange={(v) => setAll(shapes, { 'stroke-linejoin': v }, 'Stroke join')} />
        <Segmented
          ariaLabel="Dashes"
          value={dash === MIXED ? '' : dashed ? 'dashed' : 'solid'}
          choices={[
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
          ]}
          onChange={(v) => setAll(shapes, { 'stroke-dasharray': v === 'dashed' ? '6 4' : null }, 'Stroke dashes')}
        />
      </Row>
      {dashed && (
        <Row>
          <TextInput
            ariaLabel="Dash length"
            prefix="Dash"
            value={dashLength ?? ''}
            onChange={(v) => {
              const n = parseFloat(v);
              if (Number.isFinite(n) && n > 0) setAll(shapes, { 'stroke-dasharray': `${n} ${dashGap || n}` }, 'Stroke dashes', 'vector-dash');
            }}
          />
          <TextInput
            ariaLabel="Dash gap"
            prefix="Gap"
            value={dashGap ?? ''}
            onChange={(v) => {
              const n = parseFloat(v);
              if (Number.isFinite(n) && n >= 0) setAll(shapes, { 'stroke-dasharray': `${dashLength || 6} ${n}` }, 'Stroke dashes', 'vector-dash');
            }}
          />
        </Row>
      )}
      <Row>
        <Checkbox
          checked={scaling !== MIXED && scaling === 'non-scaling-stroke'}
          onChange={(on) => setAll(shapes, { 'vector-effect': on ? 'non-scaling-stroke' : null }, 'Stroke scaling')}
          label="Keep width when resizing"
        />
      </Row>
    </Section>
  );
}

/** Polygon sides, or star points and inner ratio: the shape is redrawn to fill its box. */
export function ShapeSection({ shapes }: { shapes: readonly NodeId[] }) {
  const doc = useEditor((s) => s.doc);
  const editable = shapes.map((id) => getElement(doc, id)).filter((el): el is ElementNode => !!el && el.tag === 'polygon' && el.attrs['data-pl-sides'] !== undefined);
  if (!editable.length || editable.length !== shapes.length) return null;
  const stars = editable.filter((el) => el.attrs['data-pl-ratio'] !== undefined);
  if (stars.length && stars.length !== editable.length) return null;
  const isStar = stars.length > 0;
  const sides = new Set(editable.map((el) => el.attrs['data-pl-sides']));
  const ratios = new Set(stars.map((el) => el.attrs['data-pl-ratio']));
  const sideValue = sides.size === 1 ? [...sides][0]! : '';
  const ratioValue = ratios.size === 1 ? String(Math.round(parseFloat([...ratios][0]!) * 100)) : '';

  const redraw = (next: { sides?: number; ratio?: number }, label: string) =>
    editor().apply(
      label,
      (d) =>
        editable.reduce((acc, el) => {
          const n = Math.max(3, Math.min(60, Math.round(next.sides ?? parseFloat(el.attrs['data-pl-sides']!))));
          const r = Math.max(0.05, Math.min(1, next.ratio ?? (parseFloat(el.attrs['data-pl-ratio'] ?? '') || DEFAULT_STAR_RATIO)));
          const box = boxOf(acc, el.id);
          const points = isStar ? starPoints(n, r, box.w, box.h) : polygonPoints(n, box.w, box.h);
          let x = setAttribute(acc, el.id, 'points', points.map((p) => `${p.x},${p.y}`).join(' '));
          x = setAttribute(x, el.id, 'data-pl-sides', String(n));
          if (isStar) x = setAttribute(x, el.id, 'data-pl-ratio', String(Math.round(r * 1000) / 1000));
          return x;
        }, d),
      { coalesce: `shape-${label}` },
    );

  return (
    <Section title={isStar ? 'Star' : 'Polygon'}>
      <Row>
        <TextInput
          ariaLabel={isStar ? 'Points' : 'Sides'}
          prefix={isStar ? 'Points' : 'Sides'}
          value={sideValue}
          placeholder={sides.size > 1 ? 'Mixed' : ''}
          onChange={(v) => {
            const n = parseFloat(v);
            if (Number.isFinite(n) && n >= 3) redraw({ sides: n }, isStar ? 'Star points' : 'Polygon sides');
          }}
        />
        {isStar && (
          <TextInput
            ariaLabel="Ratio"
            prefix="Ratio"
            suffix="%"
            value={ratioValue}
            placeholder={ratios.size > 1 ? 'Mixed' : ''}
            onChange={(v) => {
              const n = parseFloat(v);
              if (Number.isFinite(n) && n > 0) redraw({ ratio: n / 100 }, 'Star ratio');
            }}
          />
        )}
      </Row>
    </Section>
  );
}

/** A shape's drawing box: its svg's viewBox size. */
function boxOf(doc: DesignDocument, id: NodeId): { w: number; h: number } {
  const root = vectorRootOf(doc, id);
  const vb = (root ? getElement(doc, root)?.attrs.viewBox : undefined)?.trim().split(/[\s,]+/).map(Number) ?? [];
  return vb.length === 4 && vb.every(Number.isFinite) ? { w: vb[2]!, h: vb[3]! } : { w: 100, h: 100 };
}

/** In vector edit mode: the selected point's position (path units). */
export function PointSection() {
  const edit = useEditor((s) => s.vectorEdit);
  const doc = useEditor((s) => s.doc);
  if (!edit) return null;
  const path = readPath(doc, edit.id);
  const anchors = edit.points.filter((p) => p.part === 'anchor');
  const anchor = anchors.length === 1 ? path[anchors[0]!.sub]?.anchors[anchors[0]!.index] : undefined;
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const move = (axis: 'x' | 'y', v: string) => {
    const n = parseFloat(v);
    if (!anchor || !Number.isFinite(n)) return;
    const delta = axis === 'x' ? { x: n - anchor.x, y: 0 } : { x: 0, y: n - anchor.y };
    editor().apply('Move point', (d) => writePath(d, edit.id, moveRefs(readPath(d, edit.id), anchors, delta)), { coalesce: `point-${axis}` });
  };
  return (
    <Section title={anchors.length > 1 ? `${anchors.length} points` : 'Point'}>
      {anchor ? (
        <Row>
          <TextInput ariaLabel="Point X" prefix="X" value={fmt(anchor.x)} onChange={(v) => move('x', v)} />
          <TextInput ariaLabel="Point Y" prefix="Y" value={fmt(anchor.y)} onChange={(v) => move('y', v)} />
        </Row>
      ) : (
        <p className="insp-hint">{anchors.length ? 'Move several points by dragging or with the arrow keys.' : 'Select a point to see its position.'}</p>
      )}
    </Section>
  );
}

export function VectorSections({ ids }: { ids: readonly NodeId[] }) {
  const editing = useEditor((s) => s.vectorEdit?.id ?? null);
  const doc = useEditor((s) => s.doc);
  const shapes = vectorShapes(doc, ids, editing);
  return (
    <>
      <PointSection />
      {shapes.length > 0 && (
        <>
          <ShapeSection shapes={shapes} />
          <VectorFillSection shapes={shapes} />
          <VectorStrokeSection shapes={shapes} />
        </>
      )}
    </>
  );
}
