// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useAiFavicon } from '../src/app/useAiFavicon';
import { useAiPresence } from '../src/editor/aiPresence';
it('animates Blocks while AI is active and restores all original favicon choices on completion', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  const context = { clearRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), fillStyle: '' };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  let version = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/png;base64,frame${version++}`);
  const icon = document.createElement('link'); icon.rel = 'icon'; icon.href = '/favicon.ico'; document.head.append(icon);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  function Favicon() { useAiFavicon(); return createElement('div', { className: 'ai-favicon-spinner' }, createElement('div', { className: 'ld-blocks-cell', style: { transform: 'none' } })); }
  try {
    await act(async () => root.render(createElement(Favicon)));
    await act(async () => useAiPresence.getState().setActivity([{ id: 'call', file: 'demo', nodeIds: ['frame'], operation: 'get_frame', mode: 'read', expiresAt: Date.now() + 5000 }]));
    const active = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
    expect(active).not.toBe(icon); expect(icon.rel).toBe('plastic-idle-icon'); const first = active.href;
    await act(async () => vi.advanceTimersByTime(240)); expect(active.href).not.toBe(first);
    await act(async () => useAiPresence.getState().setActivity([]));
    expect(document.querySelector('link[rel="icon"]')).toBe(icon); expect(icon.getAttribute('href')).toBe('/favicon.ico'); expect(active.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally { act(() => root.unmount()); host.remove(); icon.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); }
});
