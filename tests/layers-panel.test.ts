// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayersPanel } from '../src/panels/LayersPanel';
import { Inspector } from '../src/panels/inspector/Inspector';
import { importClipboardHtml } from '../src/editor/clipboard';
import { useEditor } from '../src/editor/store';
import { instantiate } from '../src/document/factory';
import { shapeSpec } from '../src/vector/shapes';
import { insertRoot, setFrame, setTitle, setStyleOnNodes } from '../src/document/ops';
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
  useEditor.setState({ readOnly: false });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
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
  it('toggles visibility from the row without changing selection and restores its layout on show and undo', () => {
    const fixture = mount();
    act(() => useEditor.getState().select([fixture.child]));
    act(() => useEditor.getState().apply('Set Flex', d => setStyleOnNodes(d, [fixture.parent], 'display', 'flex')));
    flushFrames();
    const row = container.querySelector(`[data-layer-id="${fixture.parent}"]`)!;
    const button = row.querySelector<HTMLButtonElement>('[aria-label="Hide Layer"]')!;
    act(() => {
      button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      button.click();
      button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const cls = el(useEditor.getState().doc, fixture.parent).classes[0]!;
    expect(useEditor.getState().doc.styles.rules[cls]?.display).toBe('none');
    expect(useEditor.getState().selection).toEqual([fixture.child]);
    expect(button.getAttribute('aria-label')).toBe('Show Layer');
    expect(button.classList.contains('is-hidden')).toBe(true);
    expect(row.classList.contains('layer-is-hidden')).toBe(true);
    expect(row.querySelector('.layer-rename')).toBeNull();
    act(() => button.click());
    expect(useEditor.getState().doc.styles.rules[cls]?.display).toBe('flex');
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().doc.styles.rules[cls]?.display).toBe('none');
    act(() => useEditor.getState().setReadOnly(true));
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(useEditor.getState().doc.styles.rules[cls]?.display).toBe('none');
  });

  it('replaces element tags with undoable lock actions without changing selection or starting a rename', () => {
    const fixture = mount();
    act(() => useEditor.getState().select([fixture.child]));
    flushFrames();
    const row = container.querySelector(`[data-layer-id="${fixture.parent}"]`)!;
    expect(row.querySelector('.layer-tag')).toBeNull();
    const lock = row.querySelector<HTMLButtonElement>('[aria-label="Lock Layer"]')!;
    act(() => {
      lock.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      lock.click();
      lock.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(useEditor.getState().doc.locked).toContain(fixture.parent);
    expect(useEditor.getState().selection).toEqual([fixture.child]);
    expect(row.querySelector('.layer-rename')).toBeNull();
    expect(lock.getAttribute('aria-label')).toBe('Unlock Layer');
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    act(() => lock.click());
    expect(useEditor.getState().doc.locked).not.toContain(fixture.parent);
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().doc.locked).toContain(fixture.parent);
    act(() => useEditor.getState().setReadOnly(true));
    expect(lock.disabled).toBe(true);
    act(() => lock.click());
    expect(useEditor.getState().doc.locked).toContain(fixture.parent);
  });

  it('nests a dragged frame into a collapsed frame, expands it, and restores the tree on undo', () => {
    const fixture = docFrom({ tag: 'main', children: [
      { tag: 'div', className: 'source', children: [{ tag: 'span', children: ['Content'] }] },
      { tag: 'div', className: 'target', children: [{ tag: 'span', children: ['Existing'] }] },
    ] });
    const [source, target] = el(fixture.doc, fixture.root).children;
    useEditor.getState().load(fixture.doc);
    useEditor.setState({ layersOpen: true, leftTab: 'design', collapsed: { [target!]: true } });
    act(() => root.render(createElement(LayersPanel)));
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    const dispatch = (row: Element, type: string, y = 50) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      act(() => row.dispatchEvent(event));
      return event;
    };
    dispatch(container.querySelector(`[data-layer-id="${source}"]`)!, 'dragstart');
    const targetRow = container.querySelector(`[data-layer-id="${target}"]`)!;
    expect(dispatch(targetRow, 'dragover').defaultPrevented).toBe(true);
    expect(targetRow.classList.contains('drop-inside')).toBe(true);
    dispatch(targetRow, 'drop');
    expect(el(useEditor.getState().doc, target).children).toContain(source);
    expect(useEditor.getState().selection).toEqual([source]);
    expect(useEditor.getState().collapsed[target!]).toBeUndefined();
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().doc).toEqual(fixture.doc);
  });
  it('expands ancestors, marks the selected row and instantly reveals it without moving keyboard focus', () => {
    const fixture = mount();
    const input = container.querySelector<HTMLInputElement>('.file-title')!;
    input.focus();
    act(() => useEditor.getState().select([fixture.child]));
    flushFrames();
    expect(useEditor.getState().collapsed[fixture.root]).toBeUndefined();
    expect(useEditor.getState().collapsed[fixture.parent]).toBeUndefined();
    expect(container.querySelector(`[data-layer-id="${fixture.child}"]`)?.getAttribute('aria-selected')).toBe('true');
    expect(scroll).toHaveBeenCalledWith({ top: 153, behavior: 'instant' });
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

describe('imported styles in the inspector', () => {
  it('populates ordinary fields and keeps advanced tools collapsed below them without duplicating base declarations', () => {
    const fixture = docFrom({ tag: 'main' });
    const pasted = importClipboardHtml(fixture.doc, null,
      '<x-paper-html><div style="display:flex;gap:16px;width:320px;padding:24px;background-color:rgb(30,30,30)">Card</div></x-paper-html>',
      { page: 'index.html', position: { x: 0, y: 0 } });
    useEditor.getState().load(pasted.doc);
    useEditor.getState().select(pasted.ids);
    act(() => root.render(createElement(Inspector)));
    flushFrames();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="width"]')?.value).toBe('320');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="gap"]')?.value).toBe('16');
    const responsive = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Responsive & States')!;
    const source = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Style Source')!;
    expect(responsive.getAttribute('aria-expanded')).toBe('false');
    expect(source.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent!.indexOf('Layout')).toBeLessThan(container.textContent!.indexOf('Responsive & States'));
    act(() => responsive.click());
    expect(responsive.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[aria-label="Variant width"]')).toBeNull();
    expect(container.querySelector('[aria-label="New variant declaration"]')).toBeNull();
    expect(container.textContent).toContain('Base styles are edited in Layout');
  });
});

