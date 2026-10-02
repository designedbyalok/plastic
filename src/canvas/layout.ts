/** Questions about live CSS layout, answered by asking the browser rather than re-implementing it. */
import { getElement, isRoot, subtreeIds } from '../document/tree';
import type { DesignDocument, ElementNode, NodeId } from '../document/types';
import { elementSpec } from '../elements/registry';
import { domElement, elementsAtPoint, isOutOfFlow, toScreenRect } from './dom';
import type { Line } from './gestureStore';

export interface FlowInsertion {
  readonly index: number;
  /** Screen-space indicator line. */
  readonly line: Line;
}

export interface DropTarget extends FlowInsertion {
  readonly parentId: NodeId;
}

/** Children are laid out top-to-bottom (column) or in reading order (row, wrap, grid, inline). */
function isColumnFlow(style: CSSStyleDeclaration): boolean {
  if (style.display.includes('flex')) return style.flexDirection.startsWith('column');
  if (style.display.includes('grid')) return style.gridTemplateColumns.trim().split(/\s+/).length <= 1;
  return !style.display.startsWith('inline');
}

/** Where a pointer at (clientX, clientY) would insert into `container`'s flow children. */
export function flowInsertion(
  doc: DesignDocument,
  container: ElementNode,
  excluded: ReadonlySet<NodeId>,
  clientX: number,
  clientY: number,
): FlowInsertion | null {
  const el = domElement(container.id);
  if (!el) return null;
  const style = getComputedStyle(el);
  const column = isColumnFlow(style);
  const kept = container.children.filter((c) => !excluded.has(c));
  const flowChildren = kept
    .filter((c) => doc.nodes[c]?.kind === 'element')
    .map((id) => ({ id, el: domElement(id) }))
    .filter((c): c is { id: NodeId; el: HTMLElement } => !!c.el && !isOutOfFlow(c.el))
    .map((c) => ({ id: c.id, rect: toScreenRect(c.el.getBoundingClientRect()), client: c.el.getBoundingClientRect() }));

  const before = flowChildren.find(({ client: r }) =>
    column ? clientY < r.top + r.height / 2 : clientY < r.top || (clientY <= r.bottom && clientX < r.left + r.width / 2),
  );
  const line = (r: { x: number; y: number; width: number; height: number }, edge: 'start' | 'end'): Line => {
    if (column) {
      const y = edge === 'start' ? r.y - 2 : r.y + r.height + 2;
      return { x1: r.x, y1: y, x2: r.x + r.width, y2: y };
    }
    const x = edge === 'start' ? r.x - 2 : r.x + r.width + 2;
    return { x1: x, y1: r.y, x2: x, y2: r.y + r.height };
  };

  if (before) return { index: kept.indexOf(before.id), line: line(before.rect, 'start') };
  const last = flowChildren[flowChildren.length - 1];
  if (last) return { index: kept.indexOf(last.id) + 1, line: line(last.rect, 'end') };
  const box = toScreenRect(el.getBoundingClientRect());
  const inset = 6;
  return { index: kept.length, line: { x1: box.x + inset, y1: box.y + inset, x2: box.x + box.width - inset, y2: box.y + inset } };
}

export function acceptsChildren(el: ElementNode | undefined): el is ElementNode {
  return !!el && elementSpec(el.tag).acceptsChildren;
}

/** The deepest container under the pointer that could receive `draggedId` in its flow. */
export function findDropTarget(doc: DesignDocument, draggedId: NodeId, clientX: number, clientY: number): DropTarget | null {
  const excluded = new Set(subtreeIds(doc, draggedId));
  for (const el of elementsAtPoint(clientX, clientY)) {
    const id = el.getAttribute('data-pl-id');
    if (!id || excluded.has(id)) continue;
    const node = getElement(doc, id);
    if (!acceptsChildren(node)) continue;
    const insertion = flowInsertion(doc, node, excluded, clientX, clientY);
    if (insertion) return { parentId: id, ...insertion };
  }
  return null;
}

/** The deepest container under the pointer (for click-to-insert). */
export function containerAt(doc: DesignDocument, clientX: number, clientY: number): ElementNode | null {
  for (const el of elementsAtPoint(clientX, clientY)) {
    const node = getElement(doc, el.getAttribute('data-pl-id'));
    if (acceptsChildren(node)) return node;
  }
  return null;
}

/**
 * Should a new child flow (flex/grid/inline/stacked blocks) or be freely positioned?
 * Artboards and empty block containers start in free positioning for exploration.
 */
export function insertsInFlow(doc: DesignDocument, container: ElementNode): boolean {
  const el = domElement(container.id);
  if (!el) return false;
  const display = getComputedStyle(el).display;
  if (display.includes('flex') || display.includes('grid') || display.startsWith('inline')) return true;
  if (isRoot(doc, container.id)) return false;
  return container.children.some((c) => doc.nodes[c]?.kind === 'element' && !isOutOfFlow(domElement(c)));
}
