/**
 * Layer actions for the canvas menu and their shortcuts: copy styles, frame/ungroup, layer order,
 * show/hide and lock. Each is one undoable step.
 *
 * Hiding is the HTML-native kind: `display: none` on the element (so the canvas and the shipped
 * page agree), with its previous display kept in `data-pl-display` to restore on show. Locking
 * is editor metadata (project.json): locked layers can't be picked or dragged on the canvas, but
 * stay selectable in the Layers panel.
 */
import { screenRectOf, domElement, isOutOfFlow, styleOf } from '../canvas/dom.ts';
import { notify } from '../canvas/gestureStore.ts';
import { unionRects, type Rect } from '../canvas/coords.ts';
import { detachClass, insertChild, insertRoot, moveNode, removeNodes, setAttribute, setFrame, setStyleOnNodes, stripPosition, wrapInStack } from '../document/ops.ts';
import { moveLayers } from '../document/layerMove.ts';
import { createId } from '../document/ids.ts';
import { takenClassNames, uniqueClassName } from '../document/factory.ts';
import { getElement, getParentId, nodesWithClass, pageOf, subtreeIds, topmostIds } from '../document/tree.ts';
import type { DesignDocument, NodeId } from '../document/types.ts';
import { serializeNode } from '../serialization/html.ts';
import { worldRectOf } from './commands.ts';
import { useEditor } from './store.ts';

const state = () => useEditor.getState();
const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function selected(): NodeId[] {
  const { doc, selection } = state();
  return topmostIds(doc, selection).filter((id) => getElement(doc, id));
}

/** The element's own class, detaching a shared one first, so a change affects only this layer. */
function ownClass(doc: DesignDocument, id: NodeId): DesignDocument {
  const cls = getElement(doc, id)?.classes[0];
  return cls && nodesWithClass(doc, cls).length > 1 ? detachClass(doc, id) : doc;
}

// --- styles ----------------------------------------------------------------------------------

/** Where a layer sits rather than how it looks: never copied between layers. */
const PLACEMENT = /^(position|left|top|right|bottom|inset.*|z-index|width|height|min-width|min-height|max-width|max-height|margin.*|grid-(area|row|column).*|order|flex|flex-(grow|shrink|basis)|align-self|justify-self|place-self)$/;

let copiedStyles: Readonly<Record<string, string>> | null = null;

export function hasCopiedStyles(): boolean {
  return copiedStyles !== null;
}

export function copyStyles(): void {
  const id = selected()[0];
  const { doc } = state();
  const cls = id ? getElement(doc, id)?.classes[0] : undefined;
  const rule = cls ? doc.styles.rules[cls] : undefined;
  if (!rule) return notify('This layer has no styles to copy.');
  copiedStyles = Object.fromEntries(Object.entries(rule).filter(([prop]) => !PLACEMENT.test(prop)));
  notify('Styles copied');
}

/** Replace the selection's look (not its size or position) with the copied styles. */
export function pasteStyles(): void {
  const styles = copiedStyles;
  const ids = selected();
  if (!styles || !ids.length) return;
  state().apply('Paste Styles', (doc) => {
    let next = doc;
    for (const id of ids) {
      next = ownClass(next, id);
      const cls = getElement(next, id)?.classes[0];
      const current = cls ? next.styles.rules[cls] ?? {} : {};
      for (const prop of Object.keys(current)) if (!PLACEMENT.test(prop) && !(prop in styles)) next = setStyleOnNodes(next, [id], prop, null);
      for (const [prop, value] of Object.entries(styles)) next = setStyleOnNodes(next, [id], prop, value);
    }
    return next;
  });
  notify('Styles pasted');
}

// --- structure -------------------------------------------------------------------------------

/**
 * Wrap the selection in a new frame. Freely positioned layers keep their place: the frame
 * covers them and they're re-offset inside it. Layers in flow get a frame that flows like them.
 * Frames on the canvas are gathered into a new frame at their position.
 */