it('maps the alignment pad to CSS for vertical and reversed horizontal layouts', () => {
  const f = docFrom({ tag: 'main', className: 'layout', style: { display: 'flex', 'flex-direction': 'column', padding: '8px 12px' } });
  useEditor.getState().load(f.doc); useEditor.getState().select([f.root]);
  act(() => root.render(createElement(Inspector))); flushFrames();
  expect(container.querySelectorAll('.flex-alignment button')).toHaveLength(9);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Padding X"]')?.value).toBe('12');
  expect(container.querySelector<HTMLInputElement>('[aria-label="Padding Y"]')?.value).toBe('8');
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Align Bottom Left"]')!.click());
  expect(useEditor.getState().doc.styles.rules.layout).toMatchObject({ 'justify-content': 'flex-end', 'align-items': 'flex-start' });
  act(() => container.querySelector<HTMLButtonElement>('[title="Horizontal"]')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Reverse Direction"]')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Align Top Left"]')!.click());
  expect(useEditor.getState().doc.styles.rules.layout).toMatchObject({ 'flex-direction': 'row-reverse', 'justify-content': 'flex-end', 'align-items': 'flex-start' });
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Advanced Flex Options"]')!.click());
  expect(container.querySelector('[aria-label="Wrap"]')).not.toBeNull();
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove Flex"]')!.click());
  expect(useEditor.getState().doc.styles.rules.layout?.display).toBeUndefined();
  expect(useEditor.getState().doc.styles.rules.layout?.padding).toBe('8px 12px');
});

it('creates a white rectangle with its drawn height and no carried-over border or shadow controls', () => {
  const f = docFrom({ tag: 'div', className: 'first', style: { width: '100px', height: '100px' } });
  useEditor.getState().load(f.doc); useEditor.getState().select([f.root]);
  act(() => root.render(createElement(Inspector))); flushFrames();
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add border"]')!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add shadow"]')!.click());
  const old = useEditor.getState().doc;
  const spec = shapeSpec('rectangle', { root: true, left: 0, top: 0, width: 240, height: 160 }, { x: 0, y: 0 }, { x: 240, y: 160 });
  const made = instantiate(old, spec);
  act(() => useEditor.getState().apply('Add Rectangle', () => setFrame(insertRoot(made.doc, 'index.html', 1, made.id), made.id, { x: 200, y: 0 }), { select: [made.id] }));
  flushFrames();
  expect(container.querySelector<HTMLInputElement>('[aria-label="Fill Color"]')?.value).toBe('FFFFFF');
  expect(container.querySelector<HTMLInputElement>('[aria-label="height"]')?.value).toBe('160');
  expect(container.querySelector('[aria-label="border"]')).toBeNull();
  expect(container.querySelector('[aria-label="box-shadow"]')).toBeNull();
  expect(container.querySelector('[aria-label="Add border"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Add shadow"]')).not.toBeNull();
  expect(useEditor.getState().doc.styles.rules.first).toMatchObject({ border: '1px solid #d1d5db', 'box-shadow': '0 1px 3px rgb(0 0 0 / 0.12)' });
  const rule = useEditor.getState().doc.styles.rules[el(useEditor.getState().doc, made.id).classes[0]!]!;
  expect(rule.border).toBeUndefined();
  expect(rule['box-shadow']).toBeUndefined();
});
