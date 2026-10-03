/** Native clipboard import into an existing artboard. */
import DOMPurify from 'dompurify';
import postcss from 'postcss';
import safeParse from 'postcss-safe-parser';
import valueParser from 'postcss-value-parser';
import { parseStyleSheet, serializeStyleSheet } from '../document/css.ts';
import { takenClassNames, uniqueClassName } from '../document/factory.ts';
import { createId } from '../document/ids.ts';
import { VOID_TAGS } from '../document/markup.ts';
import { getViewportElement } from '../canvas/dom.ts';
import { screenToWorld } from '../canvas/coords.ts';
import { getElement, getParentId, rootOf, topmostIds, textContent } from '../document/tree.ts';
import type { DesignDocument, DocNode, NodeId, Point } from '../document/types.ts';
import { escapeText, parseHTML } from '../serialization/html.ts';
import { serializeNode } from '../serialization/html.ts';
import { pastePlasticNodes } from '../document/clipboardNodes.ts';
import { removeNodes } from '../document/ops.ts';
import { domElement, styleOf } from '../canvas/dom.ts';
import { elementSpec } from '../elements/registry.ts';
import { notify } from '../canvas/gestureStore.ts';
import { useEditor } from './store.ts';

/** Snapshot omits values matching its neutral capture baseline, not each tag's UA defaults.
 * Keep this in each editable rule before captured declarations; never reset the whole artboard.
 * Avoid `all`/fill/stroke resets, which would override SVG presentation attributes.
 */
export const PAPER_CAPTURE_BASELINE = `
margin: 0;
padding: 0;
border: 0 none;
border-radius: 0;
background-color: transparent;
box-shadow: none;
color: inherit;
font-family: inherit;
font-weight: 400;
line-height: inherit;
text-align: initial;
text-decoration: none;
`;

/** The editor's input widgets own paste, including those in an artboard iframe. */
export function ownsTextPaste(e: Event): boolean {
  const target = e.composedPath()[0] as HTMLElement | undefined;
  return !!target && target.nodeType === 1 && (
    target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, [role="combobox"], [role="listbox"], [data-plastic-select]')
  );
}

/** Choose the selected artboard, never an arbitrary artboard on a multi-artboard page. */
export function pasteArtboard(doc: DesignDocument, page: string, selection: readonly NodeId[], hint?: NodeId): NodeId | null {
  const roots = doc.pages.find((p) => p.file === page)?.roots ?? [];
  const candidates = new Set(selection.filter((id) => doc.nodes[id]).map((id) => rootOf(doc, id)).filter((id) => roots.includes(id)));
  if (hint && roots.includes(hint)) return hint;
  if (candidates.size === 1) return [...candidates][0]!;
  return null;
}

