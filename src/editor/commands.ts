/**
 * Editor commands: user intents that may need live layout measurements before producing a
 * pure document edit. Shortcuts, the tool rail, the inspector and (later) an agent API all call these.
 */
import { enterVectorEdit, vectorTargetFor } from '../vector/edit.ts';
import { fitRect, screenToWorld, unionRects, zoomAround, type Rect, type Viewport } from '../canvas/coords.ts';
import { domElement, getViewportElement, hostOf, isOutOfFlow, screenRectOf, styleOf } from '../canvas/dom.ts';
import { containerAt, flowInsertion, insertsInFlow } from '../canvas/layout.ts';
import { canMoveLayers, moveLayers, type LayerPlacement } from '../document/layerMove.ts';
import { instantiate } from '../document/factory.ts';
import { detachClass, duplicateNodes, insertChild, insertRoot, removeNodes, setFrame, setStyleOnNodes, stripPosition, wrapInStack } from '../document/ops.ts';
import { getElement, getParentId, hasOnlyTextChildren, isRoot, nodesWithClass, topmostIds } from '../document/tree.ts';
import type { DesignDocument, NodeId } from '../document/types.ts';
import { frameSpec } from '../elements/insertables.ts';
import { elementSpec } from '../elements/registry.ts';
import { activeRoots, useEditor } from './store.ts';
import { notify } from '../canvas/gestureStore.ts';
import { selectFont } from '../document/fonts.ts';
import { DEFAULT_TEXT_FONT } from '../elements/insertables.ts';

const px = (n: number) => `${Math.round(n)}px`;
const state = () => useEditor.getState();

export function deleteSelection(): void {
  const { selection, doc } = state();
  if (!selection.length) return;
  const parent = selection.length === 1 ? getParentId(doc, selection[0]!) : null;
  state().apply('Delete', (d) => removeNodes(d, selection), { select: parent ? [parent] : [] });
}

export function duplicateSelection(): void {
  const { selection, doc } = state();
  const ids = topmostIds(doc, selection);
  if (!ids.length) return;
  let created: NodeId[] = [];
  state().apply('Duplicate', (d) => {
    const result = duplicateNodes(d, ids);
    created = result.ids;
    return result.doc;
  });
  state().select(created);
}

/** "Add auto layout": wrap selected siblings in a flex stack, inferring direction and gap. */
export function wrapSelectionInStack(): void {
  const { selection, doc, viewport } = state();
  const ids = topmostIds(doc, selection);
  const first = ids[0];
  if (!first) return;
  const parentId = getParentId(doc, first);
  const parentEl = domElement(parentId);
  const items = ids
    .filter((id) => getParentId(doc, id) === parentId)
    .map((id) => ({ id, rect: screenRectOf(id) }))
    .filter((i): i is { id: NodeId; rect: Rect } => !!i.rect);
  if (!items.length || (parentId && !parentEl)) return;

  const xs = items.map((i) => i.rect.x + i.rect.width / 2);
  const ys = items.map((i) => i.rect.y + i.rect.height / 2);
  const direction = items.length > 1 && Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys) ? 'row' : 'column';
  items.sort((a, b) => (direction === 'row' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));

  const gaps = items.slice(1).map((item, i) => {
    const prev = items[i]!.rect;
    return direction === 'row' ? item.rect.x - (prev.x + prev.width) : item.rect.y - (prev.y + prev.height);
  });
  const averageGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length / viewport.zoom : 0;
  const gap = Math.max(0, Math.round(Number.isFinite(averageGap) ? averageGap : 12));

  const allFree = items.every((i) => isOutOfFlow(domElement(i.id)));
  let placement = null;
  if (!parentId) {
    const union = unionRects(items.map((i) => i.rect))!;
    placement = screenToWorld({ x: union.x, y: union.y }, viewport);
  } else if (allFree && parentEl) {
    const union = unionRects(items.map((i) => i.rect))!;
    const parentRect = screenRectOf(parentId!)!;
    placement = {
      x: (union.x - parentRect.x) / viewport.zoom - parentEl.clientLeft,
      y: (union.y - parentRect.y) / viewport.zoom - parentEl.clientTop,
    };
  }
  let stackId: NodeId | null = null;
  state().apply('Wrap in stack', (d) => {
    const result = wrapInStack(d, items.map((i) => i.id), { direction, gap: Math.min(gap, 64), placement });
    stackId = result.id;
    return result.doc;
  });
  if (stackId) state().select([stackId]);
}

