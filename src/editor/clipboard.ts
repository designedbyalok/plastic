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
import { getElement, getParentId, pageOf, rootOf, topmostIds, textContent } from '../document/tree.ts';
import type { DesignDocument, DocNode, NodeId, Point } from '../document/types.ts';
import { escapeText, parseHTML } from '../serialization/html.ts';
import { serializeNode } from '../serialization/html.ts';
import { pastePlasticNodes } from '../document/clipboardNodes.ts';
import { insertRoot, moveNode, removeNodes, setFrame, setStyleOnNodes, stripPosition } from '../document/ops.ts';
import { domElement, styleOf } from '../canvas/dom.ts';
import { elementSpec } from '../elements/registry.ts';
import { notify } from '../canvas/gestureStore.ts';
import { useEditor } from './store.ts';
import { normalizeInterFonts } from '../document/fontNames.ts';
import { loadInterFont } from '../document/fonts.ts';

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
    target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, [role="combobox"], [role="listbox"], [data-plastic-select], [data-plastic-menu]')
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
      // Bare HTML/text pasted onto the canvas has no parent typography to inherit.
      if (!/(?:^|;)\s*font(?:-family)?\s*:/i.test(declarations)) declarations += '\nfont-family: Inter, system-ui, sans-serif;';
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
    return { doc: loadInterFont(normalizeInterFonts({ ...doc, nodes, names, styles })), ids: parsed.roots };
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
  return { doc: loadInterFont(normalizeInterFonts({ ...doc, nodes, names, styles, frames, pages })), ids: parsed.roots };
}

/**
 * How a paste places its layers: normally (into the selected container, or onto the canvas),
 * "on top" of the copied layers (same parent and position, Figma's ⇧⌘V), or "replace" (in
 * place of each selected layer, which is removed, ⇧⌘R).
 */
export type PasteMode = 'normal' | 'over' | 'replace';

/** ⇧⌘V still pastes through the browser's paste event; the key handler sets the mode for it. */
let nextPasteMode: PasteMode = 'normal';
export function setNextPasteMode(mode: PasteMode): void {
  nextPasteMode = mode;
}

export function handleCanvasPaste(e: ClipboardEvent, artboardHint?: NodeId): void {
  const store = useEditor.getState();
  const mode = nextPasteMode;
  nextPasteMode = 'normal';
  nextPastePoint = null; // a keyboard paste lands in view, not where a menu last opened
  if (e.defaultPrevented || ownsTextPaste(e) || store.editingTextId || store.agentsOpen || store.tx || store.readOnly) return;
  const html = e.clipboardData?.getData('text/html') ?? '';
  const text = e.clipboardData?.getData('text/plain') ?? '';
  const token = e.clipboardData?.getData(PLASTIC_CLIPBOARD) || tokenIn(html);
  if (!html && !text && !token) return;
  e.preventDefault();
  pasteContent({ html, text, token }, mode, artboardHint);
}

/** Where the next canvas paste lands (a point in the canvas, set by a right-click), once. */
let nextPastePoint: Point | null = null;

/** The world position for pasted layers: the right-clicked point, or a third into the view. */
function pastePosition(): Point {
  const viewport = getViewportElement();
  const at = nextPastePoint ?? { x: (viewport?.clientWidth ?? window.innerWidth) / 3, y: (viewport?.clientHeight ?? window.innerHeight) / 3 };
  nextPastePoint = null;
  return screenToWorld(at, useEditor.getState().viewport);
}

/** Paste from the system clipboard without a paste event (the canvas menu, ⇧⌘R). */
export async function pasteFromSystemClipboard(mode: PasteMode, at?: Point): Promise<void> {
  // A read-only file can be copied from, never pasted into.
  if (useEditor.getState().readOnly) return;
  nextPastePoint = at ?? null;
  let html = '';
  let text = '';
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
  } catch {
    // Reading may be refused; layers copied in this tab can still be pasted.
    if (!captured) {
      notify('Allow clipboard access to paste here, or press ⌘V.');
      return;
    }
  }
  const token = tokenIn(html) || (!html && !text && captured ? captured.token : '');
  if (!html && !text && !token) {
    notify('The clipboard is empty.');
    return;
  }
  pasteContent({ html, text, token }, mode);
}

function tokenIn(html: string): string {
  return /data-plastic-token="([^"]+)"/.exec(html)?.[1] ?? '';
}