export function frameSelection(): void {
  const { doc, viewport } = state();
  const ids = selected();
  if (!ids.length) return;
  const parent = getParentId(doc, ids[0]!);
  if (ids.some((id) => getParentId(doc, id) !== parent)) return notify('Select layers that share a parent to frame them.');

  if (parent && !ids.every((id) => isOutOfFlow(domElement(id)))) {
    // In flow: a frame that lays its contents out the way the parent did.
    const direction = styleOf(domElement(parent)!).flexDirection.startsWith('row') ? 'row' : 'column';
    state().apply('Frame Selection', (d) => {
      const result = wrapInStack(d, ids, { direction, gap: 0, placement: null });
      if (result.id) queueMicrotask(() => state().select([result.id!]));
      return result.doc;
    });
    return;
  }

  const rects = ids.map((id) => screenRectOf(id)).filter((r): r is Rect => !!r);
  const union = unionRects(rects);
  if (!union) return;
  const parentRect = parent ? screenRectOf(parent) : null;
  const parentEl = parent ? domElement(parent) : null;
  const world = worldRectOf(union);
  // Document pixels relative to the parent's padding box (or world position for canvas frames).
  const origin = parentRect
    ? { x: (union.x - parentRect.x) / viewport.zoom - (parentEl?.clientLeft ?? 0), y: (union.y - parentRect.y) / viewport.zoom - (parentEl?.clientTop ?? 0) }
    : { x: world.x, y: world.y };
  const offsets = new Map(ids.map((id) => {
    const r = screenRectOf(id)!;
    return [id, { x: (r.x - union.x) / viewport.zoom, y: (r.y - union.y) / viewport.zoom }] as const;
  }));

  state().apply('Frame Selection', (d) => {
    const id = createId();
    const cls = uniqueClassName(takenClassNames(d), 'frame');
    const rule: Record<string, string> = {
      'box-sizing': 'border-box',
      position: parent ? 'absolute' : 'relative',
      width: px(world.width),
      height: px(world.height),
      ...(parent ? { left: px(origin.x), top: px(origin.y) } : {}),
    };
    let next: DesignDocument = {
      ...d,
      styles: { ...d.styles, rules: { ...d.styles.rules, [cls]: rule } },
      nodes: { ...d.nodes, [id]: { kind: 'element', id, tag: 'div', attrs: {}, classes: [cls], children: [] } },
    };
    if (parent) {
      const index = Math.min(...ids.map((i) => getElement(next, parent)!.children.indexOf(i)));
      next = insertChild(next, parent, index, id);
    } else {
      const page = pageOf(next, ids[0]!)!;
      next = setFrame(insertRoot(next, page.file, Math.min(...ids.map((i) => page.roots.indexOf(i))), id), id, origin);
    }
    ids.forEach((child, i) => {
      const offset = offsets.get(child)!;
      next = moveNode(next, child, id, i);
      next = ownClass(next, child);
      next = setStyleOnNodes(next, [child], 'position', 'absolute');
      next = setStyleOnNodes(next, [child], 'left', px(offset.x));
      next = setStyleOnNodes(next, [child], 'top', px(offset.y));
    });
    queueMicrotask(() => state().select([id]));
    return next;
  });
}

/**
 * Ungroup: move a container's children up into its parent where they appear, then remove the
 * empty container. A frame on the canvas releases its children as frames at their positions.
 */
export function ungroupSelection(): void {
  const { doc, viewport } = state();
  const containers = selected().filter((id) => getElement(doc, id)!.children.some((c) => getElement(doc, c)));
  if (!containers.length) return notify('Select a frame or group with layers inside to ungroup.');
  const rects = new Map(containers.flatMap((id) => getElement(doc, id)!.children.map((c) => [c, screenRectOf(c)] as const)));
  const released: NodeId[] = [];
  state().apply('Ungroup', (d) => {
    let next = d;
    for (const container of containers) {
      const el = getElement(next, container);
      if (!el) continue;
      const parent = getParentId(next, container);
      const children = el.children.filter((c) => getElement(next, c));
      const containerFree = parent ? isOutOfFlow(domElement(container)) : false;
      const parentRect = parent ? screenRectOf(parent) : null;
      if (parent) {
        let index = getElement(next, parent)!.children.indexOf(container);
        for (const child of children) {
          next = moveNode(next, child, parent, index++);
          const rect = rects.get(child);
          // Free layers keep their place on screen; in-flow layers join the parent's flow.
          if (rect && parentRect && (containerFree || isOutOfFlow(domElement(child)))) {
            next = ownClass(next, child);
            next = setStyleOnNodes(next, [child], 'position', 'absolute');
            next = setStyleOnNodes(next, [child], 'left', px((rect.x - parentRect.x) / viewport.zoom));
            next = setStyleOnNodes(next, [child], 'top', px((rect.y - parentRect.y) / viewport.zoom));
          } else next = stripPosition(next, child);
        }
      } else {
        const page = pageOf(next, container);
        if (!page) continue;
        let index = page.roots.indexOf(container);
        for (const child of children) {
          next = insertRoot({ ...next, nodes: { ...next.nodes, [container]: { ...getElement(next, container)!, children: getElement(next, container)!.children.filter((c) => c !== child) } } }, page.file, index++, child);
          const rect = rects.get(child);
          if (rect) next = setFrame(next, child, worldRectOf(rect));
          next = ownClass(next, child);
          next = stripPosition(next, child);
          next = setStyleOnNodes(next, [child], 'position', 'relative');
        }
      }
      released.push(...children);
      next = removeNodes(next, [container]);
    }
    queueMicrotask(() => state().select(released.filter((id) => state().doc.nodes[id])));
    return next;
  });
}

export type Reorder = 'front' | 'back' | 'forward' | 'backward';

