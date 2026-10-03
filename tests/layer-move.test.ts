// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { canMoveLayers, moveLayers } from '../src/document/layerMove';
import { setName } from '../src/document/ops';
import { parseProject, serializeProject } from '../src/serialization';
import { docFrom, el } from './helpers';

describe('layer reordering and nesting', () => {
  const fixture = () => docFrom({ tag: 'main', children: [
    { tag: 'section', children: [{ tag: 'div', children: ['A'] }, { tag: 'div', children: ['B'] }, { tag: 'div', children: ['C'] }] },
    { tag: 'section', children: [] }, { tag: 'img' },
  ] });
  it('reorders siblings in both directions without off-by-one indices', () => {
    const { doc, root } = fixture();
    const parent = el(doc, root).children[0]!;
    const [a, b, c] = el(doc, parent).children;
    const forward = moveLayers(doc, [a!], c!, 'after');
    expect(el(forward, parent).children).toEqual([b, c, a]);
    expect(el(moveLayers(forward, [a!], b!, 'before'), parent).children).toEqual([a, b, c]);
    expect(el(doc, parent).children).toEqual([a, b, c]);
  });
  it('moves multiple layers in document order, preserves names, and survives save/reload', () => {
    const f = fixture();
    const [parent, target] = el(f.doc, f.root).children;
    const [a, b, c] = el(f.doc, parent).children;
    const doc = setName(f.doc, a!, 'Named Layer');
    const moved = moveLayers(doc, [c!, a!], target!, 'inside');
    expect(el(moved, parent).children).toEqual([b]);
    expect(el(moved, target).children).toEqual([a, c]);
    const saved = parseProject(serializeProject(moved, { viewport: null, collapsed: [], activePage: null })).doc;
    expect(el(saved, target).children).toEqual([a, c]);
    expect(saved.names[a!]).toBe('Named Layer');
  });
  it('moves a named root into a container and back onto the canvas', () => {
    const f = fixture();
    const nested = el(f.doc, f.root).children[0]!;
    const named = setName(f.doc, nested, 'Nested Frame');
    const root = moveLayers(named, [nested], f.root, 'after');
    expect(root.pages[0]!.roots).toEqual([f.root, nested]);
    expect(root.frames[nested]).toEqual({ x: 0, y: 0 });
    const back = moveLayers(root, [nested], f.root, 'inside');
    expect(back.frames[nested]).toBeUndefined();
    expect(back.names[nested]).toBe('Nested Frame');
  });
  it('rejects self/descendant cycles and drops into void elements', () => {
    const { doc, root } = fixture();
    const [parent, , img] = el(doc, root).children;
    expect(canMoveLayers(doc, [root], parent!, 'inside')).toBe(false);
    expect(canMoveLayers(doc, [parent!], parent!, 'after')).toBe(false);
    expect(canMoveLayers(doc, [parent!], img!, 'inside')).toBe(false);
    expect(moveLayers(doc, [root], parent!, 'inside')).toBe(doc);
  });
});
