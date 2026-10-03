/** One structural move for layer dragging, shared by tests and the editor. */
import { detach, insertChild, insertRoot, setFrame } from './ops.ts';
import { getElement, getParentId, pageOf, rootOf, subtreeIds, topmostIds } from './tree.ts';
import { elementSpec } from '../elements/registry.ts';
import type { DesignDocument, NodeId } from './types.ts';
export type LayerPlacement = 'before' | 'inside' | 'after';
export function canMoveLayers(doc: DesignDocument, ids: readonly NodeId[], target: NodeId, placement: LayerPlacement): boolean {
  const moving = topmostIds(doc, ids);
  const node = getElement(doc, target);
  if (!moving.length || !node || !pageOf(doc, target)) return false;
  if (placement === 'inside' && !elementSpec(node.tag).acceptsChildren) return false;
  return moving.every((id) => getElement(doc, id) && pageOf(doc, id) && !subtreeIds(doc, id).includes(target));
}
export function moveLayers(doc: DesignDocument, ids: readonly NodeId[], target: NodeId, placement: LayerPlacement): DesignDocument {
  if (!canMoveLayers(doc, ids, target, placement)) return doc;
  const moving = topmostIds(doc, ids);
  // Keep document order rather than the order in which a multi-selection was clicked.
  const order = doc.pages.flatMap((page) => page.roots.flatMap((id) => subtreeIds(doc, id)));
  moving.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const parentId = placement === 'inside' ? target : getParentId(doc, target);
  const page = pageOf(doc, target)!;
  const positions = Object.fromEntries(moving.map((id) => [id, doc.frames[rootOf(doc, id)] ?? { x: 0, y: 0 }]));
  let next = moving.reduce((current, id) => detach(current, id), doc);
  const siblings = parentId ? getElement(next, parentId)!.children : next.pages.find((p) => p.file === page.file)!.roots;
  const index = placement === 'inside' ? siblings.length : siblings.indexOf(target) + (placement === 'after' ? 1 : 0);
  moving.forEach((id, offset) => {
    if (parentId) {
      next = insertChild(next, parentId, index + offset, id);
      const frames = { ...next.frames };
      delete frames[id];
      next = { ...next, frames };
    } else {
      next = insertRoot(next, page.file, index + offset, id);
      next = setFrame(next, id, positions[id]!);
    }
  });
  const movedIds = new Set(moving.flatMap((id) => subtreeIds(doc, id)));
  const guides = doc.pages.flatMap((p) => p.guides ?? []).filter((g) => g.frame && movedIds.has(g.frame));
  if (guides.length) next = { ...next, pages: next.pages.map((p) => ({ ...p, guides: [
    ...(p.guides ?? []).filter((g) => !guides.some((moved) => moved.id === g.id)), ...(p.file === page.file ? guides : []),
  ] })) };
  return next;
}
