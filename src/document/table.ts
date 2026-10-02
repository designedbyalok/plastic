/** Table-specific structure edits. Rows/cells clone their neighbours' tag, class and attributes. */
import { createId } from './ids.ts';
import { removeNodes } from './ops.ts';
import { elementChildren, getElement } from './tree.ts';
import type { DesignDocument, DocNode, ElementNode, NodeId } from './types.ts';

export interface TableShape {
  readonly headerRows: readonly ElementNode[];
  readonly bodyRows: readonly ElementNode[];
  readonly bodyId: NodeId | null;
  readonly columns: number;
}

export function tableShape(doc: DesignDocument, tableId: NodeId): TableShape | null {
  const table = getElement(doc, tableId);
  if (!table || table.tag !== 'table') return null;
  const headerRows: ElementNode[] = [];
  const bodyRows: ElementNode[] = [];
  let bodyId: NodeId | null = null;
  for (const child of elementChildren(doc, table)) {
    if (child.tag === 'tr') bodyRows.push(child);
    if (child.tag === 'thead') headerRows.push(...elementChildren(doc, child).filter((r) => r.tag === 'tr'));
    if (child.tag === 'tbody' || child.tag === 'tfoot') {
      if (child.tag === 'tbody') bodyId ??= child.id;
      bodyRows.push(...elementChildren(doc, child).filter((r) => r.tag === 'tr'));
    }
  }
  const rows = [...headerRows, ...bodyRows];
  const columns = Math.max(0, ...rows.map((r) => elementChildren(doc, r).length));
  return { headerRows, bodyRows, bodyId, columns };
}

function cell(doc: DesignDocument, template: ElementNode, text: string): { nodes: Record<NodeId, DocNode>; id: NodeId } {
  const id = createId();
  const textId = createId();
  return {
    id,
    nodes: {
      ...doc.nodes,
      [textId]: { kind: 'text', id: textId, text },
      [id]: { kind: 'element', id, tag: template.tag, attrs: { ...template.attrs }, classes: [...template.classes], children: [textId] },
    },
  };
}

export function addTableRow(doc: DesignDocument, tableId: NodeId): DesignDocument {
  const shape = tableShape(doc, tableId);
  const template = shape?.bodyRows[shape.bodyRows.length - 1] ?? shape?.headerRows[0];
  if (!shape || !template) return doc;
  let next = doc;
  const cells: NodeId[] = [];
  for (const source of elementChildren(doc, template)) {
    const made = cell(next, { ...source, tag: 'td', attrs: {} , classes: bodyCellClasses(doc, shape, source) }, 'Cell');
    next = { ...next, nodes: made.nodes };
    cells.push(made.id);
  }
  const rowId = createId();
  next = { ...next, nodes: { ...next.nodes, [rowId]: { kind: 'element', id: rowId, tag: 'tr', attrs: { ...template.attrs }, classes: [...template.classes], children: cells } } };
  const parentId = shape.bodyRows.length ? shape.bodyId ?? tableId : tableId;
  const parent = getElement(next, parentId);
  if (!parent) return doc;
  return { ...next, nodes: { ...next.nodes, [parentId]: { ...parent, children: [...parent.children, rowId] } } };
}

function bodyCellClasses(doc: DesignDocument, shape: TableShape, source: ElementNode): string[] {
  if (source.tag === 'td') return [...source.classes];
  const sample = shape.bodyRows[0] ? elementChildren(doc, shape.bodyRows[0])[0] : undefined;
  return sample ? [...sample.classes] : [];
}

export function removeTableRow(doc: DesignDocument, tableId: NodeId): DesignDocument {
  const shape = tableShape(doc, tableId);
  const last = shape?.bodyRows[shape.bodyRows.length - 1];
  if (!shape || !last || shape.bodyRows.length <= 1) return doc;
  return removeNodes(doc, [last.id]);
}

export function addTableColumn(doc: DesignDocument, tableId: NodeId): DesignDocument {
  const shape = tableShape(doc, tableId);
  if (!shape) return doc;
  let next = doc;
  for (const row of [...shape.headerRows, ...shape.bodyRows]) {
    const cells = elementChildren(next, row);
    const template = cells[cells.length - 1];
    if (!template) continue;
    const made = cell(next, template, template.tag === 'th' ? 'Column' : 'Cell');
    const current = getElement({ ...next, nodes: made.nodes }, row.id);
    if (!current) continue;
    next = { ...next, nodes: { ...made.nodes, [row.id]: { ...current, children: [...current.children, made.id] } } };
  }
  return next;
}

export function removeTableColumn(doc: DesignDocument, tableId: NodeId): DesignDocument {
  const shape = tableShape(doc, tableId);
  if (!shape || shape.columns <= 1) return doc;
  const lastCells = [...shape.headerRows, ...shape.bodyRows]
    .map((row) => elementChildren(doc, row))
    .filter((cells) => cells.length === shape.columns)
    .map((cells) => cells[cells.length - 1]!.id);
  return removeNodes(doc, lastCells);
}
