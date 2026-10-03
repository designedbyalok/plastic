// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { registerElement, unregisterElement } from '../src/canvas/dom';
import { addFlexOrWrap } from '../src/editor/commands';
import { useEditor } from '../src/editor/store';
import { docFrom, el } from './helpers';
const mounted: Array<{ id: string; node: HTMLElement }> = [];
afterEach(() => { for (const { id, node } of mounted.splice(0)) { unregisterElement(id, node); node.remove(); } });
function mount(id: string, tag: string) {
  const node = document.createElement(tag); document.body.append(node); registerElement(id, node); mounted.push({ id, node }); return node;
}
it('wraps a single text selection instead of making the paragraph itself flex, and supports undo', () => {
  const { doc, root } = docFrom({ tag: 'div', children: [{ tag: 'p', className: 'text', style: { width: 'max-content', color: '#fff' }, children: ['Alok'] }] });
  const text = el(doc, root).children[0]!;
  mount(root, 'div').append(mount(text, 'p'));
  useEditor.getState().load(doc); useEditor.getState().select([text]);
  addFlexOrWrap();
  const next = useEditor.getState().doc; const frame = el(next, useEditor.getState().selection[0]!);
  expect(frame.tag).toBe('div'); expect(frame.children).toEqual([text]);
  expect(next.styles.rules[frame.classes[0]!]).toMatchObject({ width: 'max-content', height: 'max-content', padding: '0px', gap: '0px' });
  expect(next.styles.rules[el(next, text).classes[0]!]).toEqual(doc.styles.rules[el(doc, text).classes[0]!]);
  useEditor.getState().undo(); expect(useEditor.getState().doc).toEqual(doc);
});
it('wraps text directly on the canvas and selects the new frame', () => {
  const { doc, root } = docFrom({ tag: 'p', children: ['Standalone'] });
  mount(root, 'p'); useEditor.getState().load(doc); useEditor.getState().select([root]); addFlexOrWrap();
  const next = useEditor.getState().doc; const frame = el(next, useEditor.getState().selection[0]!);
  expect(frame.id).not.toBe(root); expect(frame.children).toEqual([root]); expect(next.pages[0]!.roots).toEqual([frame.id]);
});
