// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Rulers } from '../src/canvas/Rulers';
import { useEditor } from '../src/editor/store';
import { emptyDocument } from '../src/document/factory';
import { setRulerGuide } from '../src/document/guides';
import { setViewportElement } from '../src/canvas/dom';

let root: Root, canvas: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map(); let index = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++index, cb); return index; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  canvas = document.createElement('div'); document.body.appendChild(canvas);
  Object.defineProperty(canvas, 'clientWidth', { value: 600 });
  Object.defineProperty(canvas, 'clientHeight', { value: 400 });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 600, bottom: 400, x: 0, y: 0, width: 600, height: 400, toJSON() {} });
  setViewportElement(canvas);
  useEditor.getState().load(emptyDocument());
  useEditor.setState({ rulersVisible: true, viewport: { x: 0, y: 0, zoom: 1 }, spacePressed: false, tool: { kind: 'select' } });
  root = createRoot(canvas);
});
afterEach(() => { act(() => root.unmount()); canvas.remove(); setViewportElement(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function flush() { act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); }); }
function mount() { act(() => root.render(createElement(Rulers))); flush(); }
function pointer(target: EventTarget, type: string, x: number, y: number, altKey = false) {
  act(() => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, altKey })));
}
it('cancels a new guide on Escape and commits a drag as one undo operation', () => {
  mount();
  const ruler = canvas.querySelector('.ruler-x')!;
  pointer(ruler, 'pointerdown', 100, 10); pointer(window, 'pointermove', 100, 140);
  expect(useEditor.getState().doc.pages[0]!.guides).toHaveLength(1);
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(useEditor.getState().doc.pages[0]!.guides).toBeUndefined();
  expect(useEditor.getState().tx).toBeNull();
  pointer(ruler, 'pointerdown', 100, 10); pointer(window, 'pointermove', 100, 150); pointer(window, 'pointerup', 100, 160);
  expect(useEditor.getState().doc.pages[0]!.guides?.[0]).toMatchObject({ axis: 'y', value: 160 });
  expect(useEditor.getState().tx).toBeNull();
  act(() => useEditor.getState().undo()); expect(useEditor.getState().doc.pages[0]!.guides).toBeUndefined();
});
it('Alt-drags a duplicate and returns a guide to the ruler without deleting design layers', () => {
  useEditor.setState({ doc: setRulerGuide(useEditor.getState().doc, 'index.html', { id: 'original', axis: 'x', value: 100 }) });
  mount();
  pointer(canvas.querySelector('.guide-x')!, 'pointerdown', 100, 100, true);
  pointer(window, 'pointermove', 180, 100); pointer(window, 'pointerup', 180, 100);
  const guides = useEditor.getState().doc.pages[0]!.guides!;
  expect(guides).toHaveLength(2);
  expect(guides[0]).toEqual({ id: 'original', axis: 'x', value: 100 });
  expect(guides[1]).toMatchObject({ axis: 'x', value: 180 });
  expect(guides[1]!.id).not.toBe('original');
  pointer(canvas.querySelector('[data-guide-id="original"]')!, 'pointerdown', 100, 100);
  pointer(window, 'pointermove', 10, 100); pointer(window, 'pointerup', 10, 100);
  expect(useEditor.getState().doc.pages[0]!.guides).toHaveLength(1);
  expect(useEditor.getState().doc.nodes).toEqual({});
  act(() => useEditor.getState().undo()); expect(useEditor.getState().doc.pages[0]!.guides).toHaveLength(2);
});
it('keeps guide clipboard and menu shortcuts from acting on the canvas selection', () => {
  useEditor.setState({ doc: setRulerGuide(useEditor.getState().doc, 'index.html', { id: 'original', axis: 'x', value: 100 }) });
  mount();
  const guide = canvas.querySelector('[data-guide-id="original"]')!;
  const event = new Event('cut', { bubbles: true, cancelable: true });
  act(() => guide.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  const duplicate = new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true, cancelable: true });
  act(() => guide.dispatchEvent(duplicate));
  expect(duplicate.defaultPrevented).toBe(true);
  expect(useEditor.getState().doc.pages[0]!.guides?.[1]).toMatchObject({ axis: 'x', value: 110 });
  act(() => guide.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
  const received = vi.fn(); window.addEventListener('keydown', received);
  act(() => canvas.querySelector('[role="menuitem"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
  expect(received).not.toHaveBeenCalled();
  expect(useEditor.getState().doc.pages[0]!.guides).toHaveLength(2);
  window.removeEventListener('keydown', received);
});
