/** Choose the more readable text color over the composited insertion background. */
import { parseColor, parseCssGradient, colorAt } from '../paint/gradient.ts';
import { domElement, getViewportElement, styleOf } from './dom.ts';
import type { NodeId } from '../document/types.ts';
const channels = (hex: string) => [0, 1, 2].map(i => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16));
export function readableTextColor(backgrounds: readonly string[], fallback = '#282828'): string {
  let rgb = channels(parseColor(fallback)?.color ?? '#282828');
  for (const background of [...backgrounds].reverse()) {
    const parsed = parseColor(background);
    if (!parsed) continue;
    const fg = channels(parsed.color);
    rgb = rgb.map((v, i) => fg[i]! * parsed.alpha + v * (1 - parsed.alpha));
  }
  const luminance = (values: number[]) => values.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [ .2126, .7152, .0722 ][i]!, 0);
  const bg = luminance(rgb); const dark = luminance(channels('#111827'));
  return 1.05 / (bg + .05) >= (bg + .05) / (dark + .05) ? '#ffffff' : '#111827';
}
export function insertionTextColor(parent?: NodeId): string {
  const backgrounds: string[] = [];
  for (let el = domElement(parent); el; el = el.parentElement) {
    const cs = styleOf(el);
    const gradient = parseCssGradient(cs.backgroundImage);
    if (gradient) { const sample = colorAt(gradient.stops, .5); backgrounds.push(`${sample.color}${Math.round(sample.alpha * 255).toString(16).padStart(2, '0')}`); }
    // Normalize modern CSS colors (OKLCH, Display P3…) through the browser's renderer.
    let background = cs.backgroundColor;
    if (!parseColor(background) && CSS.supports('color', background)) {
      const sample = el.ownerDocument.createElement('canvas'); sample.width = sample.height = 1;
      const context = sample.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.fillStyle = background; context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        background = `rgba(${r},${g},${b},${a! / 255})`;
      }
    }
    backgrounds.push(background);
  }
  const canvas = getViewportElement();
  return readableTextColor(backgrounds, canvas ? styleOf(canvas).backgroundColor : '#282828');
}