function safeDeclarations(style: string): string {
  const parsed = safeParse(`a { ${style} }`);
  const rule = parsed.first;
  const clean = postcss.rule({ selector: 'a' });
  if (rule?.type === 'rule') for (const decl of rule.nodes) {
    if (decl.type !== 'decl' || /^(behavior|-moz-binding)$/i.test(decl.prop)) continue;
    let safe = true;
    const value = valueParser(decl.value);
    value.walk((node) => {
      if (node.type !== 'function') return;
      if (node.value.toLowerCase() === 'expression') safe = false;
      if (node.value.toLowerCase() === 'url') {
        const url = valueParser.stringify(node.nodes).trim().replace(/^(['"])(.*)\1$/, '$2');
        // Escaped schemes cannot bypass the URL policy. Preserve SVG local references.
        if (url.includes('\\') || !/^(#|https?:\/\/|data:image\/(png|jpeg|gif|webp|avif);)/i.test(url)) safe = false;
      }
    });
    if (safe) clean.append(decl.clone());
  }
  return clean.nodes.map((n) => n.toString() + ';').join('\n');
}

export function importClipboardHtml(doc: DesignDocument, artboard: NodeId | null, html: string, canvas?: { page: string; position: Point }): { doc: DesignDocument; ids: NodeId[] } {
  const parent = getElement(doc, artboard);
  if (artboard && (!parent || VOID_TAGS.has(parent.tag) || parent.tag === 'svg')) throw new Error('Select an HTML artboard to paste into.');
  if (!parent && (!canvas || !doc.pages.some((p) => p.file === canvas.page))) throw new Error('No active page to paste into.');
  if (html.length > 5_000_000) throw new Error('This clipboard capture is too large. Copy a smaller section.');
  const paperCapture = /<x-paper-html(?:\s|>)/i.test(html);
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['x-paper-html'], ADD_ATTR: ['layer-name'],
    FORBID_TAGS: ['style', 'link', 'iframe', 'object', 'embed', 'base'],
    FORBID_ATTR: ['srcdoc', 'contenteditable', 'autofocus', 'data-pl-id'],
  });
  const dom = new DOMParser().parseFromString(sanitized, 'text/html');
  for (const wrapper of Array.from(dom.querySelectorAll('x-paper-html'))) wrapper.replaceWith(...Array.from(wrapper.childNodes));
  // HTML ids used by SVG references must remain connected, but cannot collide on repeat paste.
  const ids = new Map<string, string>();
  for (const element of Array.from(dom.body.querySelectorAll('[id]'))) {
    const previous = element.id;
    const fresh = `paste-${createId()}`;
    ids.set(previous, fresh);
    element.id = fresh;
  }
  for (const element of Array.from(dom.body.querySelectorAll('*'))) for (const attr of Array.from(element.attributes)) {
    if (attr.name === 'id') continue;
    let value = attr.value;
    if ((attr.name === 'href' || attr.name === 'xlink:href') && value.startsWith('#')) value = '#' + (ids.get(value.slice(1)) ?? value.slice(1));
    value = value.replace(/url\(\s*(['"]?)#([^\s)'" ]+)\1\s*\)/g, (_match, _quote: string, id: string) => `url(#${ids.get(id) ?? id})`);
    element.setAttribute(attr.name, value);
  }
  // parseHTML imports element roots; make top-level clipboard text a real editable layer.
  for (const node of Array.from(dom.body.childNodes)) if (node.nodeType === 3 && node.textContent?.trim()) {
    const span = dom.createElement('span');
    span.textContent = node.textContent;
    node.replaceWith(span);
  }
  const parsed = parseHTML(dom.body.innerHTML, new Set(Object.keys(doc.nodes)));
  if (!parsed.roots.length) throw new Error('The clipboard contains no supported design elements.');
  const nodes: Record<NodeId, DocNode> = { ...doc.nodes };
  const names = { ...doc.names };
  const taken = takenClassNames(doc);
  const rules: string[] = [];
  for (const node of Object.values(parsed.nodes)) {
    if (node.kind === 'text') { nodes[node.id] = node; continue; }
    const attrs = { ...node.attrs };
    const cls = uniqueClassName(taken, `pasted-${node.tag}`);
    taken.add(cls);
    let declarations = safeDeclarations(attrs.style ?? '');
    if (!parent && parsed.roots.includes(node.id)) {
      // Canvas placement belongs to frame metadata, not website viewport offsets.
      const rootRule = safeParse(`a {${declarations}}`).first;
      if (rootRule?.type === 'rule') {
        rootRule.walkDecls((d) => { if (/^(position|top|right|bottom|left|inset(?:-.+)?)$/.test(d.prop)) d.remove(); });
        declarations = rootRule.nodes.map((n) => n.toString() + ';').join('\n');
      }
      declarations += '\nposition: relative;';
    }
    delete attrs.style;
    if (attrs['layer-name']) names[node.id] = attrs['layer-name'];
    delete attrs['layer-name'];
    // Captured computed styles stand alone; copied site classes must not match project CSS.
    nodes[node.id] = { ...node, attrs, classes: [cls] };
    rules.push(`.${cls} { ${paperCapture ? PAPER_CAPTURE_BASELINE : ''} ${declarations} }`);
  }
  const styles = parseStyleSheet(serializeStyleSheet(doc.styles) + '\n' + rules.join('\n'));
  if (parent) {
    nodes[parent.id] = { ...parent, children: [...parent.children, ...parsed.roots] };
    return { doc: { ...doc, nodes, names, styles }, ids: parsed.roots };
  }
  const frames = { ...doc.frames };
  let x = canvas!.position.x;
  for (const id of parsed.roots) {
    frames[id] = { x: Math.round(x), y: Math.round(canvas!.position.y) };
    const node = nodes[id];
    const width = node?.kind === 'element' ? styles.rules[node.classes[0]!]?.width : undefined;
    x += (width && /^\d+(\.\d+)?px$/.test(width) ? parseFloat(width) : 320) + 32;
  }
  const pages = doc.pages.map((p) => p.file === canvas!.page ? { ...p, roots: [...p.roots, ...parsed.roots] } : p);
  return { doc: { ...doc, nodes, names, styles, frames, pages }, ids: parsed.roots };
}

export function handleCanvasPaste(e: ClipboardEvent, artboardHint?: NodeId): void {
  const store = useEditor.getState();
  if (e.defaultPrevented || ownsTextPaste(e) || store.editingTextId || store.agentsOpen || store.tx) return;
  if (pasteNativeSelection(e, artboardHint)) return;
  const html = e.clipboardData?.getData('text/html');
  const text = e.clipboardData?.getData('text/plain');
  if (!html && !text) return;
  e.preventDefault();
  const artboard = pasteArtboard(store.doc, store.activePage, store.selection, artboardHint);
  try {
    const viewport = getViewportElement();
    const position = screenToWorld({ x: (viewport?.clientWidth ?? window.innerWidth) / 3, y: (viewport?.clientHeight ?? window.innerHeight) / 3 }, store.viewport);
    const result = importClipboardHtml(store.doc, artboard, html || `<div style="white-space: pre-wrap">${escapeText(text!)}</div>`, { page: store.activePage, position });
    store.apply(artboard ? 'Paste into artboard' : 'Paste onto canvas', () => result.doc, { select: result.ids });
    store.setTool({ kind: 'select' });
    notify(artboard ? 'Pasted into artboard' : 'Pasted onto canvas');
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not paste this content.');
  }
}


const PLASTIC_CLIPBOARD = 'application/x-plastic-selection';
let captured: { token: string; doc: DesignDocument; ids: NodeId[]; cut: boolean; used: boolean; assetBase: string | null } | null = null;

export function handleCanvasCopy(e: ClipboardEvent, cut = false): void {
  const state = useEditor.getState();
  if (e.defaultPrevented || ownsTextPaste(e) || state.editingTextId || state.tx || state.agentsOpen || !e.clipboardData) return;
  const ids = topmostIds(state.doc, state.selection).filter((id) => getElement(state.doc, id));
  if (!ids.length) return;
  try {
    const token = createId();
    // A portable computed-style fallback supports other tabs and ordinary HTML destinations.
    const fragment = new DOMParser().parseFromString(ids.map((id) => serializeNode(state.doc, id)).join(''), 'text/html');
    for (const el of Array.from(fragment.body.querySelectorAll('[data-pl-id]'))) {
      const live = domElement(el.getAttribute('data-pl-id'));
      if (live) {
        const css = styleOf(live);
        el.setAttribute('style', Array.from(css).filter((prop) => !prop.startsWith('--')).map((prop) => `${prop}: ${css.getPropertyValue(prop)};`).join(''));
        for (const attr of ['src', 'poster', 'href']) {
          const value = el.getAttribute(attr);
          if (value && !value.startsWith('#')) el.setAttribute(attr, new URL(value, live.ownerDocument.baseURI).href);
        }
      }
    }
    e.clipboardData.setData(PLASTIC_CLIPBOARD, token);
    e.clipboardData.setData('text/html', `<x-paper-html>${fragment.body.innerHTML}</x-paper-html>`);
    e.clipboardData.setData('text/plain', ids.map((id) => textContent(state.doc, id)).join('\n'));
    captured = { token, doc: state.doc, ids, cut, used: false, assetBase: state.assetBase };
    e.preventDefault();
    if (cut) {
      const parent = getParentId(state.doc, ids[0]!);
      state.apply('Cut Layers', (doc) => removeNodes(doc, ids), { select: parent ? [parent] : [] });
      notify('Layers Cut');
    } else notify('Layers Copied');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not copy layers.'); }
}

function pasteNativeSelection(e: ClipboardEvent, hint?: NodeId): boolean {
  const token = e.clipboardData?.getData(PLASTIC_CLIPBOARD);
  if (!captured || !token || token !== captured.token) return false;
  e.preventDefault();
  const state = useEditor.getState();
  const selected = state.selection.length === 1 ? getElement(state.doc, state.selection[0]) : null;
  const parent = selected && elementSpec(selected.tag).acceptsChildren ? selected.id : hint ?? null;
  const viewport = getViewportElement();
  const position = screenToWorld({ x: (viewport?.clientWidth ?? window.innerWidth) / 3,
    y: (viewport?.clientHeight ?? window.innerHeight) / 3 }, state.viewport);
  try {
    const result = pastePlasticNodes(state.doc, captured.doc, captured.ids, parent, state.activePage, position, captured.cut && !captured.used, captured.assetBase !== state.assetBase ? captured.assetBase ?? undefined : undefined);
    state.apply('Paste Layers', () => result.doc, { select: result.ids });
    captured.used = true;
    state.setTool({ kind: 'select' });
    notify('Layers Pasted');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not paste layers.'); }
  return true;
}
