// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { copyStyles, hasCopiedStyles, isHidden, isLocked, pasteStyles, reorderSelection, selectableTarget, toggleHidden, toggleLocked } from '../src/editor/layerActions';
import { useEditor } from '../src/editor/store';
import { parseProject, serializeProject } from '../src/serialization';
import { setStyleOnNodes } from '../src/document/ops';
import { docFrom, el } from './helpers';

vi.mock('../src/editor/persistence', () => ({ saveNow: vi.fn(async () => {}), updateShareLink: vi.fn(async () => {}) }));

let root: string;
let kids: string[];
beforeEach(() => {
  const fixture = docFrom({ tag: 'main', children: [{ tag: 'div' }, { tag: 'p' }, { tag: 'section' }] });
  root = fixture.root;
  kids = [...el(fixture.doc, root).children];
  useEditor.getState().load(fixture.doc);
});
const order = () => el(useEditor.getState().doc, root).children;

it('reorders layers to the front, back, forward and backward', () => {
  const [a, b, c] = kids as [string, string, string];
  useEditor.getState().select([a]);
  reorderSelection('front');
  expect(order()).toEqual([b, c, a]);
  reorderSelection('back');
  expect(order()).toEqual([a, b, c]);
  reorderSelection('forward');
  expect(order()).toEqual([b, a, c]);
  reorderSelection('backward');
  expect(order()).toEqual([a, b, c]);
  reorderSelection('backward'); // already at the back: nothing to do
  expect(order()).toEqual([a, b, c]);
});

it('hides with display: none and restores the previous display', () => {
  const [a] = kids as [string];
  useEditor.getState().apply('flex', (d) => setStyleOnNodes(d, [a], 'display', 'flex'));
  useEditor.getState().select([a]);
  toggleHidden();
  let doc = useEditor.getState().doc;
  expect(isHidden(doc, a)).toBe(true);
  expect(el(doc, a).attrs['data-pl-display']).toBe('flex');
  toggleHidden();
  doc = useEditor.getState().doc;
  expect(isHidden(doc, a)).toBe(false);
  expect(doc.styles.rules[el(doc, a).classes[0]!]?.display).toBe('flex');
  expect(el(doc, a).attrs['data-pl-display']).toBeUndefined();
});

it('locks layers, keeps the lock in the project, and passes canvas picks to the parent', () => {
  const [a] = kids as [string];
  useEditor.getState().select([a]);
  toggleLocked();
  const doc = useEditor.getState().doc;
  expect(isLocked(doc, a)).toBe(true);
  expect(selectableTarget(doc, a)).toBe(root);
  expect(selectableTarget(doc, kids[1]!)).toBe(kids[1]);
  expect(parseProject(serializeProject(doc, { viewport: null, collapsed: [], activePage: null })).doc.locked).toEqual([a]);
  toggleLocked([a]);
  expect(isLocked(useEditor.getState().doc, a)).toBe(false);
  useEditor.getState().select([root]);
  toggleLocked();
  expect(selectableTarget(useEditor.getState().doc, a)).toBeNull();
});

it('copies the look of a layer but not its size or position', () => {
  const [a, b] = kids as [string, string];
  useEditor.getState().apply('style', (d) => {
    let next = setStyleOnNodes(d, [a], 'background', 'red');
    next = setStyleOnNodes(next, [a], 'width', '40px');
    return setStyleOnNodes(next, [b], 'width', '90px');
  });
  useEditor.getState().select([a]);
  copyStyles();
  expect(hasCopiedStyles()).toBe(true);
  useEditor.getState().select([b]);
  pasteStyles();
  const doc = useEditor.getState().doc;
  const rule = doc.styles.rules[el(doc, b).classes[0]!]!;
  expect(rule.background).toBe('red');
  expect(rule.width).toBe('90px');
});

it('pastes to replace at the replaced layer’s position', async () => {
  const { copySelectionToClipboard, pasteFromSystemClipboard } = await import('../src/editor/clipboard');
  const [a, b] = kids as [string, string];
  useEditor.getState().apply('place', (d) => {
    let next = setStyleOnNodes(d, [a], 'background', 'blue');
    next = setStyleOnNodes(next, [b], 'position', 'absolute');
    next = setStyleOnNodes(next, [b], 'left', '30px');
    return setStyleOnNodes(next, [b], 'top', '40px');
  });
  useEditor.getState().select([a]);
  await copySelectionToClipboard();
  useEditor.getState().select([b]);
  await pasteFromSystemClipboard('replace');
  const doc = useEditor.getState().doc;
  expect(doc.nodes[b]).toBeUndefined();
  const pasted = order()[1]!;
  expect(pasted).not.toBe(a);
  const rule = doc.styles.rules[el(doc, pasted).classes[0]!]!;
  expect([rule.background, rule.position, rule.left, rule.top]).toEqual(['blue', 'absolute', '30px', '40px']);
});
