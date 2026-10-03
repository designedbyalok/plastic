// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FillSection } from '../src/panels/inspector/FillSection.tsx';
import { useEditor } from '../src/editor/store.ts';
import { docFrom, el } from './helpers.ts';
import { parseCssGradient } from '../src/paint/gradient.ts';

let host: HTMLDivElement;
let root: Root;
let id: string;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function mount(style: Record<string, string>, textual = false) {
  const fixture = docFrom({ tag: textual ? 'p' : 'div', className: 'fill-example', style, children: textual ? ['Plastic'] : [] });
  id = fixture.root; useEditor.getState().load(fixture.doc);
  act(() => root.render(createElement(FillSection, { ids: [id], textual })));
}
function css() { const doc = useEditor.getState().doc; return doc.styles.rules[el(doc, id).classes[0]!]!; }
function click(label: string) { act(() => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()); }
function enter(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('reads imported gradient longhands, edits each stop, and removes obsolete longhands when switching to solid', () => {
  mount({ 'background-image': 'linear-gradient(90deg, #ffffff 0%, #bebebe 100%)', 'background-color': '#000000' });
  expect(host.querySelector('[aria-label="Gradient"]')!.getAttribute('aria-checked')).toBe('true');
  enter('Stop 2 Color', 'FF0000');
  expect(parseCssGradient(css().background!)!.stops[1]!.color).toBe('#ff0000');
  click('Solid');
  expect(css().background).toBe('#ffffff');
  expect(css()['background-image']).toBeUndefined();
  act(() => useEditor.getState().undo());
  expect(parseCssGradient(css().background!)!.stops[1]!.color).toBe('#ff0000');
});
it('can choose Image without destroying the existing fill before an image is supplied', () => {
  mount({ background: '#123456' });
  click('Image');
  expect(host.querySelector('[aria-label="Choose Fill Image"]')).not.toBeNull();
  expect(css().background).toBe('#123456');
  click('Solid');
  expect(css().background).toBe('#123456');
});
it('preserves text backgrounds for solid color edits and clips gradient fills to the glyphs', () => {
  mount({ color: '#ffffff', background: '#123456' }, true);
  enter('Fill Color', 'FF0000');
  expect(css().color).toBe('#ff0000');
  expect(css().background).toBe('#123456');
  click('Gradient');
  expect(css().color).toBe('transparent');
  expect(css()['background-clip']).toBe('text');
  click('Solid');
  expect(css().color).toBe('#ff0000');
  expect(css()['background-clip']).toBeUndefined();
});
it('opens a portaled color picker and restores a previous color', async () => {
  mount({ background: '#123456' });
  click('Fill Color Picker');
  expect(document.querySelector('.paint-picker')).not.toBeNull();
  expect(host.querySelector('.paint-picker')).toBeNull();
  const input = document.querySelector<HTMLInputElement>('[aria-label="Picker Hex Color"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'ABCDEF'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(css().background).toBe('#abcdef');
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Restore Previous Color"]')!.click());
  expect(css().background).toBe('#123456');
});
it('embeds an uploaded image, sets image sizing, and retains undo', async () => {
  mount({ background: '#123456' });
  click('Image');
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['test-image'], 'photo.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(css().background).toContain('url("data:image/png;base64,');
  expect(css()['background-size']).toBe('cover');
  expect(css()['background-repeat']).toBe('no-repeat');
  act(() => useEditor.getState().undo());
  expect(css().background).toBe('#123456');
});
it('cancels a pending image read when the user switches fill type', () => {
  const readers: { abort: ReturnType<typeof vi.fn>; onload?: () => void; result: string }[] = [];
  vi.stubGlobal('FileReader', class {
    result = 'data:image/png;base64,late'; onload?: () => void; abort = vi.fn(); readAsDataURL() {}
    constructor() { readers.push(this); }
  });
  mount({ background: '#123456' }); click('Image');
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'x.png', { type: 'image/png' })] });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  click('Solid');
  expect(readers[0]!.abort).toHaveBeenCalled();
  act(() => readers[0]!.onload?.());
  expect(css().background).toBe('#123456');
});
