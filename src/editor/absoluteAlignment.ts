import { domElement, styleOf } from '../canvas/dom.ts';
import { getParentId } from '../document/tree.ts';
import { setStyleOnNodes } from '../document/ops.ts';
import type { NodeId } from '../document/types.ts';
import { useEditor } from './store.ts';
export type Alignment = 'start' | 'center' | 'end';
export type AlignmentAxis = 'x' | 'y';
/** Align the visible bounds inside the parent's padded area, including rotated elements. */
export function alignedPosition(start: number, available: number, size: number, alignment: Alignment, visualOffset: number): number {
  return start + (available - size) * (alignment === 'start' ? 0 : alignment === 'center' ? .5 : 1) - visualOffset;
}
export function alignAbsoluteLayers(ids: readonly NodeId[], axis: AlignmentAxis, alignment: Alignment): void {
  const { doc } = useEditor.getState();
  const edits = ids.flatMap(id => {
    const parent = getParentId(doc, id); const el = domElement(id); const container = domElement(parent);
    if (!el || !container || !parent) return [];
    const cs = styleOf(el); const pcs = styleOf(container);
    if (cs.position !== 'absolute' || !pcs.display.includes('flex')) return [];
    const rect = el.getBoundingClientRect();
    const offsetParent = el.offsetParent as HTMLElement | null;
    const offsetRect = offsetParent?.getBoundingClientRect();
    const horizontal = axis === 'x';
    const paddingStart = parseFloat(horizontal ? pcs.paddingLeft : pcs.paddingTop) || 0;
    const paddingEnd = parseFloat(horizontal ? pcs.paddingRight : pcs.paddingBottom) || 0;
    const extent = horizontal ? container.clientWidth : container.clientHeight;
    // Difference between the layout origin and visible bounds preserves existing transforms.
    const visualOffset = (horizontal ? rect.x : rect.y) - ((horizontal ? offsetRect?.x : offsetRect?.y) ?? 0)
      - (horizontal ? offsetParent?.clientLeft ?? 0 : offsetParent?.clientTop ?? 0)
      - (horizontal ? el.offsetLeft : el.offsetTop)
      + (parseFloat(horizontal ? cs.marginLeft : cs.marginTop) || 0);
    const position = alignedPosition(paddingStart, extent - paddingStart - paddingEnd, horizontal ? rect.width : rect.height, alignment, visualOffset);
    // For a static flex parent, establishing the containing block makes these local offsets valid.
    return [{ id, parent, relative: pcs.position === 'static', position }];
  });
  if (!edits.length) return;
  useEditor.getState().apply(`Align ${axis === 'x' ? 'Horizontal' : 'Vertical'}`, d => {
    for (const edit of edits) {
      if (edit.relative) d = setStyleOnNodes(d, [edit.parent], 'position', 'relative');
      d = setStyleOnNodes(d, [edit.id], axis === 'x' ? 'left' : 'top', `${Math.round(edit.position * 100) / 100}px`);
      d = setStyleOnNodes(d, [edit.id], axis === 'x' ? 'right' : 'bottom', 'auto');
    }
    return d;
  });
}
