// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useShortcuts } from '../src/editor/shortcuts';
import { useEditor } from '../src/editor/store';
import { docFrom, el } from './helpers';
vi.mock('../src/editor/persistence', () => ({ saveNow: vi.fn(async (_value: string) => {}), updateShareLink: vi.fn(async () => {}) }));
const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.unstubAllGlobals();
});
it('copies a nested selection link with Cmd+L and the file link with no selection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const clipboard = vi.fn(async (_value: string) => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  const fixture = docFrom({ tag: 'main', children: [{ tag: 'section' }] });
  const child = el(fixture.doc, fixture.root).children[0]!;
  useEditor.getState().load(fixture.doc);
  useEditor.getState().select([child]);
  useEditor.setState({ agentsOpen: false, saveStatus: 'saved' });
  history.replaceState(null, '', '/file/demo?frame=old&preview=abc123');
  function Shortcuts() { useShortcuts(); return null; }
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Shortcuts)); });
  const press = async () => {
    const event = new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', metaKey: true, bubbles: true, cancelable: true });
    await act(async () => { document.body.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  };
  try {
    await press();
    await vi.waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    expect(new URL(clipboard.mock.calls[0]![0] as string).searchParams.get('frame')).toBe(child);
    useEditor.getState().select([]);
    await press();
    await vi.waitFor(() => expect(clipboard).toHaveBeenCalledTimes(2));
    const link = new URL(clipboard.mock.calls[1]![0] as string);
    expect(link.pathname).toBe('/file/demo');
    expect(link.searchParams.get('frame')).toBeNull();
    expect(link.searchParams.get('preview')).toBe('abc123');
  } finally { act(() => root.unmount()); }
});

it('keeps the previous document safe while the file skeleton is opening', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fixture = docFrom({ tag: 'main', children: [{ tag: 'p', children: ['Existing text'] }] });
  const child = el(fixture.doc, fixture.root).children[0]!;
  useEditor.getState().load(fixture.doc); useEditor.getState().select([child]);
  function Shortcuts({ enabled }: { enabled: boolean }) { useShortcuts(enabled); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(createElement(Shortcuts, { enabled: false })));
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })));
    expect(useEditor.getState().doc.nodes[child]).toBeDefined();
    await act(async () => root.render(createElement(Shortcuts, { enabled: true })));
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })));
    expect(useEditor.getState().doc.nodes[child]).toBeUndefined();
  } finally { act(() => root.unmount()); }
});
