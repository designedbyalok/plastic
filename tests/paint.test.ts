import { describe, expect, it } from 'vitest';
import { colorAt, cssGradient, parseColor, parseCssGradient, readSvgGradient, svgGradientSpec } from '../src/paint/gradient.ts';

describe('gradients', () => {
  it('parses and writes CSS gradients', () => {
    const g = parseCssGradient('linear-gradient(90deg, #10b981 0%, rgba(245, 158, 11, 0.5) 100%)')!;
    expect(g).toEqual({ type: 'linear', angle: 90, stops: [{ color: '#10b981', alpha: 1, position: 0 }, { color: '#f59e0b', alpha: 0.5, position: 1 }] });
    expect(cssGradient(g)).toBe('linear-gradient(90deg, #10b981 0%, #f59e0b80 100%)');
    expect(parseCssGradient('linear-gradient(to right, red, blue)')).toBeNull();
    expect(parseCssGradient('linear-gradient(to right, #ff0000, #0000ff)')!.angle).toBe(90);
    expect(parseCssGradient('radial-gradient(circle, #fff 0%, #000 100%)')!.type).toBe('radial');
    expect(parseCssGradient('url(a.png)')).toBeNull();
  });

  it('spaces stops without positions evenly', () => {
    expect(parseCssGradient('linear-gradient(180deg, #000000, #ffffff, #ff0000)')!.stops.map((s) => s.position)).toEqual([0, 0.5, 1]);
  });

  it('round-trips SVG gradients', () => {
    const g = { type: 'linear' as const, angle: 90, stops: [{ color: '#000000', alpha: 1, position: 0 }, { color: '#ffffff', alpha: 0.4, position: 1 }] };
    const spec = svgGradientSpec(g, 'g1');
    expect(spec.attrs).toEqual({ id: 'g1', x1: '0', y1: '0.5', x2: '1', y2: '0.5' });
    const el = { kind: 'element' as const, id: 'x', tag: spec.tag, attrs: spec.attrs!, classes: [], children: [] };
    const stops = spec.children!.map((c, i) => ({ kind: 'element' as const, id: `s${i}`, tag: 'stop', attrs: (c as { attrs: Record<string, string> }).attrs, classes: [], children: [] }));
    expect(readSvgGradient(el, stops)).toEqual(g);
  });

  it('reads colors and interpolates new stops', () => {
    expect(parseColor('#abc')).toEqual({ color: '#aabbcc', alpha: 1 });
    expect(parseColor('#00000080')).toEqual({ color: '#000000', alpha: 0.502 });
    expect(colorAt([{ color: '#000000', alpha: 1, position: 0 }, { color: '#ffffff', alpha: 0, position: 1 }], 0.5)).toEqual({ color: '#808080', alpha: 0.5 });
  });
});
