/**
 * Gradients as one model for both worlds: CSS backgrounds (boxes) and SVG paint servers
 * (vectors). Angles follow CSS: 0° points up, 90° to the right, 180° (the default) down.
 */
import type { NodeSpec } from '../document/factory.ts';
import type { ElementNode } from '../document/types.ts';

export interface GradientStop {
  /** #rrggbb */
  readonly color: string;
  /** 0–1 */
  readonly alpha: number;
  /** 0–1 along the gradient */
  readonly position: number;
}

export interface Gradient {
  readonly type: 'linear' | 'radial';
  readonly angle: number;
  readonly stops: readonly GradientStop[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// --- colors ------------------------------------------------------------------------------------

/** Any of #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() → hex + alpha. */
export function parseColor(value: string): { color: string; alpha: number } | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return { color: `#${m[1]!.split('').map((c) => c + c).join('')}`, alpha: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return { color: `#${m[1]}`, alpha: m[2] ? round(parseInt(m[2], 16) / 255, 3) : 1 };
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((n) => Math.round(Math.min(255, parseFloat(n!))).toString(16).padStart(2, '0')).join('');
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { color: `#${hex}`, alpha: round(a, 3) };
  }
  if (v === 'transparent') return { color: '#000000', alpha: 0 };
  if (v === 'white') return { color: '#ffffff', alpha: 1 };
  if (v === 'black') return { color: '#000000', alpha: 1 };
  return null;
}

/** #rrggbb, or #rrggbbaa when translucent. */
export function colorWithAlpha(color: string, alpha: number): string {
  if (alpha >= 0.999) return color;
  return `${color}${Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, '0')}`;
}

function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The color a gradient has at `t` (for a new stop added there). */
export function colorAt(stops: readonly GradientStop[], t: number): { color: string; alpha: number } {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (!sorted.length) return { color: '#000000', alpha: 1 };
  if (t <= sorted[0]!.position) return sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (t <= b.position) {
      const k = b.position > a.position ? (t - a.position) / (b.position - a.position) : 0;
      return { color: mix(a.color, b.color, k), alpha: round(a.alpha + (b.alpha - a.alpha) * k, 3) };
    }
  }
  return sorted[sorted.length - 1]!;
}

/** A starting gradient from a solid color: the color fading to transparent, top to bottom. */
export function gradientFrom(color: string, alpha: number, type: Gradient['type']): Gradient {
  return { type, angle: 180, stops: [{ color, alpha, position: 0 }, { color, alpha: 0, position: 1 }] };
}

// --- CSS ---------------------------------------------------------------------------------------

/** Split on top-level commas (not those inside rgb()). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

const SIDE_ANGLES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };

/** A CSS linear-/radial-gradient() as a Gradient, or null for anything this editor can't represent. */
export function parseCssGradient(value: string): Gradient | null {
  const m = /^\s*(linear|radial)-gradient\((.*)\)\s*$/is.exec(value);
  if (!m) return null;
  const type = m[1]!.toLowerCase() as Gradient['type'];
  const args = splitArgs(m[2]!);
  let angle = 180;
  const first = args[0]?.toLowerCase() ?? '';
  if (type === 'linear') {
    const deg = /^(-?[\d.]+)(deg|turn|rad)$/.exec(first);
    if (deg) {
      const n = parseFloat(deg[1]!);
      angle = deg[2] === 'turn' ? n * 360 : deg[2] === 'rad' ? (n * 180) / Math.PI : n;
      args.shift();
    } else if (first.startsWith('to ')) {
      angle = SIDE_ANGLES[first.slice(3).trim()] ?? 180;
      args.shift();
    }
  } else if (!parseColor(first.split(/\s+/)[0] ?? '')) {
    args.shift(); // shape / size / position: drawn as a centered circle here
  }
  const raw = args.map((a) => {
    const parts = a.match(/^(.*?\))\s*(.*)$/) ?? a.match(/^(\S+)\s*(.*)$/);
    const color = parseColor(parts?.[1] ?? a);
    const pos = parts?.[2] ? parseFloat(parts[2]) : NaN;
    return color ? { ...color, position: Number.isFinite(pos) ? pos / 100 : NaN } : null;
  });
  if (raw.some((s) => !s) || raw.length < 2) return null;
  const stops = raw.map((s, i, all) => ({ color: s!.color, alpha: s!.alpha, position: Number.isFinite(s!.position) ? s!.position : i / (all.length - 1) }));
  return { type, angle: round(((angle % 360) + 360) % 360), stops };
}

export function cssGradient(g: Gradient): string {
  const stops = [...g.stops].sort((a, b) => a.position - b.position).map((s) => `${colorWithAlpha(s.color, s.alpha)} ${round(s.position * 100)}%`);
  return g.type === 'linear' ? `linear-gradient(${round(g.angle)}deg, ${stops.join(', ')})` : `radial-gradient(circle, ${stops.join(', ')})`;
}

// --- SVG ---------------------------------------------------------------------------------------

/** Gradient line endpoints in the shape's bounding box (0–1) for a CSS-style angle. */
function linearPoints(angle: number) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a) / 2;
  const dy = -Math.cos(a) / 2;
  return { x1: round(0.5 - dx, 4), y1: round(0.5 - dy, 4), x2: round(0.5 + dx, 4), y2: round(0.5 + dy, 4) };
}

/** A <linearGradient>/<radialGradient> for a vector's <defs>. */
export function svgGradientSpec(g: Gradient, id: string): NodeSpec {
  const stops = [...g.stops]
    .sort((a, b) => a.position - b.position)
    .map((s): NodeSpec => ({ tag: 'stop', attrs: { offset: String(round(s.position, 4)), 'stop-color': s.color, ...(s.alpha < 0.999 ? { 'stop-opacity': String(round(s.alpha, 3)) } : {}) } }));
  if (g.type === 'radial') return { tag: 'radialGradient', attrs: { id, cx: '0.5', cy: '0.5', r: '0.5' }, children: stops };
  const p = linearPoints(g.angle);
  return { tag: 'linearGradient', attrs: { id, x1: String(p.x1), y1: String(p.y1), x2: String(p.x2), y2: String(p.y2) }, children: stops };
}

/** Read an SVG gradient element (and its <stop>s) back. */
export function readSvgGradient(el: ElementNode, stops: readonly ElementNode[]): Gradient | null {
  if (el.tag !== 'linearGradient' && el.tag !== 'radialGradient') return null;
  const parsed = stops.map((s) => {
    const offset = s.attrs.offset ?? '0';
    const position = offset.endsWith('%') ? parseFloat(offset) / 100 : parseFloat(offset);
    const color = parseColor(s.attrs['stop-color'] ?? '#000000') ?? { color: '#000000', alpha: 1 };
    const opacity = parseFloat(s.attrs['stop-opacity'] ?? '1');
    return { color: color.color, alpha: round(color.alpha * (Number.isFinite(opacity) ? opacity : 1), 3), position: Number.isFinite(position) ? position : 0 };
  });
  if (parsed.length < 1) return null;
  if (el.tag === 'radialGradient') return { type: 'radial', angle: 180, stops: parsed };
  const n = (k: string, d: number) => {
    const v = el.attrs[k];
    if (v === undefined) return d;
    return v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
  };
  const dx = n('x2', 1) - n('x1', 0);
  const dy = n('y2', 0) - n('y1', 0);
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return { type: 'linear', angle: round(((angle % 360) + 360) % 360), stops: parsed };
}
