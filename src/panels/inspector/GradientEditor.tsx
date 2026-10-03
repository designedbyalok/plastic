/** CSS and SVG share this editor and the same gradient model. */
import { Minus, Plus, RotateCw, SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { colorAt, cssGradient, type Gradient } from '../../paint/gradient.ts';
import { paintColor, PaintColorRow } from './PaintColor.tsx';
import { Row, Select, TextInput } from './fields.tsx';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pct = (n: number) => String(Math.round(n * 100));

export function GradientEditor({ gradient: input, onChange }: { gradient: Gradient; onChange(next: Gradient, coalesce?: string): void }) {
  const gradient: Gradient = { ...input, stops: [...input.stops].sort((a, b) => a.position - b.position) };
  const latest = useRef(gradient);
  latest.current = gradient;
  const [selected, setSelected] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const index = Math.min(selected, gradient.stops.length - 1);

  const add = (position = 0.5) => {
    const color = colorAt(gradient.stops, position);
    const next = [...gradient.stops, { ...color, position }].sort((a, b) => a.position - b.position);
    onChange({ ...gradient, stops: next });
    setSelected(next.findIndex((s) => s.position === position));
  };
  const positionAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return clamp01((clientX - r.left) / Math.max(1, r.width));
  };
  const moveStop = (g: Gradient, i: number, position: number) => {
    const stop = { ...g.stops[i]!, position };
    const next = g.stops.map((s, j) => j === i ? stop : s).sort((a, b) => a.position - b.position);
    const updated = { ...g, stops: next };
    latest.current = updated;
    onChange(updated, 'gradient-stop-drag');
    const selected = next.indexOf(stop);
    setSelected(selected);
    return selected;
  };
  const onStopDown = (e: ReactPointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault(); setSelected(i);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let moving = i;
    const move = (ev: PointerEvent) => { moving = moveStop(latest.current, moving, positionAt(ev.clientX)); };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      target.removeEventListener('lostpointercapture', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('lostpointercapture', up);
  };

  return <div className="grad">
    <div className="grad-bar checkerboard" ref={bar} onPointerDown={(e) => { if (e.button === 0 && e.target === bar.current) add(positionAt(e.clientX)); }} title="Click to Add a Stop; Drag a Stop to Move It">
      <div className="grad-bar-fill" style={{ background: cssGradient({ ...gradient, type: 'linear', angle: 90 }) }} />
      {gradient.stops.map((s, i) => <button key={i} type="button" className={`grad-stop${i === index ? ' is-selected' : ''}`}
        style={{ left: `${s.position * 100}%`, background: s.color }} aria-label={`Stop ${i + 1} at ${pct(s.position)}%`} aria-pressed={i === index}
        onPointerDown={(e) => onStopDown(e, i)} onClick={() => setSelected(i)} onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); moveStop(gradient, i, clamp01(s.position + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01))); }
        }} />)}
    </div>
    <Row><Select ariaLabel="Gradient Type" value={gradient.type} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} onChange={(type) => onChange({ ...gradient, type: type as Gradient['type'] })} />
      <button type="button" className="icon-button" aria-label="Gradient Settings" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={13} /></button>
      <button type="button" className="icon-button" aria-label="Add Gradient Stop" onClick={() => add()}><Plus size={13} /></button>
    </Row>
    {gradient.stops.map((stop, i) => <div key={i} className={`grad-color-row${i === index ? ' is-selected' : ''}`} onFocus={() => setSelected(i)}>
      <PaintColorRow label={`Stop ${i + 1}`} value={`${stop.color}${stop.alpha < 0.999 ? Math.round(stop.alpha * 255).toString(16).padStart(2, '0') : ''}`} onChange={(value) => {
        const color = paintColor(value); if (color) onChange({ ...gradient, stops: gradient.stops.map((s, j) => j === i ? { ...s, ...color } : s) }, 'gradient-stop-color');
      }} aside={<button type="button" className="icon-button" aria-label={`Remove Stop ${i + 1}`} disabled={gradient.stops.length <= 2} onClick={() => {
        onChange({ ...gradient, stops: gradient.stops.filter((_, j) => j !== i) }); setSelected(Math.max(0, index - 1));
      }}><Minus size={13} /></button>} />
      {advanced && <TextInput ariaLabel={`Stop ${i + 1} Position`} prefix="Position" suffix="%" value={pct(stop.position)} onChange={(v) => { const n = parseFloat(v); if (Number.isFinite(n)) moveStop(gradient, i, clamp01(n / 100)); }} />}
    </div>)}
    {advanced && gradient.type === 'linear' && <Row><TextInput ariaLabel="Gradient Angle" prefix="Angle" suffix="°" value={String(Math.round(gradient.angle))} onChange={(v) => {
      const n = parseFloat(v); if (Number.isFinite(n)) onChange({ ...gradient, angle: ((n % 360) + 360) % 360 }, 'gradient-angle');
    }} /><button type="button" className="icon-button" aria-label="Rotate Gradient 90°" onClick={() => onChange({ ...gradient, angle: (gradient.angle + 90) % 360 })}><RotateCw size={13} /></button></Row>}
  </div>;
}