/**
 * ⇧A / "Add flex": a single container without a layout becomes a flex column; anything else
 * (several elements, or a non-container) is wrapped in a new flex stack.
 */
export function addFlexOrWrap(): void {
  const { selection, doc } = state();
  const only = selection.length === 1 ? getElement(doc, selection[0]) : undefined;
  const el = only ? domElement(only.id) : null;
  if (only && el && elementSpec(only.tag).acceptsChildren && !canEditText(doc, only.id) && !/flex|grid/.test(styleOf(el).display)) {
    state().apply('Add flex', (d) => {
      let next = setStyleOnNodes(d, [only.id], 'display', 'flex');
      next = setStyleOnNodes(next, [only.id], 'flex-direction', 'column');
      return setStyleOnNodes(next, [only.id], 'gap', '12px');
    });
    return;
  }
  wrapSelectionInStack();
}

/** ⌥C / "Clip content": toggle `overflow: hidden` on the selection. */
export function toggleClipContent(): void {
  const { selection, doc } = state();
  if (!selection.length) return;
  const clipped = selection.every((id) => {
    const cls = getElement(doc, id)?.classes[0];
    return !!cls && doc.styles.rules[cls]?.overflow === 'hidden';
  });
  state().apply('Clip content', (d) => setStyleOnNodes(d, selection, 'overflow', clipped ? null : 'hidden'));
}

/** Switch between free positioning and layout positioning without the element jumping. */
export function setFreePositioning(ids: readonly NodeId[], free: boolean): void {
  if (free) {
    const offsets = ids.map((id) => {
      const el = domElement(id);
      return { id, left: el?.offsetLeft ?? 0, top: el?.offsetTop ?? 0 };
    });
    state().apply('Free position', (d) => {
      let next = d;
      for (const o of offsets) {
        const parentId = getParentId(next, o.id);
        const parentEl = domElement(parentId);
        if (parentId && parentEl && styleOf(parentEl).position === 'static') {
          next = setStyleOnNodes(next, [parentId], 'position', 'relative');
        }
        next = setStyleOnNodes(next, [o.id], 'position', 'absolute');
        next = setStyleOnNodes(next, [o.id], 'left', px(o.left));
        next = setStyleOnNodes(next, [o.id], 'top', px(o.top));
      }
      return next;
    });
  } else {
    state().apply('Layout position', (d) => ids.reduce((next: DesignDocument, id) => stripPosition(next, id), d));
  }
}

export function nudgeSelection(dx: number, dy: number): void {
  const { selection, doc } = state();
  const ids = topmostIds(doc, selection);
  if (!ids.length) return;
  const roots = ids.filter((id) => isRoot(doc, id));
  const free = ids.filter((id) => !isRoot(doc, id) && isOutOfFlow(domElement(id)));
  const starts = free.map((id) => {
    const cs = styleOf(domElement(id)!);
    return { id, left: parseFloat(cs.left) || 0, top: parseFloat(cs.top) || 0 };
  });
  state().apply(
    'Nudge',
    (d) => {
      let next = d;
      for (const id of roots) {
        const f = next.frames[id] ?? { x: 0, y: 0 };
        next = setFrame(next, id, { x: f.x + dx, y: f.y + dy });
      }
      for (const s of starts) {
        next = setStyleOnNodes(next, [s.id], 'left', px(s.left + dx));
        next = setStyleOnNodes(next, [s.id], 'top', px(s.top + dy));
      }
      return next;
    },
    { coalesce: `nudge:${ids.join(',')}` },
  );
}

export function selectParent(): void {
  const { selection, doc } = state();
  const first = selection[0];
  if (!first) return;
  const parent = getParentId(doc, first);
  state().select(parent ? [parent] : []);
}

export function canEditText(doc: DesignDocument, id: NodeId): boolean {
  const el = getElement(doc, id);
  return !!el && elementSpec(el.tag).editableText && hasOnlyTextChildren(doc, el);
}

/** Enter: edit text, or step into the first child. */
export function enterSelection(): void {
  const { selection, doc } = state();
  const id = selection[0];
  const el = getElement(doc, id);
  if (!id || !el) return;
  if (canEditText(doc, id)) {
    state().setEditingText(id);
    return;
  }
  const vector = vectorTargetFor(doc, id);
  if (vector) {
    enterVectorEdit(vector);
    return;
  }
  const child = el.children.find((c) => doc.nodes[c]?.kind === 'element');
  if (child) state().select([child]);
}

