/**
 * Figma paints, strokes and effects → CSS values. Gradient handles follow OpenPencil's reading
 * of the transform (start = (m02, m12), end = start + (m00, m10), in the node's unit box).
 */
import type { Color, Effect, Fill, SceneNode } from '@open-pencil/scene-graph';

export function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function px(n: number): string {
  const r = round(n);
  return r === 0 ? '0' : `${r}px`;
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

/** #rrggbb, or #rrggbbaa when translucent. */
export function colorCss(c: Color, opacity = 1): string {
  const a = (c.a ?? 1) * opacity;
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return a >= 0.999 ? base : `${base}${hex2(a)}`;
}

/** A token color at a paint's opacity. */
export function withOpacity(color: string, opacity: number): string {
  return opacity >= 0.999 ? color : `color-mix(in srgb, ${color} ${round(opacity * 100)}%, transparent)`;
}

export interface Layer {
  readonly kind: 'color' | 'image';
  readonly css: string;
}

export type ImageUrl = (hash: string) => string | null;

function stops(fill: Fill, at: (position: number) => number): string {
  return (fill.gradientStops ?? []).map((s) => `${colorCss(s.color, fill.opacity)} ${round(at(s.position) * 100)}%`).join(', ');
}

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function linear(fill: Fill, w: number, h: number): string | null {
  const t = fill.gradientTransform ?? IDENTITY;
  const sx = t.m02 * w;
  const sy = t.m12 * h;
  const dx = t.m00 * w;
  const dy = t.m10 * h;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  // CSS: 0deg points up and the gradient line passes through the center, long enough to reach
  // the corners. Project each Figma stop onto that line.
  const angle = Math.atan2(dx, -dy);
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const length = Math.abs(w * ux) + Math.abs(h * uy) || 1;
  const at = (s: number) => ((sx + s * dx - w / 2) * ux + (sy + s * dy - h / 2) * uy) / length + 0.5;
  return `linear-gradient(${round((angle * 180) / Math.PI)}deg, ${stops(fill, at)})`;
}

function radial(fill: Fill, w: number, h: number): string {
  const t = fill.gradientTransform ?? { ...IDENTITY, m00: 0.5, m11: 0.5, m02: 0.5, m12: 0.5 };
  const rx = Math.hypot(t.m00 * w, t.m10 * h);
  const ry = Math.hypot(t.m01 * w, t.m11 * h);
  return `radial-gradient(${px(rx)} ${px(ry)} at ${px(t.m02 * w)} ${px(t.m12 * h)}, ${stops(fill, (s) => s)})`;
}

function conic(fill: Fill, w: number, h: number): string {
  const t = fill.gradientTransform ?? IDENTITY;
  const from = round((Math.atan2(t.m10 * h, t.m00 * w) * 180) / Math.PI + 90);
  return `conic-gradient(from ${from}deg at ${px(t.m02 * w)} ${px(t.m12 * h)}, ${stops(fill, (s) => s)})`;
}

const SCALE_MODE: Record<string, string> = { FILL: 'center / cover no-repeat', FIT: 'center / contain no-repeat', CROP: 'center / cover no-repeat', TILE: 'repeat' };

/** One fill as a CSS background layer, or null when it can't be expressed (or is hidden). */
export function fillLayer(fill: Fill, node: SceneNode, image: ImageUrl, color?: string): Layer | null {
  if (!fill.visible || fill.opacity <= 0) return null;
  switch (fill.type) {
    case 'SOLID':
      return { kind: 'color', css: color ? withOpacity(color, fill.opacity) : colorCss(fill.color, fill.opacity) };
    case 'GRADIENT_LINEAR': {
      const css = linear(fill, node.width, node.height);
      return css ? { kind: 'image', css } : null;
    }
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_DIAMOND':
      return { kind: 'image', css: radial(fill, node.width, node.height) };
    case 'GRADIENT_ANGULAR':
      return { kind: 'image', css: conic(fill, node.width, node.height) };
    case 'IMAGE': {
      const url = fill.imageHash ? image(fill.imageHash) : null;
      return url ? { kind: 'image', css: `url("${url}") ${SCALE_MODE[fill.imageScaleMode ?? 'FILL'] ?? SCALE_MODE.FILL}` } : null;
    }
    default:
      return null;
  }
}

/** Figma lists paints bottom-up; CSS lists background layers top-down, with one color last. */
export function backgroundCss(layers: readonly Layer[]): string | null {
  if (!layers.length) return null;
  if (layers.length === 1) return layers[0]!.css;
  const top = [...layers].reverse();
  return top.map((l, i) => (l.kind === 'color' && i < top.length - 1 ? `linear-gradient(${l.css}, ${l.css})` : l.css)).join(', ');
}

/** Shadows as box-shadow (or text-shadow), blurs as filter / backdrop-filter. */
export function effectDecls(effects: readonly Effect[], target: 'box' | 'text' | 'graphic'): Record<string, string> {
  const shadows: string[] = [];
  const filters: string[] = [];
  const backdrop: string[] = [];
  // Figma draws later effects on top; CSS draws the first shadow on top.
  for (const e of [...effects].reverse()) {
    if (!e.visible) continue;
    const color = colorCss(e.color);
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      if (target === 'text') {
        if (e.type === 'DROP_SHADOW') shadows.push(`${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${color}`);
      } else if (target === 'graphic') {
        if (e.type === 'DROP_SHADOW') filters.push(`drop-shadow(${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius / 2)} ${color})`);
      } else {
        const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
        shadows.push(`${inset}${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)}${e.spread ? ` ${px(e.spread)}` : ''} ${color}`);
      }
    } else if (e.type === 'LAYER_BLUR' || e.type === 'FOREGROUND_BLUR') {
      filters.push(`blur(${px(e.radius / 2)})`);
    } else if (e.type === 'BACKGROUND_BLUR') {
      backdrop.push(`blur(${px(e.radius / 2)})`);
    }
  }
  const decls: Record<string, string> = {};
  if (shadows.length) decls[target === 'text' ? 'text-shadow' : 'box-shadow'] = shadows.join(', ');
  if (filters.length) decls.filter = filters.reverse().join(' ');
  if (backdrop.length) decls['backdrop-filter'] = backdrop.join(' ');
  return decls;
}

const BLEND: Record<string, string> = {
  DARKEN: 'darken', MULTIPLY: 'multiply', COLOR_BURN: 'color-burn', LIGHTEN: 'lighten', SCREEN: 'screen',
  COLOR_DODGE: 'color-dodge', OVERLAY: 'overlay', SOFT_LIGHT: 'soft-light', HARD_LIGHT: 'hard-light',
  DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
};

export function blendMode(mode: string): string | null {
  return BLEND[mode] ?? null;
}

/** File extension from an image's leading bytes. */
export function imageExtension(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif';
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  return 'png';
}
