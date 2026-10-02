// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { booleanPaths, outlineStroke, pathBounds } from '../src/vector/booleans.ts';

// Paper.js asks for a 2D canvas on setup; jsdom has none. It never draws here, so any object works.
HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, { get: () => () => ({}) });
} as never;

const square = (x: number, y: number, s: number) => `M${x} ${y}H${x + s}V${y + s}H${x}Z`;

describe('path operations', () => {
  it('unites, subtracts, intersects and excludes', async () => {
    const a = square(0, 0, 10);
    const b = square(5, 5, 10);
    expect(await pathBounds(await booleanPaths('union', [a, b]))).toEqual({ x: 0, y: 0, width: 15, height: 15 });
    expect(await pathBounds(await booleanPaths('intersect', [a, b]))).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(await pathBounds(await booleanPaths('subtract', [a, b]))).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    const exclude = await booleanPaths('exclude', [a, b]);
    expect(await pathBounds(exclude)).toEqual({ x: 0, y: 0, width: 15, height: 15 });
  });

  it('outlines a stroke into a filled shape', async () => {
    const outline = await outlineStroke('M0 0L100 0', 10, 'miter', 'butt');
    const b = await pathBounds(outline);
    expect(b.width).toBeCloseTo(100, 0);
    expect(b.height).toBeCloseTo(10, 0);
  });
});

describe('color normalization', () => {
  it('turns computed rgb() colors into hex with alpha', async () => {
    const { cssColorToHex } = await import('../src/vector/pathOps.ts');
    expect(cssColorToHex('rgb(99, 102, 241)')).toEqual({ hex: '#6366f1', alpha: 1 });
    expect(cssColorToHex('rgba(0, 0, 0, 0.5)')).toEqual({ hex: '#000000', alpha: 0.5 });
    expect(cssColorToHex('rgb(255 0 0 / 25%)')).toEqual({ hex: '#ff0000', alpha: 0.25 });
    expect(cssColorToHex('#123456')).toBeNull();
  });
});
