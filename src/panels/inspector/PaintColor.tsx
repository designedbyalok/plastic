import * as Popover from '@radix-ui/react-popover';
import { converter, formatHex, parse } from 'culori';
import { Pipette, X } from 'lucide-react';
import { useState } from 'react';
import { RgbaColorPicker } from 'react-colorful';
import { colorWithAlpha } from '../../paint/gradient.ts';
import { TextInput } from './fields.tsx';

const rgb = converter('rgb');
const hsl = converter('hsl');
const lch = converter('lch');
const clamp = (n: number, max = 1) => Math.max(0, Math.min(max, n));

/** Normalize CSS colors for editing without hand-rolling color-space conversion. */
export function paintColor(value: string) {
  const color = rgb(parse(value));
  return color ? { color: formatHex(color)!, alpha: clamp(color.alpha ?? 1) } : null;
}

type EyeDropperWindow = Window & { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } };
export function Eyedropper({ onChange }: { onChange(color: string): void }) {
  if (!(window as EyeDropperWindow).EyeDropper) return null;
  return <button type="button" className="icon-button" aria-label="Pick Color From Screen" title="Pick Color From Screen" onClick={async () => {
    try { onChange((await new (window as EyeDropperWindow).EyeDropper!().open()).sRGBHex); }
    catch { /* Escape cancels the browser's eyedropper. */ }
  }}><Pipette size={13} strokeWidth={1.5} /></button>;
}

export function PaintColorRow({ value, fallback = '#ffffff', label = 'Fill', onChange, aside }: {
  value: string; fallback?: string; label?: string; onChange(value: string): void; aside?: React.ReactNode;
}) {
  const normalized = paintColor(value) ?? paintColor(fallback) ?? { color: '#ffffff', alpha: 1 };
  const [open, setOpen] = useState(false);
  const [previous, setPrevious] = useState(normalized);
  const shown = paintColor(value) ? normalized.color.slice(1).toUpperCase() : value;
  return <div className="paint-color-row">
    <div className="paint-color-field">
      <Popover.Root open={open} onOpenChange={(next) => { if (next) setPrevious(normalized); setOpen(next); }}>
        <Popover.Trigger asChild><button type="button" className="paint-swatch checkerboard" aria-label={`${label} Color Picker`} title="Open Color Picker">
          <span style={{ background: colorWithAlpha(normalized.color, normalized.alpha) }} />
        </button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="paint-picker" side="left" align="start" sideOffset={12} collisionPadding={12} aria-label="Color Picker">
          <header className="paint-picker-head"><span>sRGB</span><Eyedropper onChange={(color) => onChange(colorWithAlpha(color, normalized.alpha))} /><Popover.Close asChild><button className="icon-button" aria-label="Close Color Picker"><X size={14} /></button></Popover.Close></header>
          <div className="paint-picker-body">
            <RgbaColorPicker color={{ ...rgbChannels(normalized.color), a: normalized.alpha }} onChange={(next) => onChange(colorWithAlpha(formatHex({ mode: 'rgb', r: next.r / 255, g: next.g / 255, b: next.b / 255 })!, next.a))} />
            <div className="paint-picker-values">
              <div className="paint-compare checkerboard">
                <button type="button" aria-label="Restore Previous Color" title="Restore Previous Color" style={{ background: colorWithAlpha(previous.color, previous.alpha) }} onClick={() => onChange(colorWithAlpha(previous.color, previous.alpha))} />
                <span style={{ background: colorWithAlpha(normalized.color, normalized.alpha) }} />
              </div>
              <div className="paint-compare-labels"><span>Previous</span><span>New</span></div>
              <ColorChannels value={normalized.color} alpha={normalized.alpha} onChange={onChange} />
              <div className="paint-picker-hex"><TextInput ariaLabel="Picker Hex Color" value={normalized.color.slice(1).toUpperCase()} prefix="#" onChange={(v) => { const parsed = paintColor(v.startsWith('#') ? v : `#${v}`); if (parsed) onChange(colorWithAlpha(parsed.color, normalized.alpha)); }} /><TextInput ariaLabel="Picker Color Opacity" value={String(Math.round(normalized.alpha * 100))} suffix="%" onChange={(v) => { const n = parseFloat(v); if (Number.isFinite(n)) onChange(colorWithAlpha(normalized.color, clamp(n / 100))); }} /></div>
            </div>
          </div>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      <TextInput ariaLabel={`${label} Color`} value={shown} placeholder="Mixed" mono onChange={(v) => {
        const next = paintColor(v) ?? paintColor(`#${v}`);
        // Preserve arbitrary CSS values and token references, just like the code editor.
        onChange(next ? colorWithAlpha(next.color, /^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(v) ? normalized.alpha : next.alpha) : v);
      }} />
      <TextInput ariaLabel={`${label} Opacity`} value={String(Math.round(normalized.alpha * 100))} suffix="%" onChange={(v) => {
        const n = parseFloat(v); if (Number.isFinite(n)) onChange(colorWithAlpha(normalized.color, clamp(n / 100)));
      }} />
    </div>
    {aside}
  </div>;
}

function rgbChannels(value: string) {
  const color = rgb(value)!;
  return { r: clamp(color.r) * 255, g: clamp(color.g) * 255, b: clamp(color.b) * 255 };
}

function ColorChannels({ value, alpha, onChange }: { value: string; alpha: number; onChange(value: string): void }) {
  const channels = [
    { mode: 'lch' as const, color: lch(value)!, keys: ['l', 'c', 'h'], labels: ['L', 'C', 'H'], scales: [1, 1, 1], max: [100, 150, 360] },
    { mode: 'hsl' as const, color: hsl(value)!, keys: ['h', 's', 'l'], labels: ['H', 'S', 'L'], scales: [1, 100, 100], max: [360, 100, 100] },
    { mode: 'rgb' as const, color: rgb(value)!, keys: ['r', 'g', 'b'], labels: ['R', 'G', 'B'], scales: [255, 255, 255], max: [255, 255, 255] },
  ];
  return <>{channels.map(({ mode, color, keys, labels, scales, max }) => <div className="paint-channel-row" key={mode}>
    {keys.map((key, i) => <label key={key}><TextInput ariaLabel={`${mode.toUpperCase()} ${labels[i]}`} value={String(Math.round((Number((color as unknown as Record<string, number>)[key]) || 0) * scales[i]!))} onChange={(v) => {
      const n = parseFloat(v); if (!Number.isFinite(n)) return;
      const next = formatHex({ ...color, [key]: clamp(n, max[i]) / scales[i]! });
      if (next) onChange(colorWithAlpha(next, alpha));
    }} /><span>{labels[i]}</span></label>)}
  </div>)}</>;
}
