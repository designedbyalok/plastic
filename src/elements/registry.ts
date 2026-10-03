/**
 * What the editor knows about each HTML element: a friendly label, which controls the inspector
 * shows, and which tags it can be swapped with. Unknown tags still work as generic elements.
 */
import { getElement, textContent } from '../document/tree.ts';
import type { DesignDocument, ElementNode, NodeId } from '../document/types.ts';

export type AttrGroup = 'semantics' | 'content' | 'behavior';

export interface AttrSpec {
  readonly name: string;
  readonly label: string;
  readonly kind: 'text' | 'boolean' | 'enum' | 'number';
  readonly group: AttrGroup;
  readonly options?: readonly string[];
  readonly placeholder?: string;
  /** Only shown when this holds for the element's current attributes. */
  readonly when?: (attrs: Readonly<Record<string, string>>) => boolean;
}

export type ElementCategory = 'container' | 'text' | 'action' | 'form' | 'media' | 'table' | 'list' | 'other';

export interface ElementSpec {
  readonly tag: string;
  readonly label: string;
  readonly category: ElementCategory;
  /** Whether elements can be placed inside it on the canvas. */
  readonly acceptsChildren: boolean;
  /** Whether its text can be edited directly (double-click on canvas, or the inspector). */
  readonly editableText: boolean;
  readonly attrs: readonly AttrSpec[];
}

const INPUT_TYPES = ['text', 'email', 'password', 'number', 'tel', 'url', 'search', 'date', 'time', 'checkbox', 'radio', 'range', 'color', 'file'];
const isTextLike = (a: Readonly<Record<string, string>>) => !['checkbox', 'radio', 'range', 'color', 'file'].includes(a.type ?? 'text');
const isCheckable = (a: Readonly<Record<string, string>>) => a.type === 'checkbox' || a.type === 'radio';
const isNumeric = (a: Readonly<Record<string, string>>) => ['number', 'range', 'date', 'time'].includes(a.type ?? '');

const attr = {
  name: { name: 'name', label: 'Name', kind: 'text', group: 'semantics', placeholder: 'form field name' },
  required: { name: 'required', label: 'Required', kind: 'boolean', group: 'behavior' },
  disabled: { name: 'disabled', label: 'Disabled', kind: 'boolean', group: 'behavior' },
  readonly: { name: 'readonly', label: 'Read Only', kind: 'boolean', group: 'behavior' },
  placeholder: { name: 'placeholder', label: 'Placeholder', kind: 'text', group: 'content' },
  ariaLabel: { name: 'aria-label', label: 'Accessible Name', kind: 'text', group: 'semantics', placeholder: 'aria-label' },
} satisfies Record<string, AttrSpec>;

function spec(tag: string, label: string, category: ElementCategory, extra: Partial<ElementSpec> = {}): ElementSpec {
  const container = category === 'container' || category === 'list';
  return { tag, label, category, acceptsChildren: container, editableText: category === 'text', attrs: [], ...extra };
}

