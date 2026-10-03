// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createFrame, moveLayersTo } from '../src/editor/commands';
import { registerElement, unregisterElement } from '../src/canvas/dom';
import { useEditor } from '../src/editor/store';
import { instantiate } from '../src/document/factory';
import { insertRoot, setFrame } from '../src/document/ops';
import { getParentId } from '../src/document/tree';
import { docFrom, el } from './helpers';

const mounted: [string, HTMLElement][] = [];
afterEach(() => {
  for (const [id, node] of mounted.splice(0)) { unregisterElement(id, node); node.remove(); }
  vi.restoreAllMocks();
});
function mount(id: string, x: number, y: number, style = '') {
  const node = document.createElement('div');
  node.style.cssText = style;
  document.body.append(node);
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(x, y, 500, 300));
  registerElement(id, node); mounted.push([id, node]);
  return node;
}
function rule(id: string) {
  const doc = useEditor.getState().doc;
  return doc.styles.rules[el(doc, id).classes[0]!]!;
}
it('creates a frame within the selected nested frame in local coordinates and undoes in one step', () => {
  const f = docFrom({ tag: 'main', children: [{ tag: 'div', className: 'inner' }] });
  const parent = el(f.doc, f.root).children[0]!;
  useEditor.getState().load(f.doc);
  useEditor.setState({ viewport: { x: 20, y: 30, zoom: 2 } });
  useEditor.getState().select([parent]);
  mount(parent, 220, 230, 'position: relative');
  createFrame({ x: 130, y: 140, width: 100, height: 80 });
  const id = useEditor.getState().selection[0]!;
  expect(getParentId(useEditor.getState().doc, id)).toBe(parent);
  expect(useEditor.getState().doc.frames[id]).toBeUndefined();
  expect(rule(id)).toMatchObject({ position: 'absolute', left: '30px', top: '40px', width: '100px' });
  useEditor.getState().undo();
  expect(useEditor.getState().doc).toEqual(f.doc);
});
it('creates a frame in flex flow rather than absolutely positioned', () => {
  const f = docFrom({ tag: 'main', className: 'stack', style: { display: 'flex' } });
  useEditor.getState().load(f.doc); useEditor.getState().select([f.root]);
  mount(f.root, 0, 0, 'display: flex; position: relative');
  createFrame({ x: 20, y: 20, width: 120, height: 80 });
  const id = useEditor.getState().selection[0]!;
  expect(getParentId(useEditor.getState().doc, id)).toBe(f.root);
  expect(rule(id)).toMatchObject({ position: 'relative', 'flex-shrink': '0' });
  expect(rule(id).left).toBeUndefined();
});
it('keeps a new frame on the canvas with no selected container', () => {
  const f = docFrom({ tag: 'main' });
  useEditor.getState().load(f.doc); useEditor.getState().select([]);
  createFrame({ x: 900, y: 500, width: 120, height: 80 });
  const id = useEditor.getState().selection[0]!;
  expect(useEditor.getState().doc.pages[0]!.roots).toContain(id);
  expect(useEditor.getState().doc.frames[id]).toEqual({ x: 900, y: 500 });
});
it('moves a root into flex, clears offsets, preserves size and content, and undoes', () => {
  const f = docFrom({ tag: 'main', className: 'stack', style: { display: 'flex' } });
  const made = instantiate(f.doc, { tag: 'div', className: 'moving', style: { position: 'absolute', left: '90px', top: '10px', width: '120px', height: '80px' }, children: ['Keep me'] });
  const doc = setFrame(insertRoot(made.doc, 'index.html', 1, made.id), made.id, { x: 600, y: 50 });
  useEditor.getState().load(doc);
  mount(f.root, 0, 0, 'display: flex'); mount(made.id, 600, 50);
  moveLayersTo([made.id], f.root, 'inside');
  expect(getParentId(useEditor.getState().doc, made.id)).toBe(f.root);
  expect(rule(made.id)).toMatchObject({ position: 'relative', left: 'auto', top: 'auto', width: '120px', height: '80px' });
  expect(useEditor.getState().doc.frames[made.id]).toBeUndefined();
  useEditor.getState().undo(); expect(useEditor.getState().doc).toEqual(doc);
});
it('keeps world position when reparenting between plain frames and extracting to the canvas', () => {
  const f = docFrom({ tag: 'main', children: [
    { tag: 'div', className: 'a', children: [{ tag: 'div', className: 'child', style: { position: 'absolute', left: '25px', top: '20px' } }] },
    { tag: 'div', className: 'b' },
  ] });
  const [a, b] = el(f.doc, f.root).children; const child = el(f.doc, a).children[0]!;
  useEditor.getState().load(f.doc);
  useEditor.setState({ viewport: { x: 20, y: 30, zoom: 2 } });
  mount(a!, 20, 30, 'position: relative'); mount(b!, 220, 230, 'position: relative'); mount(child, 270, 270);
  moveLayersTo([child], b!, 'inside');
  expect(rule(child)).toMatchObject({ position: 'absolute', left: '25px', top: '20px' });
  moveLayersTo([child], f.root, 'after');
  expect(useEditor.getState().doc.frames[child]).toEqual({ x: 125, y: 120 });
  expect(rule(child)).toMatchObject({ position: 'relative', left: 'auto', top: 'auto' });
});
it('rejects a descendant drop without changing history or selection', () => {
  const f = docFrom({ tag: 'main', children: [{ tag: 'div' }] });
  useEditor.getState().load(f.doc); useEditor.getState().select([f.root]);
  moveLayersTo([f.root], el(f.doc, f.root).children[0]!, 'inside');
  expect(useEditor.getState().doc).toBe(f.doc);
  expect(useEditor.getState().selection).toEqual([f.root]);
});
