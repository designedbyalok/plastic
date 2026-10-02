/**
 * Edits a gradient like Figma's fill picker: a stop bar (drag stops, click the bar to add one),
 * the selected stop's color, opacity and position, and the angle for linear gradients.
 */
import { Minus, RotateCw } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { colorAt, cssGradient, type Gradient, type GradientStop } from '../../paint/gradient.ts';
import { Row, TextInput } from './fields.tsx';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pct = (n: number) => String(Math.round(n * 100));

export function GradientEditor({ gradient: input, onChange }: { gradient: Gradient; onChange(next: Gradient, coalesce?: string): void }) {
  // Stops are kept in position order (that's how they're saved), so the selection is an index into it.
  const gradient: Gradient = { ...input, stops: [...input.stops].sort((a, b) => a.position - b.position) };
  const [selected, setSelected] = useState(0);
  /** Where a stop lands in position order when it's at `position` (ties stay where they were). */
  const indexFor = (position: number, without: number) => gradient.stops.filter((s, i) => i !== without && (s.position < position || (s.position === position && i < without))).length;
  const bar = useRef<HTMLDivElement>(null);
  const index = Math.min(selected, gradient.stops.length - 1);
  const stop = gradient.stops[index]!;

  const update = (patch: Partial<GradientStop>, coalesce?: string) => {
    onChange({ ...gradient, stops: gradient.stops.map((s, i) => (i === index ? { ...s, ...patch } : s)) }, coalesce);
    if (patch.position !== undefined) setSelected(indexFor(patch.position, index));
  };

  const positionAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return clamp01((clientX - r.left) / Math.max(1, r.width));
  };

  const onBarDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || e.target !== bar.current) return;
    const position = positionAt(e.clientX);
    const color = colorAt(gradient.stops, position);
    onChange({ ...gradient, stops: [...gradient.stops, { ...color, position }] });
    setSelected(indexFor(position, -1));
  };

  const onStopDown = (e: ReactPointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(i);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const position = positionAt(ev.clientX);
      onChange({ ...gradient, stops: gradient.stops.map((s, j) => (j === i ? { ...s, position } : s)) }, 'gradient-stop-drag');
      // The dragged stop may pass others; keep it selected in the new order.
      setSelected(indexFor(position, i));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const preview = cssGradient({ ...gradient, type: 'linear', angle: 90 });

  return (
    <div className="grad">
      <div className="grad-bar" ref={bar} onPointerDown={onBarDown} title="Click to add a stop; drag a stop to move it">
        <div className="grad-bar-fill" style={{ background: preview }} />
        {gradient.stops.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`grad-stop${i === index ? ' is-selected' : ''}`}
            style={{ left: `${s.position * 100}%`, background: s.color }}
            aria-label={`Stop ${i + 1} at ${pct(s.position)}%`}
            onPointerDown={(e) => onStopDown(e, i)}
          />
        ))}
      </div>
      <Row>
        <span className="insp-field">
          <TextInput ariaLabel="Stop color" value={stop.color} mono prefix={<span />} onChange={(v) => /^#[0-9a-f]{6}$/i.test(v.trim()) && update({ color: v.trim().toLowerCase() }, 'gradient-stop-color')} />
          <span className="insp-prefix">
            <input type="color" className="insp-swatch" aria-label="Stop color picker" value={stop.color} onChange={(e) => update({ color: e.target.value }, 'gradient-stop-color')} />
          </span>
        </span>
        <span className="insp-narrow">
          <TextInput
            ariaLabel="Stop opacity"
            value={pct(stop.alpha)}
            suffix="%"
            onChange={(v) => {
              const n = parseFloat(v);
              if (Number.isFinite(n)) update({ alpha: clamp01(n / 100) }, 'gradient-stop-alpha');
            }}
          />
        </span>
        <button
          type="button"
          className="icon-button"
          title="Remove stop"
          aria-label="Remove stop"
          disabled={gradient.stops.length <= 2}
          onClick={() => {
            onChange({ ...gradient, stops: gradient.stops.filter((_, i) => i !== index) });
            setSelected(Math.max(0, index - 1));
          }}
        >
          <Minus size={13} strokeWidth={1.5} />
        </button>
      </Row>
      <Row>
        <TextInput
          ariaLabel="Stop position"
          prefix="Stop"
          suffix="%"
          value={pct(stop.position)}
          onChange={(v) => {
            const n = parseFloat(v);
            if (Number.isFinite(n)) update({ position: clamp01(n / 100) }, 'gradient-stop-position');
          }}
        />
        {gradient.type === 'linear' && (
          <>
            <TextInput
              ariaLabel="Gradient angle"
              prefix="Angle"
              suffix="°"
              value={String(Math.round(gradient.angle))}
              onChange={(v) => {
                const n = parseFloat(v);
                if (Number.isFinite(n)) onChange({ ...gradient, angle: ((n % 360) + 360) % 360 }, 'gradient-angle');
              }}
            />
            <button type="button" className="icon-button" title="Rotate 90°" aria-label="Rotate gradient 90°" onClick={() => onChange({ ...gradient, angle: (gradient.angle + 90) % 360 })}>
              <RotateCw size={13} strokeWidth={1.5} />
            </button>
          </>
        )}
      </Row>
    </div>
  );
}