function pasteContent(content: { html: string; text: string; token: string }, mode: PasteMode, artboardHint?: NodeId): void {
  if (content.token && captured && content.token === captured.token) {
    pasteNative(mode, artboardHint);
    return;
  }
  const { html, text } = content;
  if (!html && !text) return;
  const store = useEditor.getState();
  const markup = html || `<div style="white-space: pre-wrap">${escapeText(text)}</div>`;
  try {
    if (mode === 'replace') {
      const targets = topmostIds(store.doc, store.selection).filter((id) => getElement(store.doc, id));
      if (!targets.length) return notify('Select layers to replace.');
      store.apply('Paste to Replace', (doc) => replaceEach(doc, targets, (d, parent, position) => importClipboardHtml(d, parent, markup, { page: store.activePage, position })), {
        select: [],
      });
      notify('Replaced');
      return;
    }
    const artboard = pasteArtboard(store.doc, store.activePage, store.selection, artboardHint);
    const position = pastePosition();
    const result = importClipboardHtml(store.doc, artboard, markup, { page: store.activePage, position });
    store.apply(artboard ? 'Paste into artboard' : 'Paste onto canvas', () => result.doc, { select: result.ids });
    store.setTool({ kind: 'select' });
    notify(artboard ? 'Pasted into artboard' : 'Pasted onto canvas');
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not paste this content.');
  }
}

/**
 * For each target: paste (via `paste`, into the target's parent or onto its page), move the
 * pasted layers to where the target was, then remove the target.
 */
function replaceEach(
  doc: DesignDocument,
  targets: readonly NodeId[],
  paste: (doc: DesignDocument, parent: NodeId | null, position: Point) => { doc: DesignDocument; ids: NodeId[] },
): DesignDocument {
  let next = doc;
  const pasted: NodeId[] = [];
  for (const target of targets) {
    if (!next.nodes[target]) continue;
    const parent = getParentId(next, target);
    const page = pageOf(next, target);
    const frame = next.frames[target] ?? { x: 0, y: 0 };
    const result = paste(next, parent, frame);
    next = result.doc;
    next = placeAt(next, result.ids, target);
    pasted.push(...result.ids);
    if (parent) next = takePlaceOf(next, result.ids, target);
    if (!parent && page) result.ids.forEach((id, i) => (next = setFrame(next, id, { x: frame.x + i * 32, y: frame.y + i * 32 })));
    next = removeNodes(next, [target]);
  }
  queueMicrotask(() => useEditor.getState().select(pasted.filter((id) => useEditor.getState().doc.nodes[id])));
  return next;
}

/** Inside a frame, a replacement sits where the replaced layer was: at its offset, or in its flow. */
function takePlaceOf(doc: DesignDocument, ids: readonly NodeId[], target: NodeId): DesignDocument {
  const cls = getElement(doc, target)?.classes[0];
  const rule = cls ? doc.styles.rules[cls] ?? {} : {};
  let next = doc;
  for (const id of ids) {
    if (!getElement(next, id)) continue;
    next = stripPosition(next, id);
    if (rule.position !== 'absolute' && rule.position !== 'fixed') continue;
    for (const prop of ['position', 'left', 'top', 'right', 'bottom']) if (rule[prop]) next = setStyleOnNodes(next, [id], prop, rule[prop]!);
  }
  return next;
}

/** Move freshly pasted layers to sit right after `anchor` (same parent, or same page for roots). */
function placeAt(doc: DesignDocument, ids: readonly NodeId[], anchor: NodeId): DesignDocument {
  let next = doc;
  const parent = getParentId(next, anchor);
  if (parent) {
    let index = getElement(next, parent)!.children.indexOf(anchor) + 1;
    for (const id of ids) next = moveNode(next, id, parent, index++);
    return next;
  }
  const page = pageOf(next, anchor);
  if (!page) return next;
  for (const id of ids) {
    // Roots are reordered on their page: take each out and put it back after the anchor.
    const pages = next.pages.map((p) => (p.file === page.file ? { ...p, roots: p.roots.filter((r) => r !== id) } : p));
    next = { ...next, pages };
    const roots = next.pages.find((p) => p.file === page.file)!.roots;
    next = insertRoot(next, page.file, roots.indexOf(anchor) + 1, id);
  }
  return next;
}


const PLASTIC_CLIPBOARD = 'application/x-plastic-selection';
let captured: { token: string; doc: DesignDocument; ids: NodeId[]; cut: boolean; used: boolean; assetBase: string | null } | null = null;

