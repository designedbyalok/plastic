// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pastePlasticNodes } from '../src/document/clipboardNodes';
import { parseStyleSheet, serializeStyleSheet } from '../src/document/css';
import { defineComponent, instantiateComponent, synchronizeComponents } from '../src/document/components';
import { removeNodes, setText } from '../src/document/ops';
import { textContent } from '../src/document/tree';
import { docFrom, el } from './helpers';

it('copies overlapping class names without corrupting their selectors and keeps responsive CSS', () => {
  const f = docFrom({ tag: 'section', className: 'card', children: [{ tag: 'div', className: 'card-2' }] });
  const source = { ...f.doc, styles: parseStyleSheet('.card {color:red} .card-2 {color:blue} @media (width < 600px) { .card {width:100%} }') };
  const copy = pastePlasticNodes(source, source, [f.root], null, 'index.html', { x: 300, y: 0 });
  const cls = el(copy.doc, copy.ids[0]).classes[0]!;
  const childClass = el(copy.doc, el(copy.doc, copy.ids[0]).children[0]).classes[0]!;
  expect(cls).not.toBe(childClass);
  expect(copy.doc.styles.rules[cls]?.color).toBe('red');
  expect(copy.doc.styles.rules[childClass]?.color).toBe('blue');
  expect(serializeStyleSheet(copy.doc.styles)).toContain(`.${cls} {width:100%}`);
});

describe('portable design references', () => {
  it('remaps SVG ids and CSS references on copies and resolves assets across projects', () => {
    const f = docFrom({ tag: 'section', className: 'card', children: [{ tag: 'svg', children: [
      { tag: 'defs', children: [{ tag: 'linearGradient', attrs: { id: 'paint' } }] },
      { tag: 'path', attrs: { fill: 'url(#paint)', d: 'M0 0L1 1' } },
    ] }, { tag: 'img', attrs: { src: 'assets/photo.png' } }] });
    const source = { ...f.doc, styles: parseStyleSheet('.card {background:url(assets/bg.png)}') };
    const copy = pastePlasticNodes(source, source, [f.root], null, 'index.html', { x: 300, y: 0 }, false, 'http://localhost:5173/__plastic/assets/source/');
    const root = el(copy.doc, copy.ids[0]);
    const svg = el(copy.doc, root.children[0]);
    const defs = el(copy.doc, svg.children[0]);
    const gradient = el(copy.doc, defs.children[0]);
    expect(gradient.attrs.id).not.toBe('paint');
    expect(el(copy.doc, svg.children[1]).attrs.fill).toBe(`url(#${gradient.attrs.id})`);
    expect(el(copy.doc, root.children[1]).attrs.src).toBe('http://localhost:5173/__plastic/assets/source/assets/photo.png');
    expect(copy.doc.styles.rules[root.classes[0]!]!.background).toContain('http://localhost:5173/__plastic/assets/source/assets/bg.png');
  });
});

it('restores component links when a main is cut and keeps copied instances synchronized', () => {
  const f = docFrom({ tag: 'section', children: [{ tag: 'h2', children: ['Title'] }] });
  const defined = defineComponent(f.doc, f.root, 'Card');
  const instance = instantiateComponent(defined, f.root, 'index.html', f.root);
  const cut = synchronizeComponents(removeNodes(instance.doc, [f.root]));
  expect(cut.components?.instances[instance.id!]).toBeUndefined();
  const pasted = synchronizeComponents(pastePlasticNodes(cut, instance.doc, [f.root], null, 'index.html', { x: 100, y: 0 }, true).doc);
  expect(pasted.components?.instances[instance.id!]?.source).toBe(f.root);
  const both = pastePlasticNodes(pasted, pasted, [f.root, instance.id!], null, 'index.html', { x: 200, y: 0 });
  const synced = synchronizeComponents(both.doc);
  expect(synced.components?.instances[both.ids[1]!]!.source).toBe(both.ids[0]);
  const heading = el(synced, both.ids[0]).children[0]!;
  const changed = synchronizeComponents(setText(synced, heading, 'Updated'));
  expect(textContent(changed, both.ids[1]!)).toBe('Updated');
  expect(textContent(changed, instance.id!)).toBe('Title');
});
