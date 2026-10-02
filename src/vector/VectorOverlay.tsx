/**
 * Vector edit mode on the canvas: the path outline, its anchors and handles, segment hover, the
 * pen's preview, and a small toolbar (mirroring, done). Drawn in screen space, so points keep
 * their size at any zoom; positions are re-measured every frame from the live DOM.
 */
import { Check, Spline } from 'lucide-react';
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../editor/store.ts';
import { useGesture } from '../canvas/gestureStore.ts';
import { apply, exitVectorEdit, readPath, userToScreenMatrix, validRefs, vectorRootOf, writePath } from './edit.ts';
import { domElement } from '../canvas/dom.ts';
import { HIT_RADIUS, hitTest, startAnchorDrag, startHandleDrag, startSegmentGesture } from './gestures.ts';
import { segmentCount, segmentCurve, setMirror, toggleSmooth, type Mirror, type PointRef, type VectorPath } from './path.ts';

interface Frame {
  readonly matrix: DOMMatrix;
  readonly path: VectorPath;
  readonly key: string;
}

const fmt = (n: number) => Math.round(n * 10) / 10;

function measure(): Frame | null {
  const { vectorEdit, doc } = useEditor.getState();
  if (!vectorEdit) return null;
  const matrix = userToScreenMatrix(vectorEdit.id);
  if (!matrix) return null;
  const d = (doc.nodes[vectorEdit.id] as { attrs?: Record<string, string> } | undefined)?.attrs?.d ?? '';
  const key = `${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(fmt).join(',')}|${d}`;
  return { matrix, path: readPath(doc, vectorEdit.id), key };
}

function screenPath(path: VectorPath, m: DOMMatrix): string {
  return path
    .map((s) => {
      if (!s.anchors.length) return '';
      const p0 = apply(m, s.anchors[0]!);
      let d = `M${p0.x} ${p0.y}`;
      for (let i = 0; i < segmentCount(s); i++) {
        const c = segmentCurve(s, i)!.map((p) => apply(m, p));
        d += `C${c[1]!.x} ${c[1]!.y} ${c[2]!.x} ${c[2]!.y} ${c[3]!.x} ${c[3]!.y}`;
      }
      return s.closed ? `${d}Z` : d;
    })
    .join('');
}

const sameRef = (a: PointRef, b: PointRef) => a.sub === b.sub && a.index === b.index && a.part === b.part;

