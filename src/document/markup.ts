/**
 * HTML rules shared by the serializer and the canvas renderer, so the editor's DOM and the
 * saved index.html are built the same way.
 */
import type { DesignDocument, ElementNode } from './types';

/** Stable node identity in saved HTML. The only editor-specific attribute we write. */
export const ID_ATTR = 'data-pl-id';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export const VOID_TAGS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

export const BOOLEAN_ATTRS: ReadonlySet<string> = new Set([
  'autofocus', 'autoplay', 'checked', 'controls', 'disabled', 'formnovalidate', 'hidden', 'inert', 'loop',
  'multiple', 'muted', 'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);

/** Elements whose text content is raw (no child elements are written). */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['textarea', 'pre', 'title']);

/**
 * `block`: children are written one per line. The renderer mirrors that by inserting a single
 * collapsible space between children, so whitespace-sensitive (inline) layouts look identical
 * in the editor and in the saved file.
 * `inline`: children are written back to back and every text node is kept verbatim.
 */
export function childLayout(doc: DesignDocument, el: ElementNode): 'block' | 'inline' {
  if (el.children.length === 0 || RAW_TEXT_TAGS.has(el.tag)) return 'inline';
  return el.children.some((c) => doc.nodes[c]?.kind === 'text') ? 'inline' : 'block';
}

/** Attributes the editor never applies to its live DOM (documents never execute script). */
export function isUnsafeAttribute(name: string, value: string): boolean {
  if (name.startsWith('on')) return true;
  return (name === 'href' || name === 'src' || name === 'action') && /^\s*javascript:/i.test(value);
}
