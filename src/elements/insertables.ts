/**
 * Insert templates. Each produces real markup with a sensible starting style; composites
 * (field, checkbox, table) are built from the same semantic elements a developer would write.
 */
import { instantiate, emptyDocument, type NodeSpec } from '../document/factory.ts';
import { insertRoot, setFrame } from '../document/ops.ts';
import type { DesignDocument } from '../document/types.ts';

export interface Insertable {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly spec: () => NodeSpec;
  /** Start editing text right after inserting. */
  readonly editTextOnInsert?: boolean;
}

const controlStyle = {
  'box-sizing': 'border-box',
  width: '240px',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  'border-radius': '8px',
  background: '#ffffff',
  color: 'inherit',
  font: 'inherit',
};

/** Neutral grey placeholder (a solid block, no drawing) until a real image is chosen. */
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 160'><rect width='240' height='160' fill='#e5e7eb'/></svg>");

export const FRAME_SIZE = { width: 480, height: 640 };

export function frameSpec(width = FRAME_SIZE.width, height = FRAME_SIZE.height): NodeSpec {
  return {
    tag: 'div',
    className: 'frame',
    style: {
      position: 'relative',
      width: `${Math.round(width)}px`,
      'min-height': `${Math.round(height)}px`,
      background: '#ffffff',
      color: '#111827',
      'font-family': 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
      'font-size': '15px',
    },
  };
}

export const INSERTABLES: readonly Insertable[] = [
  {
    id: 'container',
    label: 'Container',
    shortcut: 'c',
    spec: () => ({
      tag: 'div',
      className: 'container',
      style: { display: 'flex', 'flex-direction': 'column', gap: '12px', padding: '16px', width: '240px', 'min-height': '80px', background: '#f3f4f6', 'border-radius': '8px' },
    }),
  },
  {
    id: 'heading',
    label: 'Heading',
    shortcut: 'h',
    editTextOnInsert: true,
    spec: () => ({
      tag: 'h2',
      className: 'heading',
      style: { margin: '0', 'font-size': '28px', 'font-weight': '600', 'line-height': '1.2', 'letter-spacing': '-0.01em' },
      children: ['Heading'],
    }),
  },
  {
    id: 'text',
    label: 'Text',
    shortcut: 't',
    editTextOnInsert: true,
    spec: () => ({ tag: 'p', className: 'text', style: { margin: '0', 'line-height': '1.5' }, children: ['Text'] }),
  },
  {
    id: 'button',
    label: 'Button',
    shortcut: 'b',
    spec: () => ({
      tag: 'button',
      attrs: { type: 'button' },
      className: 'button',
      style: { padding: '10px 16px', border: 'none', 'border-radius': '8px', background: '#111827', color: '#ffffff', font: 'inherit', 'font-weight': '500', cursor: 'pointer' },
      children: ['Button'],
    }),
  },
  {
    id: 'link',
    label: 'Link',
    spec: () => ({ tag: 'a', attrs: { href: '#' }, className: 'link', style: { color: '#2563eb' }, children: ['Link'] }),
  },
  {
    id: 'input',
    label: 'Input',
    shortcut: 'i',
    spec: () => ({ tag: 'input', attrs: { type: 'text', placeholder: 'Placeholder' }, className: 'input', style: controlStyle }),
  },
  {
    id: 'field',
    label: 'Labeled field',
    shortcut: 'l',
    spec: () => ({
      tag: 'label',
      className: 'field',
      style: { display: 'flex', 'flex-direction': 'column', gap: '6px', 'font-size': '13px', 'font-weight': '500' },
      children: ['Label', { tag: 'input', attrs: { type: 'text', placeholder: 'Placeholder' }, className: 'field-input', style: { ...controlStyle, 'font-size': '15px', 'font-weight': '400' } }],
    }),
  },
  {
    id: 'textarea',
    label: 'Text area',
    spec: () => ({ tag: 'textarea', attrs: { rows: '3', placeholder: 'Placeholder' }, className: 'textarea', style: { ...controlStyle, resize: 'vertical' } }),
  },
  {
    id: 'select',
    label: 'Select',
    spec: () => ({
      tag: 'select',
      className: 'select',
      style: controlStyle,
      children: ['Option 1', 'Option 2', 'Option 3'].map((label) => ({ tag: 'option', children: [label] })),
    }),
  },
  {
    id: 'checkbox',
    label: 'Checkbox',
    spec: () => ({
      tag: 'label',
      className: 'checkbox',
      style: { display: 'inline-flex', 'align-items': 'center', gap: '8px' },
      children: [{ tag: 'input', attrs: { type: 'checkbox' } }, 'Checkbox'],
    }),
  },
  {
    id: 'image',
    label: 'Image',
    spec: () => ({
      tag: 'img',
      attrs: { src: PLACEHOLDER_IMAGE, alt: '' },
      className: 'image',
      style: { display: 'block', width: '240px', height: '160px', 'object-fit': 'cover', 'border-radius': '8px' },
    }),
  },
  {
    id: 'table',
    label: 'Table',
    spec: () => {
      const th = (text: string): NodeSpec => ({
        tag: 'th',
        attrs: { scope: 'col' },
        className: 'data-table-th',
        style: { 'text-align': 'left', padding: '8px 12px', 'border-bottom': '1px solid #d1d5db', 'font-weight': '600' },
        children: [text],
      });
      const td = (text: string): NodeSpec => ({
        tag: 'td',
        className: 'data-table-td',
        style: { padding: '8px 12px', 'border-bottom': '1px solid #e5e7eb' },
        children: [text],
      });
      const row = (cells: string[]): NodeSpec => ({ tag: 'tr', children: cells.map(td) });
      return {
        tag: 'table',
        className: 'data-table',
        style: { 'border-collapse': 'collapse', width: '400px', 'font-size': '14px' },
        children: [
          { tag: 'thead', children: [{ tag: 'tr', children: ['Name', 'Status', 'Role'].map(th) }] },
          { tag: 'tbody', children: [row(['Ada Lovelace', 'Active', 'Admin']), row(['Grace Hopper', 'Invited', 'Editor'])] },
        ],
      };
    },
  },
  {
    id: 'list',
    label: 'List',
    spec: () => ({
      tag: 'ul',
      className: 'list',
      style: { margin: '0', 'padding-left': '20px', 'line-height': '1.6' },
      children: ['First item', 'Second item', 'Third item'].map((t) => ({ tag: 'li', children: [t] })),
    }),
  },
];

export function insertable(id: string): Insertable | undefined {
  return INSERTABLES.find((i) => i.id === id);
}

/** A new project: one empty artboard. */
export function starterDocument(): DesignDocument {
  const made = instantiate(emptyDocument('Untitled'), frameSpec());
  return setFrame(insertRoot(made.doc, made.doc.pages[0]!.file, 0, made.id), made.id, { x: 0, y: 0 });
}
