import { describe, expect, it } from 'vitest';
import { bendSegment, deleteAnchors, insertAnchor, moveRefs, parsePath, pointAt, segmentCurve, serializePath, setHandle, setMirror, shapeToPathData, toggleSmooth } from '../src/vector/path.ts';

describe('vector paths', () => {
  it('round-trips straight and curved paths', () => {
    expect(serializePath(parsePath('M0 0L10 0L10 10Z'))).toBe('M0 0L10 0L10 10Z');
    expect(serializePath(parsePath('M0 0C0 10 10 10 10 0'))).toBe('M0 0C0 10 10 10 10 0');
    // Relative, shorthand and H/V normalize to absolute anchors.
    expect(serializePath(parsePath('m5 5h10v10h-10z'))).toBe('M5 5L15 5L15 15L5 15Z');
  });

  it('reads arcs and quadratics as cubics', () => {
    const arc = parsePath('M0 10A10 10 0 0 1 20 10');
    expect(arc[0]!.anchors.length).toBeGreaterThanOrEqual(2);
    const end = arc[0]!.anchors.at(-1)!;
    expect(end.x).toBeCloseTo(20);
    expect(end.y).toBeCloseTo(10);
    const q = parsePath('M0 0Q10 10 20 0')[0]!;
    expect(q.anchors[0]!.out!.x).toBeCloseTo(20 / 3);
    expect(q.anchors[0]!.out!.y).toBeCloseTo(20 / 3);
  });

  it('merges a curved closing segment into the first anchor', () => {
    const path = parsePath('M0 0C5 -5 15 -5 20 0C15 5 5 5 0 0Z');
    expect(path[0]!.anchors).toHaveLength(2);
    expect(path[0]!.closed).toBe(true);
    expect(path[0]!.anchors[0]!.in).toEqual({ x: 5, y: 5 });
    expect(serializePath(path)).toBe('M0 0C5 -5 15 -5 20 0C15 5 5 5 0 0Z');
  });

  it('infers mirroring from handles', () => {
    const path = parsePath('M0 0C0 0 5 -5 10 0C15 5 20 0 20 0')[0]!;
    expect(path.anchors[1]!.mirror).toBe('angle-length');
  });

  it('moves anchors with their handles and mirrors handle drags', () => {
    let path = parsePath('M0 0C0 0 5 -5 10 0C15 5 20 0 20 0');
    path = moveRefs(path, [{ sub: 0, index: 1, part: 'anchor' }], { x: 1, y: 1 });
    expect(path[0]!.anchors[1]).toMatchObject({ x: 11, y: 1, in: { x: 6, y: -4 }, out: { x: 16, y: 6 } });
    path = setHandle(path, { sub: 0, index: 1, part: 'out' }, { x: 21, y: 1 });
    expect(path[0]!.anchors[1]!.in).toEqual({ x: 1, y: 1 });
    // Mirror angle only keeps the other handle's length.
    path = setMirror(path, [{ sub: 0, index: 1, part: 'anchor' }], 'angle');
    path = setHandle(path, { sub: 0, index: 1, part: 'out' }, { x: 11, y: 21 });
    expect(path[0]!.anchors[1]!.in!.x).toBeCloseTo(11);
    expect(path[0]!.anchors[1]!.in!.y).toBeCloseTo(-9);
  });

  it('adds a point on a segment without changing the curve', () => {
    const path = parsePath('M0 0C0 10 10 10 10 0');
    const before = pointAt(segmentCurve(path[0]!, 0)!, 0.25);
    const { path: split, ref } = insertAnchor(path, 0, 0, 0.5);
    expect(ref).toEqual({ sub: 0, index: 1, part: 'anchor' });
    expect(split[0]!.anchors).toHaveLength(3);
    const after = pointAt(segmentCurve(split[0]!, 0)!, 0.5);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('toggles corner and smooth, deletes points, and bends segments', () => {
    let path = parsePath('M0 0L10 10L20 0');
    path = toggleSmooth(path, { sub: 0, index: 1, part: 'anchor' });
    expect(path[0]!.anchors[1]!.out).not.toBeNull();
    path = toggleSmooth(path, { sub: 0, index: 1, part: 'anchor' });
    expect(path[0]!.anchors[1]!.out).toBeNull();
    expect(serializePath(deleteAnchors(path, [{ sub: 0, index: 1, part: 'anchor' }]))).toBe('M0 0L20 0');
    expect(deleteAnchors(path, [{ sub: 0, index: 0, part: 'anchor' }, { sub: 0, index: 1, part: 'anchor' }])).toEqual([]);
    const bent = bendSegment(parsePath('M0 0L20 0'), 0, 0, 0.5, { x: 10, y: 10 });
    const mid = pointAt(segmentCurve(bent[0]!, 0)!, 0.5);
    expect(mid.x).toBeCloseTo(10);
    expect(mid.y).toBeCloseTo(10);
  });

  it('converts basic shapes to path data', () => {
    expect(shapeToPathData('rect', { x: '0', y: '0', width: '10', height: '5' })).toBe('M0 0H10V5H0Z');
    expect(shapeToPathData('line', { x1: '0', y1: '0', x2: '5', y2: '5' })).toBe('M0 0L5 5');
    expect(shapeToPathData('polygon', { points: '0,0 10,0 5,8' })).toBe('M0 0L10 0L5 8Z');
    expect(parsePath(shapeToPathData('circle', { cx: '10', cy: '10', r: '10' })!)[0]!.anchors).toHaveLength(4);
  });
});

describe('svg attributes', () => {
  it('keeps the case of SVG attribute names (viewBox) but lowercases HTML ones', async () => {
    const { emptyDocument, instantiate } = await import('../src/document/factory.ts');
    const { setAttribute } = await import('../src/document/ops.ts');
    const made = instantiate(emptyDocument(), { tag: 'div', children: [{ tag: 'svg', attrs: { viewBox: '0 0 1 1' }, children: [{ tag: 'path', attrs: { d: 'M0 0' } }] }] });
    const div = made.doc.nodes[made.id] as unknown as { children: string[] };
    const svgId = div.children[0]!;
    let doc = setAttribute(made.doc, svgId, 'viewBox', '0 0 10 10');
    doc = setAttribute(doc, made.id, 'DATA-Thing', 'x');
    expect((doc.nodes[svgId] as unknown as { attrs: Record<string, string> }).attrs).toEqual({ viewBox: '0 0 10 10' });
    expect((doc.nodes[made.id] as unknown as { attrs: Record<string, string> }).attrs).toEqual({ 'data-thing': 'x' });
  });
});

describe('shape tools', () => {
  it('fits polygons and stars to their box', async () => {
    const { polygonPoints, starPoints } = await import('../src/vector/shapes.ts');
    const tri = polygonPoints(3, 100, 80);
    expect(tri).toHaveLength(3);
    expect(Math.min(...tri.map((p) => p.x))).toBe(0);
    expect(Math.max(...tri.map((p) => p.x))).toBe(100);
    expect(Math.min(...tri.map((p) => p.y))).toBe(0);
    expect(Math.max(...tri.map((p) => p.y))).toBe(80);
    expect(tri[0]).toEqual({ x: 50, y: 0 });
    const star = starPoints(5, 0.382, 100, 100);
    expect(star).toHaveLength(10);
    expect(star[0]).toEqual({ x: 50, y: 0 });
  });

  it('constrains drags like Figma', async () => {
    const { dragRect } = await import('../src/vector/shapes.ts');
    expect(dragRect('rectangle', { x: 10, y: 10 }, { x: 60, y: 30 }, true, false).rect).toEqual({ x: 10, y: 10, width: 50, height: 50 });
    expect(dragRect('ellipse', { x: 50, y: 50 }, { x: 70, y: 60 }, false, true).rect).toEqual({ x: 30, y: 40, width: 40, height: 20 });
    const line = dragRect('line', { x: 0, y: 0 }, { x: 100, y: 10 }, true, false);
    expect(line.to.y).toBeCloseTo(0);
    expect(line.to.x).toBeCloseTo(Math.hypot(100, 10));
  });
});

describe('vector inspector', () => {
  it('edits every shape inside a vector, or just the path being edited', async () => {
    const { emptyDocument, instantiate } = await import('../src/document/factory.ts');
    const { vectorShapes } = await import('../src/panels/inspector/VectorSections.tsx');
    const made = instantiate(emptyDocument(), {
      tag: 'svg',
      attrs: { viewBox: '0 0 10 10' },
      children: [{ tag: 'path', attrs: { d: 'M0 0L1 1' } }, { tag: 'g', children: [{ tag: 'circle', attrs: { r: '2' } }] }],
    });
    const shapes = vectorShapes(made.doc, [made.id], null);
    expect(shapes.map((id) => (made.doc.nodes[id] as unknown as { tag: string }).tag)).toEqual(['path', 'circle']);
    expect(vectorShapes(made.doc, [made.id], shapes[0]!)).toEqual([shapes[0]]);
  });
});

describe('corner radius', () => {
  it('rounds straight corners and keeps the source points', async () => {
    const { applyRadii, roundCorners, serializeRadii, setRadius, parsePath: parse, serializePath: serialize } = await import('../src/vector/path.ts');
    const square = parse('M0 0L100 0L100 100L0 100Z');
    const rounded = setRadius(square, [{ sub: 0, index: 1, part: 'anchor' }], 10);
    expect(serializeRadii(rounded)).toBe('0:1:10');
    const drawn = roundCorners(rounded)[0]!;
    // The corner at (100, 0) becomes two points 10px back along each side.
    expect(drawn.anchors).toHaveLength(5);
    expect(drawn.anchors[1]!.x).toBeCloseTo(90);
    expect(drawn.anchors[1]!.y).toBeCloseTo(0);
    expect(drawn.anchors[2]!.x).toBeCloseTo(100);
    expect(drawn.anchors[2]!.y).toBeCloseTo(10);
    expect(drawn.anchors[1]!.out!.x).toBeCloseTo(90 + 10 * 0.5523, 2);
    // Radii survive a round trip through their attribute.
    expect(applyRadii(parse(serialize(rounded)), '0:1:10')[0]!.anchors[1]!.radius).toBe(10);
  });

  it('caps the radius at half of the shorter side', async () => {
    const { roundCorners, setRadius, parsePath: parse } = await import('../src/vector/path.ts');
    const drawn = roundCorners(setRadius(parse('M0 0L20 0L20 100Z'), [{ sub: 0, index: 1, part: 'anchor' }], 999))[0]!;
    expect(drawn.anchors[1]!.x).toBeCloseTo(10);
  });

  it('writes the drawn path to d and the source beside it', async () => {
    const { emptyDocument, instantiate } = await import('../src/document/factory.ts');
    const { readPath, writePath } = await import('../src/vector/edit.ts');
    const { setRadius, parsePath: parse } = await import('../src/vector/path.ts');
    const made = instantiate(emptyDocument(), { tag: 'svg', children: [{ tag: 'path', attrs: { d: 'M0 0L100 0L100 100Z' } }] });
    const pathId = (made.doc.nodes[made.id] as unknown as { children: string[] }).children[0]!;
    const doc = writePath(made.doc, pathId, setRadius(parse('M0 0L100 0L100 100Z'), [{ sub: 0, index: 1, part: 'anchor' }], 8));
    const attrs = (doc.nodes[pathId] as unknown as { attrs: Record<string, string> }).attrs;
    expect(attrs['data-pl-d']).toBe('M0 0L100 0L100 100Z');
    expect(attrs['data-pl-radius']).toBe('0:1:8');
    expect(attrs.d).toContain('C');
    expect(readPath(doc, pathId)[0]!.anchors[1]!.radius).toBe(8);
    const flat = writePath(doc, pathId, setRadius(readPath(doc, pathId), [{ sub: 0, index: 1, part: 'anchor' }], 0));
    expect((flat.nodes[pathId] as unknown as { attrs: Record<string, string> }).attrs).toEqual({ d: 'M0 0L100 0L100 100Z' });

    // `d` edited elsewhere (e.g. the code panel): the stale source and radii are ignored.
    const { setAttribute } = await import('../src/document/ops.ts');
    const edited = setAttribute(doc, pathId, 'd', 'M0 0L50 0L50 50Z');
    const path = readPath(edited, pathId);
    expect(serializePath(path)).toBe('M0 0L50 0L50 50Z');
    expect(path[0]!.anchors.some((a) => a.radius)).toBe(false);
    expect((writePath(edited, pathId, path).nodes[pathId] as unknown as { attrs: Record<string, string> }).attrs).toEqual({ d: 'M0 0L50 0L50 50Z' });
  });
});