const SPECS: readonly ElementSpec[] = [
  spec('div', 'Frame', 'container'),
  spec('section', 'Section', 'container'),
  spec('main', 'Main', 'container'),
  spec('header', 'Header', 'container'),
  spec('footer', 'Footer', 'container'),
  spec('nav', 'Navigation', 'container'),
  spec('article', 'Article', 'container'),
  spec('aside', 'Aside', 'container'),
  spec('form', 'Form', 'container', {
    attrs: [
      { name: 'action', label: 'Action', kind: 'text', group: 'semantics', placeholder: '/submit' },
      { name: 'method', label: 'Method', kind: 'enum', group: 'semantics', options: ['get', 'post'] },
      { name: 'novalidate', label: 'No Validation', kind: 'boolean', group: 'behavior' },
    ],
  }),
  spec('fieldset', 'Fieldset', 'container', { attrs: [attr.disabled] }),
  spec('legend', 'Legend', 'text'),
  spec('dialog', 'Dialog', 'container', { attrs: [{ name: 'open', label: 'Open', kind: 'boolean', group: 'behavior' }] }),
  spec('h1', 'Heading 1', 'text'),
  spec('h2', 'Heading 2', 'text'),
  spec('h3', 'Heading 3', 'text'),
  spec('h4', 'Heading 4', 'text'),
  spec('h5', 'Heading 5', 'text'),
  spec('h6', 'Heading 6', 'text'),
  spec('p', 'Paragraph', 'text'),
  spec('span', 'Text', 'text'),
  spec('small', 'Small Text', 'text'),
  spec('strong', 'Strong', 'text'),
  spec('em', 'Emphasis', 'text'),
  spec('blockquote', 'Quote', 'text'),
  spec('label', 'Label', 'text', {
    acceptsChildren: true,
    attrs: [{ name: 'for', label: 'For', kind: 'text', group: 'semantics', placeholder: 'input id' }],
  }),
  spec('a', 'Link', 'action', {
    editableText: true,
    attrs: [
      { name: 'href', label: 'URL', kind: 'text', group: 'content', placeholder: 'https://' },
      { name: 'target', label: 'Target', kind: 'enum', group: 'behavior', options: ['_self', '_blank'] },
    ],
  }),
  spec('button', 'Button', 'action', {
    editableText: true,
    attrs: [{ name: 'type', label: 'Type', kind: 'enum', group: 'semantics', options: ['button', 'submit', 'reset'] }, attr.ariaLabel, attr.disabled],
  }),
  spec('input', 'Input', 'form', {
    attrs: [
      { name: 'type', label: 'Type', kind: 'enum', group: 'semantics', options: INPUT_TYPES },
      attr.name,
      { name: 'id', label: 'Id', kind: 'text', group: 'semantics', placeholder: 'for <label for>' },
      { ...attr.placeholder, when: isTextLike },
      { name: 'value', label: 'Value', kind: 'text', group: 'content', when: (a) => !isCheckable(a) },
      { name: 'autocomplete', label: 'Autocomplete', kind: 'text', group: 'semantics', placeholder: 'email, name…', when: isTextLike },
      { name: 'min', label: 'Min', kind: 'text', group: 'behavior', when: isNumeric },
      { name: 'max', label: 'Max', kind: 'text', group: 'behavior', when: isNumeric },
      { name: 'step', label: 'Step', kind: 'text', group: 'behavior', when: isNumeric },
      { name: 'checked', label: 'Checked', kind: 'boolean', group: 'behavior', when: isCheckable },
      attr.required,
      attr.disabled,
      { ...attr.readonly, when: isTextLike },
    ],
  }),
  spec('textarea', 'Text Area', 'form', {
    editableText: false,
    attrs: [attr.name, attr.placeholder, { name: 'rows', label: 'Rows', kind: 'number', group: 'content' }, attr.required, attr.disabled, attr.readonly],
  }),
  spec('select', 'Select', 'form', { attrs: [attr.name, attr.required, attr.disabled, { name: 'multiple', label: 'Multiple', kind: 'boolean', group: 'behavior' }] }),
  spec('option', 'Option', 'text', {
    attrs: [{ name: 'value', label: 'Value', kind: 'text', group: 'content' }, { name: 'selected', label: 'Selected', kind: 'boolean', group: 'behavior' }, attr.disabled],
  }),
  spec('img', 'Image', 'media', {
    attrs: [
      { name: 'src', label: 'Source', kind: 'text', group: 'content', placeholder: 'https:// or assets/…' },
      { name: 'alt', label: 'Alt Text', kind: 'text', group: 'content', placeholder: 'Describe the image' },
      { name: 'loading', label: 'Loading', kind: 'enum', group: 'behavior', options: ['eager', 'lazy'] },
    ],
  }),
  spec('video', 'Video', 'media', {
    attrs: [
      { name: 'src', label: 'Source', kind: 'text', group: 'content' },
      { name: 'poster', label: 'Poster', kind: 'text', group: 'content' },
      { name: 'controls', label: 'Controls', kind: 'boolean', group: 'behavior' },
      { name: 'autoplay', label: 'Autoplay', kind: 'boolean', group: 'behavior' },
      { name: 'muted', label: 'Muted', kind: 'boolean', group: 'behavior' },
      { name: 'loop', label: 'Loop', kind: 'boolean', group: 'behavior' },
    ],
  }),
  spec('svg', 'Vector', 'media'),
  spec('table', 'Table', 'table'),
  spec('thead', 'Table Head', 'table'),
  spec('tbody', 'Table Body', 'table'),
  spec('tfoot', 'Table Foot', 'table'),
  spec('tr', 'Row', 'table'),
  spec('th', 'Header Cell', 'table', {
    editableText: true,
    attrs: [{ name: 'scope', label: 'Scope', kind: 'enum', group: 'semantics', options: ['col', 'row'] }, { name: 'colspan', label: 'Column Span', kind: 'number', group: 'semantics' }],
  }),
  spec('td', 'Cell', 'table', {
    editableText: true,
    attrs: [{ name: 'colspan', label: 'Column Span', kind: 'number', group: 'semantics' }, { name: 'rowspan', label: 'Row Span', kind: 'number', group: 'semantics' }],
  }),
  spec('ul', 'List', 'list'),
  spec('ol', 'Numbered List', 'list', { attrs: [{ name: 'start', label: 'Start', kind: 'number', group: 'semantics' }, { name: 'reversed', label: 'Reversed', kind: 'boolean', group: 'behavior' }] }),
  spec('li', 'List Item', 'text', { acceptsChildren: true }),
];

