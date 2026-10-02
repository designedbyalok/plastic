/** DesignDocument nodes <-> index.html. */
import { createId } from '../document/ids';
import { BOOLEAN_ATTRS, ID_ATTR, SVG_NS, VOID_TAGS, childLayout } from '../document/markup';
import type { DesignDocument, DocNode, ElementNode, NodeId, Page } from '../document/types';

const INDENT = '  ';

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function openTag(el: ElementNode, withIds: boolean): string {
  const parts = [el.tag];
  if (el.classes.length) parts.push(`class="${escapeAttr(el.classes.join(' '))}"`);
  for (const [name, value] of Object.entries(el.attrs)) {
    parts.push(value === '' && BOOLEAN_ATTRS.has(name) ? name : `${name}="${escapeAttr(value)}"`);
  }
  if (withIds) parts.push(`${ID_ATTR}="${el.id}"`);
  return `<${parts.join(' ')}>`;
}

export interface MarkupOptions {
  /** Include `data-pl-id` (needed for round-tripping; omit for a clean export). */
  readonly ids?: boolean;
}

export function serializeNode(doc: DesignDocument, id: NodeId, depth = 0, options: MarkupOptions = {}): string {
  const node = doc.nodes[id];
  if (!node) return '';
  if (node.kind === 'text') return escapeText(node.text);
  const open = openTag(node, options.ids ?? true);
  if (VOID_TAGS.has(node.tag)) return open;
  const close = `</${node.tag}>`;
  if (childLayout(doc, node) === 'inline') {
    return open + node.children.map((c) => serializeNode(doc, c, depth, options)).join('') + close;
  }
  const pad = INDENT.repeat(depth + 1);
  const inner = node.children.map((c) => pad + serializeNode(doc, c, depth + 1, options)).join('\n');
  return `${open}\n${inner}\n${INDENT.repeat(depth)}${close}`;
}

/** One page as a standalone HTML document. Every page links the shared tokens and styles. */
export function serializeHTML(doc: DesignDocument, page: Page, options: MarkupOptions = {}): string {
  const body = page.roots.map((id) => INDENT.repeat(2) + serializeNode(doc, id, 2, options)).join('\n');
  return [
    '<!doctype html>',
    '<html lang="en">',
    `${INDENT}<head>`,
    `${INDENT.repeat(2)}<meta charset="utf-8">`,
    `${INDENT.repeat(2)}<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `${INDENT.repeat(2)}<title>${escapeText(doc.title)}</title>`,
    `${INDENT.repeat(2)}<link rel="stylesheet" href="tokens.css">`,
    `${INDENT.repeat(2)}<link rel="stylesheet" href="styles.css">`,
    `${INDENT}</head>`,
    `${INDENT}<body>`,
    body,
    `${INDENT}</body>`,
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n') + '\n';
}

/** Elements we never import into the design (the editor does not run document code). */
const SKIPPED_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'base']);

export interface ParsedMarkup {
  readonly title: string;
  readonly nodes: Record<NodeId, DocNode>;
  readonly roots: NodeId[];
}

/**
 * Parse one page. `seen` is shared across a project's pages so ids stay unique. Elements keep their `data-pl-id` when present and unique; hand-written or
 * agent-written markup without ids gets fresh ones, so any HTML file can be opened.
 */
export function parseHTML(html: string, seen: Set<NodeId> = new Set()): ParsedMarkup {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const nodes: Record<NodeId, DocNode> = {};

  const convert = (el: Element): NodeId | null => {
    const tag = el.namespaceURI === SVG_NS ? el.localName : el.localName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) return null;
    let id = el.getAttribute(ID_ATTR) ?? '';
    if (!/^[\w-]{1,64}$/.test(id) || seen.has(id)) id = createId();
    seen.add(id);

    const attrs: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      if (attr.name !== 'class' && attr.name !== ID_ATTR) attrs[attr.name] = attr.value;
    }
    const childNodes = Array.from(el.childNodes);
    // Whitespace-only text between elements is formatting, unless the element has real text.
    const keepText = childNodes.some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
    const children: NodeId[] = [];
    for (const child of childNodes) {
      if (child.nodeType === 1) {
        const childId = convert(child as Element);
        if (childId) children.push(childId);
      } else if (child.nodeType === 3 && keepText) {
        const textId = createId();
        nodes[textId] = { kind: 'text', id: textId, text: child.textContent ?? '' };
        children.push(textId);
      }
    }
    nodes[id] = { kind: 'element', id, tag, attrs, classes: Array.from(el.classList), children };
    return id;
  };

  const roots = Array.from(dom.body.children)
    .map(convert)
    .filter((id): id is NodeId => id !== null);
  return { title: dom.title || 'Untitled', nodes, roots };
}