/** Layer order: later siblings draw on top (and come later in the HTML), like the Layers panel. */
export function reorderSelection(kind: Reorder): void {
  const { doc } = state();
  const ids = selected();
  if (!ids.length) return;
  const parent = getParentId(doc, ids[0]!);
  if (ids.some((id) => getParentId(doc, id) !== parent)) return;
  const siblings = parent ? getElement(doc, parent)!.children.filter((c) => getElement(doc, c)) : pageOf(doc, ids[0]!)?.roots ?? [];
  const others = siblings.filter((id) => !ids.includes(id));
  if (!others.length) return;
  const positions = ids.map((id) => siblings.indexOf(id));
  let target: NodeId | undefined;
  let placement: 'before' | 'after';
  if (kind === 'front') [target, placement] = [others.at(-1), 'after'];
  else if (kind === 'back') [target, placement] = [others[0], 'before'];
  else if (kind === 'forward') [target, placement] = [siblings.slice(Math.max(...positions) + 1).find((id) => !ids.includes(id)), 'after'];
  else [target, placement] = [siblings.slice(0, Math.min(...positions)).reverse().find((id) => !ids.includes(id)), 'before'];
  if (!target) return;
  const label = { front: 'Bring to Front', back: 'Send to Back', forward: 'Move Forward', backward: 'Move Backward' }[kind];
  state().apply(label, (d) => moveLayers(d, ids, target!, placement), { select: ids });
}

// --- visibility and locking ------------------------------------------------------------------

export function isHidden(doc: DesignDocument, id: NodeId): boolean {
  const cls = getElement(doc, id)?.classes[0];
  return Boolean(cls && doc.styles.rules[cls]?.display === 'none');
}

export function isLocked(doc: DesignDocument, id: NodeId): boolean {
  return Boolean(doc.locked?.includes(id));
}

/** Show or hide the selection (all follow the first: if it's hidden, all are shown). */
export function toggleHidden(only?: readonly NodeId[]): void {
  const { doc } = state();
  const ids = only ? [...only] : selected();
  if (!ids.length) return;
  const show = isHidden(doc, ids[0]!);
  state().apply(show ? 'Show Layers' : 'Hide Layers', (d) => {
    let next = d;
    for (const id of ids) {
      next = ownClass(next, id);
      const el = getElement(next, id)!;
      const cls = el.classes[0];
      if (show) {
        if (!isHidden(next, id)) continue;
        next = setStyleOnNodes(next, [id], 'display', el.attrs['data-pl-display'] || null);
        next = setAttribute(next, id, 'data-pl-display', null);
      } else {
        if (isHidden(next, id)) continue;
        const previous = cls ? next.styles.rules[cls]?.display : undefined;
        if (previous) next = setAttribute(next, id, 'data-pl-display', previous);
        next = setStyleOnNodes(next, [id], 'display', 'none');
      }
    }
    return next;
  });
}

/** Lock or unlock the selection (all follow the first). */
export function toggleLocked(only?: readonly NodeId[]): void {
  const { doc } = state();
  const ids = only ? [...only] : selected();
  if (!ids.length) return;
  const unlock = isLocked(doc, ids[0]!);
  state().apply(unlock ? 'Unlock Layers' : 'Lock Layers', (d) => {
    const locked = new Set(d.locked ?? []);
    for (const id of ids) (unlock ? locked.delete(id) : locked.add(id));
    return { ...d, locked: [...locked] };
  });
  notify(unlock ? 'Unlocked' : 'Locked: it can’t be selected on the canvas. Use the Layers panel to unlock.');
}

/**
 * What a canvas click on `id` picks: the layer, or (when it or an ancestor is locked) the
 * nearest unlocked layer above the locked one, or nothing for a locked frame.
 */
export function selectableTarget(doc: DesignDocument, id: NodeId | null): NodeId | null {
  if (!id || !doc.locked?.length) return id;
  let top: NodeId | null = null;
  for (let current: NodeId | null = id; current; current = getParentId(doc, current)) if (doc.locked.includes(current)) top = current;
  return top ? getParentId(doc, top) : id;
}

// --- copy as ---------------------------------------------------------------------------------

export type CopyFormat = 'html' | 'css' | 'png';

async function writeText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(done);
  } catch {
    notify('Couldn’t reach the clipboard. Try again.');
  }
}

/** Copy the selection as its HTML, its CSS rules, or a PNG image. */
export async function copyAs(format: CopyFormat): Promise<void> {
  const { doc, assetBase } = state();
  const ids = selected();
  if (!ids.length) return;
  if (format === 'html') return writeText(ids.map((id) => serializeNode(doc, id)).join('\n'), 'Copied as HTML');
  if (format === 'css') {
    const classes = new Set(ids.flatMap((id) => subtreeIds(doc, id)).flatMap((id) => getElement(doc, id)?.classes ?? []));
    const css = [...classes]
      .filter((cls) => doc.styles.rules[cls])
      .map((cls) => `.${cls} {\n${Object.entries(doc.styles.rules[cls]!).map(([prop, value]) => `  ${prop}: ${value};`).join('\n')}\n}`)
      .join('\n\n');
    return writeText(css, 'Copied as CSS');
  }
  try {
    const { captureThumbnail } = await import('./thumbnail.ts');
    const image = await captureThumbnail(doc, ids[0]!, assetBase);
    const blob = await (await fetch(image.image)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    notify('Copied as PNG');
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Couldn’t copy as PNG.');
  }
}