const BY_TAG = new Map(SPECS.map((s) => [s.tag, s]));

export function elementSpec(tag: string): ElementSpec {
  return BY_TAG.get(tag) ?? spec(tag, `<${tag}>`, 'other', { acceptsChildren: true });
}

/** Tags an element can be switched to without changing its structure. */
const SWAP_GROUPS: readonly (readonly string[])[] = [
  ['div', 'section', 'main', 'header', 'footer', 'nav', 'article', 'aside', 'form', 'fieldset', 'dialog'],
  ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'legend', 'small', 'strong', 'em', 'blockquote', 'li'],
  ['ul', 'ol'],
  ['th', 'td'],
  ['button', 'a'],
];

export function swappableTags(tag: string): readonly string[] {
  return SWAP_GROUPS.find((g) => g.includes(tag)) ?? [tag];
}

const INPUT_LABELS: Record<string, string> = {
  checkbox: 'Checkbox', radio: 'Radio', email: 'Email input', password: 'Password input', number: 'Number input',
  search: 'Search input', tel: 'Phone input', url: 'URL input', date: 'Date input', time: 'Time input',
  range: 'Slider', color: 'Color input', file: 'File input',
};

/** Friendly kind label, e.g. "Email input" for <input type="email">. */
export function kindLabel(el: ElementNode): string {
  if (el.tag === 'input') return INPUT_LABELS[el.attrs.type ?? 'text'] ?? 'Input';
  if (el.tag === 'div' && el.classes.some((c) => c.startsWith('stack'))) return 'Stack';
  return elementSpec(el.tag).label;
}

function humanize(className: string): string {
  const words = className.replace(/-\d+$/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : className;
}

/** The name shown in the layers panel: a user-given name, else something derived from content. */
export function layerName(doc: DesignDocument, id: NodeId): string {
  const custom = doc.names[id];
  if (custom) return custom;
  const el = getElement(doc, id);
  if (!el) return '';
  const spec = elementSpec(el.tag);
  if (el.tag === 'input') return el.attrs.placeholder || el.attrs.name || kindLabel(el);
  if (el.tag === 'img') return el.attrs.alt || 'Image';
  if (el.tag === 'select') return el.attrs.name ? `${el.attrs.name} select` : 'Select';
  if (spec.category === 'text' || spec.category === 'action' || el.tag === 'th' || el.tag === 'td' || el.tag === 'label') {
    const text = textContent(doc, id).trim().replace(/\s+/g, ' ');
    if (text) return text.length > 32 ? `${text.slice(0, 31)}…` : text;
  }
  const cls = el.classes[0];
  return cls ? humanize(cls) : kindLabel(el);
}
