// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayersPanel } from '../src/panels/LayersPanel';
import { useEditor } from '../src/editor/store';
import { setTitle } from '../src/document/ops';
import { docFrom, el } from './helpers';

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let scroll: ReturnType<typeof vi.fn>;
let reducedMotion = false;
function flushFrames() {
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  reducedMotion = false;
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
  scroll = vi.fn();
  vi.stubGlobal('scrollTo', scroll);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scroll });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains('is-selected') && this.classList.contains('layer-row') ? 200 : 0;
    return { x: 0, y: top, top, left: 0, right: 240, bottom: top + (top ? 28 : 100), width: 240, height: top ? 28 : 100, toJSON() {} };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const fixture = docFrom({ tag: 'main', children: [{ tag: 'section', children: [{ tag: 'button', children: ['Choose me'] }] }] });
  const parent = el(fixture.doc, fixture.root).children[0]!;
  const child = el(fixture.doc, parent).children[0]!;
  useEditor.getState().load(fixture.doc);
  useEditor.setState({ layersOpen: true, leftTab: 'design', collapsed: { [fixture.root]: true, [parent]: true } });
  act(() => root.render(createElement(LayersPanel)));
  flushFrames();
  return { ...fixture, parent, child };
}

describe('canvas selection in the layers panel', () => {
  it('expands ancestors, marks the selected row and smoothly reveals it without moving keyboard focus', () => {
    const fixture = mount();
    const input = container.querySelector<HTMLInputElement>('.file-title')!;
    input.focus();
    act(() => useEditor.getState().select([fixture.child]));
    flushFrames();
    expect(useEditor.getState().collapsed[fixture.root]).toBeUndefined();
    expect(useEditor.getState().collapsed[fixture.parent]).toBeUndefined();
    expect(container.querySelector(`[data-layer-id="${fixture.child}"]`)?.getAttribute('aria-selected')).toBe('true');
    expect(scroll).toHaveBeenCalledWith({ top: 153, behavior: 'smooth' });
    expect(document.activeElement).toBe(input);
    scroll.mockClear();
    act(() => useEditor.getState().setCollapsed(fixture.root, true));
    act(() => useEditor.getState().apply('Rename file', (doc) => setTitle(doc, 'Updated')));
    flushFrames();
    expect(useEditor.getState().collapsed[fixture.root]).toBe(true);
    expect(scroll).not.toHaveBeenCalled();
  });
  it('uses immediate scrolling when reduced motion is requested', () => {
    const fixture = mount();
    reducedMotion = true;
    act(() => useEditor.getState().select([fixture.child]));
    flushFrames();
    expect(scroll).toHaveBeenCalledWith({ top: 153, behavior: 'instant' });
  });
});