export function createFrame(rect: Rect): void {
  const { doc, selection, viewport } = state();
  const origin = getViewportElement()?.getBoundingClientRect();
  const clientX = rect.x * viewport.zoom + viewport.x + (origin?.left ?? 0);
  const clientY = rect.y * viewport.zoom + viewport.y + (origin?.top ?? 0);
  const selected = selection.length === 1 ? getElement(doc, selection[0]) : undefined;
  const parent = selected && elementSpec(selected.tag).acceptsChildren
    ? selected : containerAt(doc, clientX, clientY);
  const parentEl = domElement(parent?.id);
  const bounds = parent ? screenRectOf(parent.id) : null;
  const flow = parent ? insertsInFlow(doc, parent) : false;
  const index = parent && flow ? flowInsertion(doc, parent, new Set(), clientX, clientY)?.index : undefined;
  // World coordinates are converted to the parent's padding box, including its scroll offset.
  const parentWorld = bounds ? screenToWorld(bounds, viewport) : doc.frames[parent?.id ?? ''];
  const left = rect.x - (parentWorld?.x ?? rect.x) - (parentEl?.clientLeft ?? 0) + (parentEl?.scrollLeft ?? 0);
  const top = rect.y - (parentWorld?.y ?? rect.y) - (parentEl?.clientTop ?? 0) + (parentEl?.scrollTop ?? 0);
  let id: NodeId = '';
  state().apply('Add Frame', (d) => {
    const spec = frameSpec(rect.width, rect.height);
    const created = instantiate(d, { ...spec, style: { ...spec.style, height: px(rect.height),
      ...(parent && !flow ? { position: 'absolute', left: px(left), top: px(top) } : {}),
      ...(flow ? { 'flex-shrink': '0' } : {}),
    } });
    const made = { ...created, doc: selectFont(created.doc, [created.id], DEFAULT_TEXT_FONT) };
    id = made.id;
    if (parent) {
      let next = insertChild(made.doc, parent.id, index ?? parent.children.length, made.id);
      if (!flow && parentEl && styleOf(parentEl).position === 'static') next = setStyleOnNodes(next, [parent.id], 'position', 'relative');
      return next;
    }
    return setFrame(insertRoot(made.doc, state().activePage, Number.MAX_SAFE_INTEGER, made.id), made.id, { x: rect.x, y: rect.y });
  });
  state().select([id]);
}

/** Layer-panel moves use the browser's layout, then commit structure and positioning together. */
export function moveLayersTo(ids: readonly NodeId[], target: NodeId, placement: LayerPlacement): void {
  const { doc, viewport } = state();
  if (!canMoveLayers(doc, ids, target, placement)) return;
  const moving = topmostIds(doc, ids);
  const parentId = placement === 'inside' ? target : getParentId(doc, target);
  const parent = getElement(doc, parentId);
  const parentEl = domElement(parentId);
  const bounds = parentId ? screenRectOf(parentId) : null;
  const flow = parent ? insertsInFlow(doc, parent) : false;
  const rects = new Map(moving.map(id => [id, screenRectOf(id)]));
  state().apply('Move Layers', d => {
    let next = moveLayers(d, moving, target, placement);
    for (const id of moving) {
      if (getParentId(d, id) === parentId) continue; // Reordering preserves intentional absolute positioning.
      const rect = rects.get(id);
      if (!parentId) {
        if (rect) next = setFrame(next, id, screenToWorld(rect, viewport));
        next = setLayerPosition(next, id, { position: 'relative' });
      } else if (flow) {
        next = setLayerPosition(next, id, { position: 'relative' });
      } else if (rect && bounds) {
        next = setLayerPosition(next, id, { position: 'absolute',
          left: px((rect.x - bounds.x) / viewport.zoom - (parentEl?.clientLeft ?? 0) + (parentEl?.scrollLeft ?? 0)),
          top: px((rect.y - bounds.y) / viewport.zoom - (parentEl?.clientTop ?? 0) + (parentEl?.scrollTop ?? 0)),
        });
      }
    }
    if (parentId && !flow && parentEl && styleOf(parentEl).position === 'static') next = setStyleOnNodes(next, [parentId], 'position', 'relative');
    return next;
  }, { select: moving });
  if (parentId) state().setCollapsed(parentId, false);
}

