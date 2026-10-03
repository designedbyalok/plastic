// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { setViewportElement } from '../src/canvas/dom';
import { beginTextInsertion, finishTextEditing } from '../src/canvas/textEditing';
import { readableTextColor } from '../src/canvas/textColor';
import { insertAt } from '../src/canvas/gestures';
import { useEditor } from '../src/editor/store';
import { emptyDocument } from '../src/document/factory';
import { serializeStyleSheet } from '../src/document/css';
import { getElement } from '../src/document/tree';
import { parseProject, serializeProject } from '../src/serialization';
import { el } from './helpers';
vi.mock('../src/canvas/layout', async importOriginal => ({ ...await importOriginal<object>(), containerAt: () => null }));
afterEach(() => { finishTextEditing(false); setViewportElement(null); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  vi.spyOn(window, 'focus').mockImplementation(() => {});
  const canvas = document.createElement('div'); canvas.style.backgroundColor = '#282828'; document.body.append(canvas); setViewportElement(canvas);
  useEditor.getState().load(emptyDocument('Test')); useEditor.getState().setViewport({ x: 0, y: 0, zoom: 1 }); useEditor.getState().setTool({ kind: 'insert', itemId: 'text' });
  return canvas;
}
it('chooses white on dark backgrounds, dark on white, and composites transparent backgrounds', () => {
  expect(readableTextColor([], '#282828')).toBe('#ffffff');
  expect(readableTextColor(['#ffffff'], '#282828')).toBe('#111827');
  expect(readableTextColor(['transparent', 'rgba(255,255,255,.9)'], '#282828')).toBe('#111827');
  expect(readableTextColor(['rgba(0,0,0,.9)'], '#ffffff')).toBe('#ffffff');
});
it('inserts no node or history entry for an empty caret even when switching tools', () => {
  setup(); const before = useEditor.getState().doc;
  insertAt({ clientX: 40, clientY: 60 } as PointerEvent, 'text');
  expect(document.querySelector('[aria-label="New Text"]')).not.toBeNull();
  expect(useEditor.getState().doc).toBe(before);
  useEditor.getState().setTool({ kind: 'frame' });
  expect(document.querySelector('[aria-label="New Text"]')).toBeNull();
  expect(useEditor.getState().doc).toBe(before); expect(useEditor.getState().tool.kind).toBe('frame');
});
it('commits typed text as one insertion with Fit width and readable color, preserving the newly chosen tool', () => {
  setup(); insertAt({ clientX: 40, clientY: 60 } as PointerEvent, 'text');
  document.querySelector<HTMLElement>('[aria-label="New Text"]')!.textContent = 'Hello';
  useEditor.getState().setTool({ kind: 'frame' });
  const state = useEditor.getState(); const text = el(state.doc, state.selection[0]);
  expect(state.doc.styles.rules[text.classes[0]!]).toMatchObject({ width: 'max-content', color: '#ffffff', 'font-family': 'Inter, system-ui, sans-serif' });
  expect(state.doc.frames[text.id]).toEqual({ x: 40, y: 60 }); expect(state.tool.kind).toBe('frame');
  useEditor.getState().undo(); expect(Object.keys(useEditor.getState().doc.nodes)).toHaveLength(0);
});
it('preserves multiline text when committing a draft', () => {
  setup(); const commit = vi.fn(); beginTextInsertion({ x: 0, y: 0 }, '#fff', commit);
  document.querySelector<HTMLElement>('[aria-label="New Text"]')!.textContent = 'One\nTwo'; finishTextEditing(); expect(commit).toHaveBeenCalledWith('One\nTwo');
});

it('inserts standalone text without a wrapper, loads variable Inter once, and keeps it through export and undo', () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  useEditor.getState().load(emptyDocument());
  useEditor.setState({ viewport: { x: 0, y: 0, zoom: 1 } });
  const pointer = new MouseEvent('pointerdown', { clientX: 100, clientY: 200 }) as PointerEvent;
  insertAt(pointer, 'text', 'Text');
  let state = useEditor.getState();
  const id = state.selection[0]!;
  const text = getElement(state.doc, id)!;
  expect(state.doc.pages[0]!.roots).toEqual([id]);
  expect(text.tag).toBe('p');
  expect(state.doc.nodes[text.children[0]!]).toMatchObject({ kind: 'text', text: 'Text' });
  expect(state.doc.styles.rules[text.classes[0]!]).toMatchObject({ all: 'unset', width: 'max-content', 'font-family': 'Inter, system-ui, sans-serif' });
  const css = serializeStyleSheet(state.doc.styles);
  expect(css).toContain('font-weight: 100 900');
  expect(css).toContain('data:font/woff2;base64,');
  expect(css).not.toContain('fonts.googleapis.com');
  expect(css).not.toMatch(/background|border|box-shadow|padding/);
  insertAt(pointer, 'heading', 'Heading');
  state = useEditor.getState();
  expect(serializeStyleSheet(state.doc.styles).match(/@font-face/g)).toHaveLength(7);
  const saved = parseProject(serializeProject(state.doc, { viewport: null, collapsed: [], activePage: null })).doc;
  expect(serializeStyleSheet(saved.styles)).toContain('font-weight: 100 900');
  useEditor.getState().undo();
  expect(useEditor.getState().doc.pages[0]!.roots).toEqual([id]);
  useEditor.getState().undo();
  expect(useEditor.getState().doc.pages[0]!.roots).toEqual([]);
  expect(serializeStyleSheet(useEditor.getState().doc.styles)).not.toContain('fonts.googleapis.com');
});
