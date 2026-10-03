// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { handleCanvasCopy, handleCanvasPaste, importClipboardHtml, ownsTextPaste, pasteArtboard } from '../src/editor/clipboard';
import { useEditor } from '../src/editor/store';
import { emptyDocument } from '../src/document/factory';
import { parseProject, serializeProject } from '../src/serialization';
import { serializeStyleSheet } from '../src/document/css';
import { setStyleOnNodes } from '../src/document/ops';
import { textContent } from '../src/document/tree';
import { docFrom, el } from './helpers';

const capture = '<x-paper-html><section style="display:flex; gap:16px; width:320px; background:#eee" layer-name="Captured card"><h2 style="color:rgb(10, 20, 30)">Hello <em>world</em></h2><svg viewBox="0 0 10 10"><defs><linearGradient id="gradient"><stop offset="0" stop-color="red"/></linearGradient></defs><path fill="url(#gradient)" d="M0 0L10 10"/></svg></section></x-paper-html>';
function pasteEvent(html: string, target: HTMLElement = document.body): ClipboardEvent {
  const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { getData: (format: string) => format === 'text/html' ? html : '' } });
  Object.defineProperty(event, 'composedPath', { value: () => [target] });
  return event;
}

describe('artboard clipboard import', () => {
  beforeEach(() => {
    const f = docFrom({ tag: 'main', className: 'artboard', style: { width: '800px' }, children: [{ tag: 'p', children: ['Existing'] }] });
    useEditor.getState().load(f.doc);
    useEditor.getState().select([f.root]);
  });
  it('unwraps Paper HTML and preserves editable structure, styles and SVG on save/reload', () => {
    const store = useEditor.getState();
    const artboard = store.selection[0]!;
    const result = importClipboardHtml(store.doc, artboard, capture);
    const root = result.ids[0]!;
    expect(el(result.doc, artboard).children).toHaveLength(2);
    expect(result.doc.pages).toEqual(store.doc.pages);
    expect(result.doc.frames).toEqual(store.doc.frames);
    expect(el(result.doc, root).tag).toBe('section');
    expect(textContent(result.doc, root)).toBe('Hello world');
    expect(result.doc.names[root]).toBe('Captured card');
    expect(el(result.doc, root).attrs.style).toBeUndefined();
    expect(result.doc.styles.rules[el(result.doc, root).classes[0]!]).toMatchObject({ display: 'flex', gap: '16px', width: '320px' });
    const edited = setStyleOnNodes(result.doc, [root], 'width', '400px');
    expect(edited.styles.rules[el(edited, root).classes[0]!]?.width).toBe('400px');
    const saved = parseProject(serializeProject(edited, { viewport: null, collapsed: [], activePage: null })).doc;
    expect(textContent(saved, root)).toBe('Hello world');
    expect(Object.values(saved.nodes).some((n) => n.kind === 'element' && n.tag === 'linearGradient')).toBe(true);
  });
  it('gives repeat imports independent classes and connected, unique SVG references', () => {
    const store = useEditor.getState();
    const a = importClipboardHtml(store.doc, store.selection[0]!, capture);
    const b = importClipboardHtml(a.doc, store.selection[0]!, capture);
    expect(el(a.doc, a.ids[0]).classes).not.toEqual(el(b.doc, b.ids[0]).classes);
    const gradients = Object.values(b.doc.nodes).filter((n) => n.kind === 'element' && n.tag === 'linearGradient');
    const paths = Object.values(b.doc.nodes).filter((n) => n.kind === 'element' && n.tag === 'path');
    expect(new Set(gradients.map((n) => n.kind === 'element' && n.attrs.id)).size).toBe(2);
    for (const path of paths) if (path.kind === 'element') expect(gradients.some((n) => n.kind === 'element' && path.attrs.fill === `url(#${n.attrs.id})`)).toBe(true);
  });
  it('restores Paper reset defaults omitted by capture without overriding captured values', () => {
    const store = useEditor.getState();
    const result = importClipboardHtml(store.doc, store.selection[0]!, '<x-paper-html><div style="display:flex;color:white;font-family:system-ui"><button style="border-top-style:solid; background-color:#373737; font-weight:500">Layout</button><input value="Fit" style="border-top-width:3px;appearance:none"><svg fill="none"><path stroke="white" d="M0 0L1 1"/></svg></div></x-paper-html>');
    const root = el(result.doc, result.ids[0]);
    const button = el(result.doc, root.children[0]);
    const input = el(result.doc, root.children[1]);
    const buttonRule = result.doc.styles.rules[button.classes[0]!]!;
    expect(buttonRule).toMatchObject({ border: '0 none', 'border-top-style': 'solid', color: 'inherit', 'font-family': 'inherit', 'background-color': '#373737', 'font-weight': '500', margin: '0', padding: '0' });
    expect(result.doc.styles.rules[input.classes[0]!]!).toMatchObject({ border: '0 none', 'border-top-width': '3px', 'line-height': 'inherit' });
    const svg = el(result.doc, root.children[2]);
    expect(svg.attrs.fill).toBe('none');
    expect(result.doc.styles.rules[svg.classes[0]!]!.fill).toBeUndefined();
    expect(result.doc.styles.rules[svg.classes[0]!]!.stroke).toBeUndefined();
    const ordinary = importClipboardHtml(store.doc, store.selection[0]!, '<button>Ordinary HTML</button>');
    expect(ordinary.doc.styles.rules[el(ordinary.doc, ordinary.ids[0]).classes[0]!]!.border).toBeUndefined();
  });
  it('removes executable markup and rejects CSS injection and unsafe URLs', () => {
    const store = useEditor.getState();
    const result = importClipboardHtml(store.doc, store.selection[0]!, '<div onclick="alert(1)" style="color:red; background:url(javascript:alert(1)); } body { color:blue"><script>alert(1)</script><iframe srcdoc="bad"></iframe><a href="javascript:alert(1)">Safe</a></div>');
    expect(Object.values(result.doc.nodes).some((n) => n.kind === 'element' && ['script', 'iframe'].includes(n.tag))).toBe(false);
    expect(el(result.doc, result.ids[0]).attrs.onclick).toBeUndefined();
    const css = serializeStyleSheet(result.doc.styles);
    expect(css).not.toContain('javascript');
    expect(css).not.toContain('body {');
  });
  it('handles native paste in one undo step and restores selection with redo', () => {
    const before = useEditor.getState().doc;
    const event = pasteEvent(capture);
    handleCanvasPaste(event);
    expect(event.defaultPrevented).toBe(true);
    const pasted = useEditor.getState().doc;
    const selection = useEditor.getState().selection;
    expect(pasted).not.toBe(before);
    useEditor.getState().undo();
    expect(useEditor.getState().doc).toBe(before);
    useEditor.getState().redo();
    expect(useEditor.getState().doc).toBe(pasted);
    expect(useEditor.getState().selection).toEqual(selection);
  });
  it('leaves text controls and inline editing untouched', () => {
    const input = document.createElement('textarea');
    const event = pasteEvent(capture, input);
    expect(ownsTextPaste(event)).toBe(true);
    const before = useEditor.getState().doc;
    handleCanvasPaste(event);
    expect(event.defaultPrevented).toBe(false);
    expect(useEditor.getState().doc).toBe(before);
    useEditor.getState().setEditingText(useEditor.getState().selection[0]!);
    handleCanvasPaste(pasteEvent(capture));
    expect(useEditor.getState().doc).toBe(before);
  });
  it('requires a destination when multiple artboards exist and none is selected', () => {
    const store = useEditor.getState();
    const root = store.selection[0]!;
    const doc = { ...store.doc, pages: [{ ...store.doc.pages[0]!, roots: [root, 'other'] }] };
    expect(pasteArtboard(doc, store.activePage, [])).toBeNull();
    expect(pasteArtboard(doc, store.activePage, [root])).toBe(root);
    expect(pasteArtboard(store.doc, store.activePage, [])).toBeNull();
  });
  it('pastes on an empty canvas without creating a wrapper and round-trips placement', () => {
    const before = emptyDocument();
    const result = importClipboardHtml(before, null, capture, { page: 'index.html', position: { x: 125, y: -50 } });
    const root = result.ids[0]!;
    expect(result.doc.pages[0]!.roots).toEqual([root]);
    expect(el(result.doc, root).tag).toBe('section');
    expect(result.doc.frames[root]).toEqual({ x: 125, y: -50 });
    expect(result.doc.styles.rules[el(result.doc, root).classes[0]!]!.width).toBe('320px');
    const saved = parseProject(serializeProject(result.doc, { viewport: null, collapsed: [], activePage: null })).doc;
    expect(saved.frames[root]).toEqual(result.doc.frames[root]);
    expect(textContent(saved, root)).toBe('Hello world');
  });
  it('routes native paste with no selection onto the canvas and undoes the new roots', () => {
    useEditor.getState().load(emptyDocument());
    const before = useEditor.getState().doc;
    handleCanvasPaste(pasteEvent(capture));
    const pasted = useEditor.getState().doc;
    expect(pasted.pages[0]!.roots).toHaveLength(1);
    expect(useEditor.getState().selection).toEqual(pasted.pages[0]!.roots);
    useEditor.getState().undo();
    expect(useEditor.getState().doc).toBe(before);
    useEditor.getState().redo();
    expect(useEditor.getState().doc).toBe(pasted);
  });
  it('keeps separate clipboard roots separate and removes website offsets on the canvas', () => {
    const result = importClipboardHtml(emptyDocument(), null, '<x-paper-html><div style="position:fixed;left:1000px;top:500px;width:200px">One</div><div style="width:120px">Two</div></x-paper-html>', { page: 'index.html', position: { x: 0, y: 0 } });
    expect(result.doc.pages[0]!.roots).toHaveLength(2);
    expect(result.doc.frames[result.ids[1]!]).toEqual({ x: 232, y: 0 });
    const rule = result.doc.styles.rules[el(result.doc, result.ids[0]).classes[0]!]!;
    expect(rule.position).toBe('relative');
    expect(rule.left).toBeUndefined();
    expect(rule.top).toBeUndefined();
  });
});

