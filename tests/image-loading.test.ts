// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageLoading } from '../src/canvas/imageLoading';

let loading: ImageLoading;
let img: HTMLImageElement;
let complete: boolean;
let resolveDecode: () => void;
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  img = document.createElement('img');
  img.setAttribute('data-pl-id', 'image'); img.src = '/pending.png'; img.alt = 'Design asset';
  complete = false;
  Object.defineProperty(img, 'complete', { get: () => complete });
  Object.defineProperty(img, 'naturalWidth', { get: () => complete ? 200 : 0 });
  img.decode = vi.fn(() => new Promise<void>((resolve) => { resolveDecode = resolve; }));
  vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 30, left: 20, top: 30, right: 220, bottom: 130, width: 200, height: 100, toJSON() {} });
  document.body.append(img);
  loading = new ImageLoading(document);
});
afterEach(() => { loading.dispose(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mask = () => document.querySelector<HTMLElement>('[data-plastic-image-loading]');
const flush = () => { const callbacks = frames.splice(0); callbacks.forEach((cb) => cb(0)); };
it('covers the measured image until decode, without changing design attributes or dimensions', async () => {
  const markup = img.outerHTML;
  loading.sync(); flush();
  expect(mask()?.style.width).toBe('200px');
  expect(mask()?.style.left).toBe('20px');
  expect(img.outerHTML).toBe(markup);
  complete = true; img.dispatchEvent(new Event('load'));
  expect(mask()).not.toBeNull();
  resolveDecode(); await Promise.resolve();
  expect(mask()).toBeNull();
  loading.sync(); expect(mask()).toBeNull();
});
it('ignores a stale decode after replacing a source and clears failed requests', async () => {
  loading.sync(); complete = true; loading.sync();
  const finishOld = resolveDecode;
  complete = false; img.src = '/replacement.png'; loading.sync();
  const replacement = mask();
  finishOld(); await Promise.resolve(); expect(mask()).toBe(replacement);
  img.dispatchEvent(new Event('error'));
  expect(mask()).toBeNull();
  loading.sync(); expect(mask()).toBeNull();
});
it('removes masks for deleted images and disposes pending work safely', async () => {
  loading.sync(); img.remove(); loading.sync(); expect(mask()).toBeNull();
  document.body.append(img); complete = true; loading.sync();
  loading.dispose(); resolveDecode(); await Promise.resolve();
  expect(mask()).toBeNull(); flush(); expect(mask()).toBeNull();
});

it('clips a pending mask to its overflowing parent and preserves authored opacity', () => {
  const parent = document.createElement('div');
  parent.style.overflowX = 'hidden'; parent.style.overflowY = 'hidden'; parent.style.opacity = '.5';
  vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({ left: 30, top: 40, right: 130, bottom: 90, x: 30, y: 40, width: 100, height: 50, toJSON() {} });
  Object.defineProperty(parent, 'clientWidth', { value: 100 }); Object.defineProperty(parent, 'clientHeight', { value: 50 });
  document.body.append(parent); parent.append(img);
  loading.sync(); flush();
  expect(mask()?.style.clipPath).toBe('inset(10px 90px 40px 10px)');
  expect(mask()?.style.opacity).toBe('0.5');
});
