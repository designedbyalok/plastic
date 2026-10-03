// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TokenSlot } from '../src/panels/inspector/fields';
import { useEditor } from '../src/editor/store';
import { useShortcuts } from '../src/editor/shortcuts';
import { docFrom, el } from './helpers';

it('portals a token menu outside clipping containers and preserves binding, keyboard isolation and focus', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const fixture = docFrom({ tag: 'div', style: { width: '80px' } });
  useEditor.getState().load({ ...fixture.doc, tokens: { ...fixture.doc.tokens, values: { 'spacing-1': '8px' } } });
  useEditor.getState().select([fixture.root]);
  const host = document.createElement('div'); host.style.overflow = 'hidden'; document.body.append(host);
  const root = createRoot(host);
  function Field() { useShortcuts(); return createElement(TokenSlot, { ids: [fixture.root], prop: 'width', children: createElement('input') }); }
  try {
    await act(async () => root.render(createElement(Field)));
    const trigger = host.querySelector<HTMLElement>('[aria-label="Use a token for width"]')!;
    trigger.focus();
    const beforeOpen = useEditor.getState().doc;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(useEditor.getState().doc).toBe(beforeOpen);
    let menu = document.querySelector<HTMLElement>('[data-plastic-menu]')!;
    expect(menu).not.toBeNull(); expect(host.contains(menu)).toBe(false);
    const before = useEditor.getState().doc;
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
    expect(useEditor.getState().doc).toBe(before);
    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(e => e.textContent?.includes('spacing-1'))!;
    await act(async () => item.click());
    expect(useEditor.getState().doc.styles.rules[el(useEditor.getState().doc, fixture.root).classes[0]!]!['width']).toBe('var(--spacing-1)');
    expect(document.querySelector('[data-plastic-menu]')).toBeNull();
    // Radix restores focus after the closing portal unmounts. Let that finish before reopening.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const bound = host.querySelector<HTMLElement>('[aria-label="Choose Token for spacing-1"]')!;
    bound.focus();
    await act(async () => bound.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    menu = document.querySelector('[data-plastic-menu]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[data-plastic-menu]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(bound));
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
