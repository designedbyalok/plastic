// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { insertAt } from '../src/canvas/gestures';
import { useEditor } from '../src/editor/store';
import { emptyDocument } from '../src/document/factory';
import { serializeStyleSheet } from '../src/document/css';
import { getElement } from '../src/document/tree';
import { parseProject, serializeProject } from '../src/serialization';

afterEach(() => vi.unstubAllGlobals());
it('inserts standalone text without a wrapper, loads variable Inter once, and keeps it through export and undo', () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  useEditor.getState().load(emptyDocument());
  useEditor.setState({ viewport: { x: 0, y: 0, zoom: 1 } });
  const pointer = new MouseEvent('pointerdown', { clientX: 100, clientY: 200 }) as PointerEvent;
  insertAt(pointer, 'text');
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
  insertAt(pointer, 'heading');
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