export function VectorOverlay() {
  const edit = useEditor((s) => s.vectorEdit);
  const penTool = useEditor((s) => s.tool.kind === 'pen');
  const pen = useGesture((s) => s.pen);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [hover, setHover] = useState<{ sub: number; index: number } | null>(null);

  // While editing, the svg shows what's drawn outside its box (it's fitted again on exit).
  const editedRoot = useEditor((s) => (s.vectorEdit ? vectorRootOf(s.doc, s.vectorEdit.id) : null));
  useEffect(() => {
    const svg = domElement(editedRoot) as unknown as SVGSVGElement | null;
    if (!svg) return;
    const previous = svg.style.overflow;
    svg.style.overflow = 'visible';
    return () => {
      svg.style.overflow = previous;
    };
  }, [editedRoot]);

  useEffect(() => {
    if (!edit) {
      setFrame(null);
      return;
    }
    let raf = 0;
    let last = '';
    const tick = () => {
      const next = measure();
      if ((next?.key ?? '') !== last) {
        last = next?.key ?? '';
        setFrame(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [edit?.id]);

  if (!edit || !frame) return null;
  const m = frame.matrix;
  // While drawing, show the pending handles (not in `d` yet) on the path's ends.
  const path: VectorPath = edit.drawing
    ? frame.path.map((s, i) => {
        if (i !== edit.drawing!.sub || !s.anchors.length) return s;
        const anchors = [...s.anchors];
        const end = anchors.length - 1;
        if (edit.drawing!.out) anchors[end] = { ...anchors[end]!, out: edit.drawing!.out };
        if (edit.drawing!.startIn) anchors[0] = { ...anchors[0]!, in: anchors[0]!.in ?? edit.drawing!.startIn };
        return { ...s, anchors };
      })
    : frame.path;
  const points = validRefs(path, edit.points);
  const selectedAnchors = new Set(points.map((p) => `${p.sub}:${p.index}`));

  // Handles shown: on selected anchors and the anchors next to them (like Figma).
  const showHandles = new Set<string>();
  for (const key of selectedAnchors) {
    const [sub, index] = key.split(':').map(Number) as [number, number];
    const s = path[sub];
    if (!s) continue;
    const n = s.anchors.length;
    showHandles.add(key);
    if (index > 0 || s.closed) showHandles.add(`${sub}:${(index - 1 + n) % n}`);
    if (index < n - 1 || s.closed) showHandles.add(`${sub}:${(index + 1) % n}`);
  }
  if (edit.drawing) {
    const s = path[edit.drawing.sub];
    if (s?.anchors.length) showHandles.add(`${edit.drawing.sub}:${s.anchors.length - 1}`);
  }

  const interactive = !penTool;
  const down = (fn: (e: PointerEvent) => void) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !interactive) return;
    e.stopPropagation();
    e.preventDefault();
    fn(e.nativeEvent);
  };

  // Pen preview: from the last anchor (through its out handle) to the pointer.
  let preview: string | null = null;
  let closing = false;
  if (penTool && pen && edit.drawing) {
    const s = path[edit.drawing.sub];
    const lastAnchor = s?.anchors[s.anchors.length - 1];
    if (s && lastAnchor) {
      const hit = hitTest(path, m, pen);
      closing = hit?.kind === 'anchor' && hit.ref.sub === edit.drawing.sub && hit.ref.index === 0 && s.anchors.length >= 2;
      const a = apply(m, lastAnchor);
      const c1 = apply(m, lastAnchor.out ?? lastAnchor);
      const end = closing ? apply(m, s.anchors[0]!) : pen;
      const c2 = closing && s.anchors[0]!.in ? apply(m, s.anchors[0]!.in) : end;
      preview = `M${a.x} ${a.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`;
    }
  }
  const penHit = penTool && pen && !edit.drawing ? hitTest(path, m, pen) : null;

  return (
    <>
      <svg className="vec-overlay" aria-hidden="true">
        <path className="vec-outline" d={screenPath(path, m)} />
        {path.map((s, sub) =>
          Array.from({ length: segmentCount(s) }, (_, index) => {
            const c = segmentCurve(s, index)!.map((p) => apply(m, p));
            const d = `M${c[0]!.x} ${c[0]!.y}C${c[1]!.x} ${c[1]!.y} ${c[2]!.x} ${c[2]!.y} ${c[3]!.x} ${c[3]!.y}`;
            const hovered = (hover?.sub === sub && hover.index === index) || (penHit?.kind === 'segment' && penHit.sub === sub && penHit.index === index);
            return (
              <g key={`${sub}-${index}`}>
                {hovered && <path className="vec-segment-hover" d={d} />}
                <path
                  className="vec-segment-hit"
                  d={d}
                  strokeWidth={HIT_RADIUS * 2}
                  style={{ pointerEvents: interactive ? 'stroke' : 'none' }}
                  onPointerEnter={() => setHover({ sub, index })}
                  onPointerLeave={() => setHover(null)}
                  onPointerDown={down((e) => startSegmentGesture(e, sub, index))}
                />
              </g>
            );
          }),
        )}
        {preview && <path className="vec-preview" d={preview} />}
        {path.map((s, sub) =>
          s.anchors.map((a, index) => {
            if (!showHandles.has(`${sub}:${index}`)) return null;
            const p = apply(m, a);
            return (['in', 'out'] as const).map((part) => {
              const h = a[part];
              if (!h) return null;
              const q = apply(m, h);
              const ref: PointRef = { sub, index, part };
              return (
                <g key={`${sub}-${index}-${part}`}>
                  <line className="vec-handle-line" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
                  <circle
                    className={`vec-handle${points.some((r) => sameRef(r, ref)) ? ' is-selected' : ''}`}
                    cx={q.x}
                    cy={q.y}
                    r={3.5}
                    style={{ pointerEvents: interactive ? 'all' : 'none' }}
                    onPointerDown={down((e) => startHandleDrag(e, ref))}
                  />
                </g>
              );
            });
          }),
        )}
        {path.map((s, sub) =>
          s.anchors.map((a, index) => {
            const p = apply(m, a);
            const ref: PointRef = { sub, index, part: 'anchor' };
            const selected = selectedAnchors.has(`${sub}:${index}`);
            const endpoint = penTool && !s.closed && (index === 0 || index === s.anchors.length - 1);
            const ring = (closing && sub === edit.drawing?.sub && index === 0) || (penHit?.kind === 'anchor' && penHit.ref.sub === sub && penHit.ref.index === index && endpoint);
            return (
              <g key={`${sub}-${index}`}>
                {ring && <circle className="vec-anchor-ring" cx={p.x} cy={p.y} r={8} />}
                <circle
                  className={`vec-anchor${selected ? ' is-selected' : ''}`}
                  cx={p.x}
                  cy={p.y}
                  r={4}
                  style={{ pointerEvents: interactive ? 'all' : 'none' }}
                  onPointerDown={down((e) => startAnchorDrag(e, ref))}
                  onDoubleClick={(e) => {
                    if (!interactive) return;
                    e.stopPropagation();
                    useEditor.getState().apply('Toggle smooth point', (d) => writePath(d, edit.id, toggleSmooth(readPath(d, edit.id), ref)));
                  }}
                />
              </g>
            );
          }),
        )}
      </svg>
      <VectorToolbar path={path} points={points} />
    </>
  );
}

const MIRRORS: readonly { value: Mirror; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'angle', label: 'Angle' },
  { value: 'angle-length', label: 'Angle & length' },
];

function VectorToolbar({ path, points }: { path: VectorPath; points: readonly PointRef[] }) {
  const edit = useEditor((s) => s.vectorEdit)!;
  const penTool = useEditor((s) => s.tool.kind === 'pen');
  const anchors = points.filter((p) => p.part === 'anchor');
  const modes = new Set(anchors.map((r) => path[r.sub]?.anchors[r.index]?.mirror));
  const current = modes.size === 1 ? [...modes][0] : undefined;
  const setMode = (mirror: Mirror) =>
    useEditor.getState().apply('Mirroring', (d) => writePath(d, edit.id, setMirror(readPath(d, edit.id), anchors, mirror)));
  const count = path.reduce((n, s) => n + s.anchors.length, 0);
  return (
    <div className="vec-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="vec-toolbar-title">
        <Spline size={13} strokeWidth={1.75} />
        {edit.drawing ? 'Drawing' : penTool ? 'Pen' : 'Editing vector'}
        <span className="vec-toolbar-meta">{anchors.length ? `${anchors.length} of ${count} points` : `${count} points`}</span>
      </span>
      <span className="vec-toolbar-label">Mirroring</span>
      <div className="vec-segmented" role="radiogroup" aria-label="Mirroring">
        {MIRRORS.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={current === m.value}
            disabled={!anchors.length}
            className={`vec-segment${current === m.value ? ' is-active' : ''}`}
            onClick={() => setMode(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <button type="button" className="vec-done" onClick={() => exitVectorEdit()} title="Done  Esc">
        <Check size={13} strokeWidth={2} />
        Done
      </button>
    </div>
  );
}
