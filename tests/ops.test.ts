import { describe, expect, it } from 'vitest';
import { instantiate } from '../src/document/factory';
import {
  detachClass, duplicateNodes, insertChild, moveNode, removeNodes, renameClass, setAttribute, setSelectOptions, setStyleOnNodes, setText, wrapInStack,
} from '../src/document/ops';
import { addTableColumn, addTableRow, removeTableColumn, tableShape } from '../src/document/table';
import { getParentId, nodesWithClass, textContent } from '../src/document/tree';
import { frameSpec, insertable } from '../src/elements/insertables';
import { docFrom, el } from './helpers';

function frameWith(...ids: string[]) {
  let { doc, root } = docFrom(frameSpec());
  const created: string[] = [];
  for (const id of ids) {
    const made = instantiate(doc, insertable(id)!.spec());
    doc = insertChild(made.doc, root, 999, made.id);
    created.push(made.id);
  }
  return { doc, root, created };
}

describe('document operations', () => {
  it('gives each inserted element its own class and rule', () => {
    const { doc, created } = frameWith('button', 'button');
    const [a, b] = created.map((id) => el(doc, id).classes[0]);
    expect(a).toBe('button');
    expect(b).toBe('button-2');
    expect(doc.styles.rules['button-2']).toEqual(doc.styles.rules.button);
  });

  it('writes styles to the primary class, creating one if needed', () => {
    let { doc, created } = frameWith('table');
    const tbody = el(doc, created[0]).children[1]!;
    doc = setStyleOnNodes(doc, [tbody], 'background', '#fafafa');
    const cls = el(doc, tbody).classes[0]!;
    expect(cls).toBe('tbody');
    expect(doc.styles.rules[cls]).toEqual({ background: '#fafafa' });
    expect(setStyleOnNodes(doc, [tbody], 'background', null).styles.rules[cls]).toEqual({});
  });

  it('wraps siblings in a flex stack and strips free positioning', () => {
    let { doc, root, created } = frameWith('heading', 'input', 'button');
    doc = created.reduce((d, id) => setStyleOnNodes(setStyleOnNodes(d, [id], 'position', 'absolute'), [id], 'left', '40px'), doc);
    const result = wrapInStack(doc, created, { direction: 'column', gap: 12, placement: { x: 40, y: 40 } });
    const stack = el(result.doc, result.id!);
    expect(stack.children).toEqual(created);
    expect(getParentId(result.doc, result.id!)).toBe(root);
    expect(result.doc.styles.rules[stack.classes[0]!]).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: '12px', position: 'absolute' });
    for (const id of created) expect(result.doc.styles.rules[el(result.doc, id).classes[0]!]).not.toHaveProperty('position');
  });

  it('moves nodes and refuses cycles', () => {
    let { doc, root, created } = frameWith('container', 'button');
    const [box, button] = created as [string, string];
    doc = moveNode(doc, button, box, 0);
    expect(getParentId(doc, button)).toBe(box);
    expect(moveNode(doc, root, box, 0)).toBe(doc);
  });

  it('removes subtrees and their now-unused class rules', () => {
    const { doc, created } = frameWith('field');
    const next = removeNodes(doc, created);
    expect(next.styles.rules).not.toHaveProperty('field');
    expect(next.styles.rules).not.toHaveProperty('field-input');
    expect(Object.keys(next.nodes)).toHaveLength(1);
  });

  it('duplicates with independent classes, but keeps classes shared outside the copy', () => {
    const { doc, created } = frameWith('button', 'table');
    const dup = duplicateNodes(doc, [created[0]!]);
    expect(el(dup.doc, dup.ids[0]).classes).toEqual(['button-2']);

    const tbody = el(doc, el(doc, created[1]).children[1]).id;
    const row = el(doc, tbody).children[0]!;
    const rowDup = duplicateNodes(doc, [row]);
    const cell = el(rowDup.doc, el(rowDup.doc, rowDup.ids[0]).children[0]);
    expect(cell.classes).toEqual(['data-table-td']);
  });

  it('renames and detaches classes', () => {
    let { doc, created } = frameWith('button');
    doc = renameClass(doc, 'button', 'primary-button');
    expect(el(doc, created[0]).classes).toEqual(['primary-button']);
    expect(doc.styles.rules).toHaveProperty('primary-button');
    const dup = duplicateNodes(doc, created);
    expect(nodesWithClass(dup.doc, 'primary-button')).toHaveLength(1);
    expect(detachClass(doc, created[0]!).styles.rules).toHaveProperty('primary-button-2');
  });

  it('edits attributes, text and select options', () => {
    let { doc, created } = frameWith('input', 'heading', 'select');
    const [input, heading, select] = created as [string, string, string];
    doc = setAttribute(doc, input, 'type', 'email');
    doc = setAttribute(doc, input, 'required', '');
    doc = setAttribute(doc, input, 'onclick', 'x()');
    expect(el(doc, input).attrs).toMatchObject({ type: 'email', required: '', onclick: 'x()' });
    expect(setAttribute(doc, input, 'class', 'x')).toBe(doc);
    doc = setText(doc, heading, 'Sign in');
    expect(textContent(doc, heading)).toBe('Sign in');
    doc = setSelectOptions(doc, select, ['India', 'Japan']);
    expect(el(doc, select).children.map((c) => textContent(doc, c))).toEqual(['India', 'Japan']);
  });

  it('adds and removes table rows and columns', () => {
    let { doc, created } = frameWith('table');
    const table = created[0]!;
    doc = addTableRow(addTableColumn(doc, table), table);
    expect(tableShape(doc, table)).toMatchObject({ columns: 4 });
    expect(tableShape(doc, table)!.bodyRows).toHaveLength(3);
    doc = removeTableColumn(doc, table);
    expect(tableShape(doc, table)!.columns).toBe(3);
  });
});