function setLayerPosition(doc: DesignDocument, id: NodeId, values: Record<string, string>): DesignDocument {
  const primary = getElement(doc, id)?.classes[0];
  let next = primary && nodesWithClass(doc, primary).length > 1 ? detachClass(doc, id) : doc;
  // Remove shorthands rather than adding them after left/top (which would override those offsets).
  for (const prop of ['inset', 'inset-inline', 'inset-block', 'inset-inline-start', 'inset-inline-end', 'inset-block-start', 'inset-block-end']) {
    next = setStyleOnNodes(next, [id], prop, null);
  }
  for (const prop of ['left', 'right', 'top', 'bottom']) {
    next = setStyleOnNodes(next, [id], prop, 'auto');
  }
  for (const [prop, value] of Object.entries(values)) next = setStyleOnNodes(next, [id], prop, value);
  return next;
}

// --- viewport -------------------------------------------------------------------------------

function screenSize() {
  const el = getViewportElement();
  return { width: el?.clientWidth ?? window.innerWidth, height: el?.clientHeight ?? window.innerHeight };
}

export function zoomBy(factor: number): void {
  const { viewport } = state();
  const size = screenSize();
  state().setViewport(zoomAround(viewport, { x: size.width / 2, y: size.height / 2 }, viewport.zoom * factor));
}

export function zoomTo(zoom: number): void {
  const { viewport } = state();
  const size = screenSize();
  state().setViewport(zoomAround(viewport, { x: size.width / 2, y: size.height / 2 }, zoom));
}

export function worldRectOf(screenRect: Rect): Rect {
  const { viewport } = state();
  const p = screenToWorld({ x: screenRect.x, y: screenRect.y }, viewport);
  return { x: p.x, y: p.y, width: screenRect.width / viewport.zoom, height: screenRect.height / viewport.zoom };
}

export function zoomToFit(): void {
  const rects = activeRoots(state())
    .map((id) => hostOf(id))
    .filter((h): h is HTMLIFrameElement => !!h)
    .map((h) => {
      const r = h.getBoundingClientRect();
      const origin = getViewportElement()?.getBoundingClientRect();
      return worldRectOf({ x: r.left - (origin?.left ?? 0), y: r.top - (origin?.top ?? 0), width: r.width, height: r.height });
    });
  const union = unionRects(rects);
  if (union) state().setViewport(fitRect(union, screenSize()));
}

let viewportAnimation = 0;

/** Glide the canvas to `target` (zoom eases geometrically, so it feels even at any scale). */
export function animateViewport(target: Viewport, duration = 300): void {
  cancelAnimationFrame(viewportAnimation);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    state().setViewport(target);
    return;
  }
  const from = state().viewport;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - (1 - t) ** 3;
    state().setViewport({
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      zoom: from.zoom * (target.zoom / from.zoom) ** e,
    });
    if (t < 1) viewportAnimation = requestAnimationFrame(step);
  };
  viewportAnimation = requestAnimationFrame(step);
}

/**
 * Bring a layer into view, like Figma's and Paper's zoom to layer: fit it on screen without
 * zooming past 200% on tiny elements. Hidden or empty elements use their nearest visible parent.
 */
export function zoomToLayer(id: NodeId): void {
  const { doc } = state();
  let current: NodeId | null = id;
  while (current) {
    const rect = screenRectOf(current);
    if (rect && rect.width > 0 && rect.height > 0) {
      animateViewport(fitRect(worldRectOf(rect), screenSize(), 96, 2));
      return;
    }
    current = getParentId(doc, current);
  }
}

export function zoomToSelection(): void {
  const { selection } = state();
  const rects = selection.map(screenRectOf).filter((r): r is Rect => !!r).map(worldRectOf);
  const union = unionRects(rects);
  if (union) state().setViewport(fitRect(union, screenSize(), 96, 4));
  else zoomToFit();
}

/**
 * Select and zoom to the next (or previous) artboard on the page, in layer order, wrapping
 * around. Starts from the artboard holding the selection.
 */
export function cycleArtboard(step: 1 | -1): void {
  const store = state();
  const roots = activeRoots(store);
  if (!roots.length) return;
  const current = store.selection.length ? rootOfNode(store.doc, store.selection.at(-1)!) : null;
  const index = current ? roots.indexOf(current) : -1;
  const next = roots[index < 0 ? (step > 0 ? 0 : roots.length - 1) : (index + step + roots.length) % roots.length]!;
  store.select([next]);
  zoomToLayer(next);
}

function rootOfNode(doc: DesignDocument, id: NodeId): NodeId {
  let current = id;
  for (let parent = getParentId(doc, current); parent; parent = getParentId(doc, current)) current = parent;
  return current;
}

/** Hide or show the panels and toolbar (".") for an uncluttered canvas. */
export function toggleUi(): void {
  const hidden = !state().uiHidden;
  state().setUiHidden(hidden);
  if (hidden) notify('Press . to show the interface');
}
