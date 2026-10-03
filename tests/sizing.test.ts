import { expect, it } from 'vitest';
import { setSize, sizeMode, type SizeContext } from '../src/editor/sizing';
import { wrapInStack } from '../src/document/ops';
import { getParentId } from '../src/document/tree';
import { docFrom, el } from './helpers';

it('fills remaining flex space, prevents hug/fill circular sizing, and returns to fixed or fit', () => {
  const { doc, root } = docFrom({ tag: 'div', className: 'frame', style: { display: 'flex', width: 'max-content' }, children: [{ tag: 'p', className: 'text', style: { width: '60px' }, children: ['Text'] }] });
  const child = el(doc, root).children[0]!;
  const context: SizeContext = { parent: root, main: true, flex: true, parentFit: true, measured: 60, parentMeasured: 100 };
  const filled = setSize(doc, child, 'width', 'fill', context);
  const cls = el(filled, child).classes[0]!;
  expect(filled.styles.rules[cls]).toMatchObject({ width: 'auto', flex: '1 1 0px', 'min-width': '0px' });
  expect(filled.styles.rules[el(filled, root).classes[0]!]!.width).toBe('100px');
  const fixed = setSize(filled, child, 'width', 'fixed', context, '80px');
  expect(fixed.styles.rules[cls]).toMatchObject({ width: '80px', flex: '0 0 auto' });
  expect(fixed.styles.rules[cls]).not.toHaveProperty('min-width');
  expect(setSize(fixed, child, 'width', 'fit', context).styles.rules[cls]!.width).toBe('max-content');
});
it('uses stretch across the flex axis, relative percentages, and recognizes imported CSS', () => {
  const { doc, root } = docFrom({ tag: 'div', children: [{ tag: 'p', className: 'text', style: { width: '40px' } }] });
  const id = el(doc, root).children[0]!;
  const context: SizeContext = { parent: root, main: false, flex: true, measured: 40, parentMeasured: 160, parentFit: false };
  expect(setSize(doc, id, 'width', 'fill', context).styles.rules[el(doc, id).classes[0]!]).toMatchObject({ width: 'auto', 'align-self': 'stretch' });
  expect(setSize(doc, id, 'width', 'relative', context).styles.rules[el(doc, id).classes[0]!]!.width).toBe('25%');
  expect(sizeMode('auto', context, '0', 'stretch')).toBe('fill');
  expect(sizeMode('25%', context)).toBe('relative');
  expect(sizeMode('var(--size)', context)).toBe('fixed');
});
it('wraps standalone text in a transparent intrinsic flex frame at the original canvas position', () => {
  const { doc, root } = docFrom({ tag: 'p', className: 'text', style: { width: 'max-content' }, children: ['Alok'] });
  const result = wrapInStack(doc, [root], { direction: 'column', gap: 0, placement: { x: 42, y: 71 } });
  const frame = el(result.doc, result.id!);
  expect(result.doc.pages[0]!.roots).toEqual([frame.id]);
  expect(getParentId(result.doc, root)).toBe(frame.id);
  expect(result.doc.frames[frame.id]).toEqual({ x: 42, y: 71 });
  expect(result.doc.frames[root]).toBeUndefined();
  expect(result.doc.styles.rules[frame.classes[0]!]).toEqual({ all: 'unset', 'box-sizing': 'border-box', display: 'flex', 'flex-direction': 'column', gap: '0px', width: 'max-content', height: 'max-content', 'align-items': 'flex-start', 'justify-content': 'flex-start', padding: '0px' });
});
