// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { alignedPosition, alignAbsoluteLayers } from '../src/editor/absoluteAlignment';
import { registerElement, unregisterElement } from '../src/canvas/dom';
import { useEditor } from '../src/editor/store';
import { docFrom, el } from './helpers';
const nodes: Array<{ id: string; node: HTMLElement }> = [];
afterEach(() => { for (const { id, node } of nodes.splice(0)) { unregisterElement(id, node); node.remove(); } });
it('places start, center and end inside the padded area', () => {
  expect(alignedPosition(10, 180, 40, 'start', 0)).toBe(10);
  expect(alignedPosition(10, 180, 40, 'center', 0)).toBe(80);
  expect(alignedPosition(10, 180, 40, 'end', 0)).toBe(150);
  expect(alignedPosition(10, 180, 40, 'center', 10)).toBe(70);
});
it('aligns an absolute child, preserves transforms and the other axis, and supports undo', () => {
  const { doc, root } = docFrom({ tag: 'div', className: 'frame', style: { display: 'flex' }, children: [{ tag: 'div', className: 'child', style: { position: 'absolute', top: '40px', transform: 'rotate(15deg)' } }] });
  const id = el(doc, root).children[0]!;
  const parent = document.createElement('div'); parent.style.display = 'flex'; parent.style.position = 'static'; parent.style.padding = '10px';
  const child = document.createElement('div'); child.style.position = 'absolute'; parent.append(child); document.body.append(parent);
  for (const [nid, node] of [[root, parent], [id, child]] as const) { registerElement(nid, node); nodes.push({ id: nid, node }); }
  Object.defineProperties(parent, { clientWidth: { value: 200 }, clientHeight: { value: 100 } });
  Object.defineProperties(child, { offsetParent: { value: parent }, offsetLeft: { value: 30 }, offsetTop: { value: 40 } });
  parent.getBoundingClientRect = () => ({ x: 100, y: 200, width: 200, height: 100 }) as DOMRect;
  child.getBoundingClientRect = () => ({ x: 140, y: 260, width: 40, height: 20 }) as DOMRect;
  useEditor.getState().load(doc);
  alignAbsoluteLayers([id], 'x', 'center');
  expect(useEditor.getState().doc.styles.rules.child).toMatchObject({ left: '70px', right: 'auto', top: '40px', position: 'absolute', transform: 'rotate(15deg)' });
  expect(useEditor.getState().doc.styles.rules.frame!.position).toBe('relative');
  useEditor.getState().undo(); expect(useEditor.getState().doc).toEqual(doc);
  child.style.position = 'static'; alignAbsoluteLayers([id], 'y', 'end'); expect(useEditor.getState().doc).toEqual(doc);
});