describe('native layer cut and copy', () => {
  function clipboard(target: HTMLElement = document.body, fail = false) {
    const data = new Map<string, string>();
    const event = (type: string) => {
      const e = new Event(type, { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(e, 'clipboardData', { value: { getData: (key: string) => data.get(key) ?? '', setData: (key: string, value: string) => { if (fail) throw new Error('Clipboard unavailable'); data.set(key, value); } } });
      Object.defineProperty(e, 'composedPath', { value: () => [target] });
      return e;
    };
    return { event, data };
  }
  it('cuts, pastes with original identity/styles, and makes repeated pastes independent', () => {
    const f = docFrom({ tag: 'main', children: [{ tag: 'section', className: 'card', style: { display: 'flex', gap: '16px' }, children: ['Card'] }, { tag: 'section' }] });
    const [card, destination] = el(f.doc, f.root).children;
    useEditor.getState().load(f.doc);
    useEditor.getState().select([card!]);
    const cb = clipboard();
    const cut = cb.event('cut');
    handleCanvasCopy(cut, true);
    expect(cut.defaultPrevented).toBe(true);
    expect(useEditor.getState().doc.nodes[card!]).toBeUndefined();
    useEditor.getState().select([destination!]);
    handleCanvasPaste(cb.event('paste'));
    expect(el(useEditor.getState().doc, destination).children).toEqual([card]);
    expect(useEditor.getState().doc.styles.rules.card).toMatchObject({ display: 'flex', gap: '16px' });
    useEditor.getState().undo();
    expect(useEditor.getState().doc.nodes[card!]).toBeUndefined();
    useEditor.getState().undo();
    expect(el(useEditor.getState().doc, f.root).children).toEqual([card, destination]);
    useEditor.getState().redo();
    useEditor.getState().redo();
    useEditor.getState().select([destination!]);
    handleCanvasPaste(cb.event('paste'));
    const children = el(useEditor.getState().doc, destination).children;
    expect(children).toHaveLength(2);
    expect(children[1]).not.toBe(card);
    expect(el(useEditor.getState().doc, children[1]).classes).not.toEqual(['card']);
    const saved = parseProject(serializeProject(useEditor.getState().doc, { viewport: null, collapsed: [], activePage: null })).doc;
    expect(textContent(saved, destination!)).toBe('CardCard');
  });
  it('does not delete on a clipboard write failure or intercept editable text', () => {
    const f = docFrom({ tag: 'div', children: ['Keep'] });
    useEditor.getState().load(f.doc); useEditor.getState().select([f.root]);
    handleCanvasCopy(clipboard(document.body, true).event('cut'), true);
    expect(useEditor.getState().doc).toBe(f.doc);
    const input = document.createElement('input');
    const event = clipboard(input).event('cut');
    handleCanvasCopy(event, true);
    expect(event.defaultPrevented).toBe(false);
    expect(useEditor.getState().doc).toBe(f.doc);
  });
});