/** The selection as clipboard content: Plastic layers (by token) plus portable HTML and text. */
function selectionClipboard(): { token: string; ids: NodeId[]; html: string; text: string } | null {
  const state = useEditor.getState();
  const ids = topmostIds(state.doc, state.selection).filter((id) => getElement(state.doc, id));
  if (!ids.length) return null;
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
  // The token also rides in the HTML, so pastes that only see HTML (the async clipboard API
  // can't write custom types) still restore the original layers.
  return { token, ids, html: `<x-paper-html data-plastic-token="${token}">${fragment.body.innerHTML}</x-paper-html>`, text: ids.map((id) => textContent(state.doc, id)).join('\n') };
}

function remember(token: string, ids: NodeId[], cut: boolean): void {
  const state = useEditor.getState();
  captured = { token, doc: state.doc, ids, cut, used: false, assetBase: state.assetBase };
  if (cut) {
    const parent = getParentId(state.doc, ids[0]!);
    state.apply('Cut Layers', (doc) => removeNodes(doc, ids), { select: parent ? [parent] : [] });
    notify('Layers Cut');
  } else notify('Layers Copied');
}

export function handleCanvasCopy(e: ClipboardEvent, cut = false): void {
  const state = useEditor.getState();
  if (e.defaultPrevented || ownsTextPaste(e) || state.editingTextId || state.tx || state.agentsOpen || !e.clipboardData) return;
  try {
    const content = selectionClipboard();
    if (!content) return;
    e.clipboardData.setData(PLASTIC_CLIPBOARD, content.token);
    e.clipboardData.setData('text/html', content.html);
    e.clipboardData.setData('text/plain', content.text);
    e.preventDefault();
    remember(content.token, content.ids, cut);
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not copy layers.'); }
}

/** Copy the selection without a copy event (the canvas menu). */
export async function copySelectionToClipboard(): Promise<void> {
  try {
    const content = selectionClipboard();
    if (!content) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([content.html], { type: 'text/html' }), 'text/plain': new Blob([content.text], { type: 'text/plain' }) }),
      ]);
    } catch {
      // Without clipboard access the layers can still be pasted in this tab.
    }
    remember(content.token, content.ids, false);
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not copy layers.'); }
}

function pasteNative(mode: PasteMode, hint?: NodeId): void {
  if (!captured) return;
  const copy = captured;
  const state = useEditor.getState();
  const assetBase = copy.assetBase !== state.assetBase ? copy.assetBase ?? undefined : undefined;
  const preserve = copy.cut && !copy.used;
  const paste = (doc: DesignDocument, parent: NodeId | null, position: Point) =>
    pastePlasticNodes(doc, copy.doc, copy.ids, parent, state.activePage, position, preserve, assetBase);
  try {
    if (mode === 'replace') {
      const targets = topmostIds(state.doc, state.selection).filter((id) => getElement(state.doc, id));
      if (!targets.length) return notify('Select layers to replace.');
      state.apply('Paste to Replace', (doc) => replaceEach(doc, targets, paste), {});
      copy.used = true;
      notify('Replaced');
      return;
    }
    // On top: where the copied layers are (if they're still here), right above them.
    const originals = copy.ids.filter((id) => state.doc.nodes[id]);
    if (mode === 'over' && originals.length === copy.ids.length) {
      const anchor = originals.at(-1)!;
      const parent = getParentId(state.doc, anchor);
      const origin = state.doc.frames[copy.ids[0]!] ?? { x: 0, y: 0 };
      state.apply('Paste on Top', (doc) => {
        const result = paste(doc, parent, origin);
        let next = placeAt(result.doc, result.ids, anchor);
        if (!parent) result.ids.forEach((id, i) => (next = setFrame(next, id, doc.frames[copy.ids[i]!] ?? origin)));
        queueMicrotask(() => useEditor.getState().select(result.ids));
        return next;
      }, {});
      copy.used = true;
      state.setTool({ kind: 'select' });
      notify('Pasted on top');
      return;
    }
    const selected = state.selection.length === 1 ? getElement(state.doc, state.selection[0]) : null;
    const parent = selected && elementSpec(selected.tag).acceptsChildren ? selected.id : hint ?? null;
    const position = pastePosition();
    const result = paste(state.doc, parent, position);
    state.apply('Paste Layers', () => result.doc, { select: result.ids });
    copy.used = true;
    state.setTool({ kind: 'select' });
    notify('Layers Pasted');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not paste layers.'); }
}

/** Whether there is anything this tab copied (for enabling menu items). */
export function hasCopiedLayers(): boolean {
  return captured !== null;
}
