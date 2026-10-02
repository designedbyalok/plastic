/**
 * Pure document operations: (doc, …) => doc.
 *
 * Every visual edit goes through one of these, which keeps undo/redo trivial (snapshots of
 * immutable data) and gives future agents/MCP tools the same vocabulary the UI uses.
 */
import { createId } from './ids';
import { takenClassNames, uniqueClassName } from './factory';
import { getElement, getParentId, isRoot, nodesWithClass, subtreeIds } from './tree';
import type { Declarations, DesignDocument, DocNode, ElementNode, NodeId, Point } from './types';

type MutableNodes = Record<NodeId, DocNode>;

function updateElement(doc: DesignDocument, id: NodeId, fn: (el: ElementNode) => ElementNode): DesignDocument {
  const el = getElement(doc, id);
  if (!el) return doc;
  const next = fn(el);
  return next === el ? doc : { ...doc, nodes: { ...doc.nodes, [id]: next } };
}

// ---------------------------------------------------------------------------------------------
// Structure

/** Attach an existing (detached) node. `parentId === null` makes it a root/artboard. */
export function insertChild(doc: DesignDocument, parentId: NodeId | null, index: number, childId: NodeId): DesignDocument {
  if (parentId === null) {
    const roots = [...doc.roots];
    roots.splice(clampIndex(index, roots.length), 0, childId);
    return { ...doc, roots };
  }
  return updateElement(doc, parentId, (el) => {
    const children = [...el.children];
    children.splice(clampIndex(index, children.length), 0, childId);
    return { ...el, children };
  });
}

/** Remove a node from its parent (or the roots) without deleting it. */
export function detach(doc: DesignDocument, id: NodeId): DesignDocument {
  if (isRoot(doc, id)) return { ...doc, roots: doc.roots.filter((r) => r !== id) };
  const parentId = getParentId(doc, id);
  if (!parentId) return doc;
  return updateElement(doc, parentId, (el) => ({ ...el, children: el.children.filter((c) => c !== id) }));
}

/** Move a node. `index` is its position among the target's children after it was removed. */
export function moveNode(doc: DesignDocument, id: NodeId, parentId: NodeId | null, index: number): DesignDocument {
  if (parentId !== null && subtreeIds(doc, id).includes(parentId)) return doc;
  let next = insertChild(detach(doc, id), parentId, index, id);
  if (parentId !== null && next.frames[id]) next = removeKeys(next, [id]);
  return next;
}

/** Delete nodes with their subtrees. Class rules nobody uses anymore are removed too. */
export function removeNodes(doc: DesignDocument, ids: readonly NodeId[]): DesignDocument {
  let next = doc;
  const removed = new Set<NodeId>();
  const classes = new Set<string>();
  for (const id of ids) {
    if (!next.nodes[id] || removed.has(id)) continue;
    for (const nid of subtreeIds(next, id)) {
      removed.add(nid);
      const node = next.nodes[nid];
      if (node?.kind === 'element') node.classes.forEach((c) => classes.add(c));
    }
    next = detach(next, id);
  }
  if (!removed.size) return doc;
  const nodes: MutableNodes = { ...next.nodes };
  for (const id of removed) delete nodes[id];
  next = removeKeys({ ...next, nodes }, [...removed]);
  const rules = { ...next.styles.rules };
  for (const c of classes) if (!nodesWithClass(next, c).length) delete rules[c];
  return { ...next, styles: { ...next.styles, rules } };
}

function removeKeys(doc: DesignDocument, ids: readonly NodeId[]): DesignDocument {
  const frames = { ...doc.frames };
  const names = { ...doc.names };
  for (const id of ids) {
    delete frames[id];
    delete names[id];
  }
  return { ...doc, frames, names };
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length, index));
}

// ---------------------------------------------------------------------------------------------
// Semantics & content

export function setTag(doc: DesignDocument, id: NodeId, tag: string): DesignDocument {
  return updateElement(doc, id, (el) => (el.tag === tag ? el : { ...el, tag }));
}

/** Set or remove (`null`) an attribute. Boolean attributes use "". */
export function setAttribute(doc: DesignDocument, id: NodeId, name: string, value: string | null): DesignDocument {
  const key = name.trim().toLowerCase();
  if (!key || key === 'class' || key === 'data-pl-id') return doc;
  return updateElement(doc, id, (el) => {
    if (value === null) {
      if (!(key in el.attrs)) return el;
      const attrs = { ...el.attrs };
      delete attrs[key];
      return { ...el, attrs };
    }
    return el.attrs[key] === value ? el : { ...el, attrs: { ...el.attrs, [key]: value } };
  });
}

/** Replace the element's first text child (adding one if missing). */
export function setText(doc: DesignDocument, id: NodeId, text: string): DesignDocument {
  const el = getElement(doc, id);
  if (!el) return doc;
  const textId = el.children.find((c) => doc.nodes[c]?.kind === 'text');
  if (textId) {
    const node = doc.nodes[textId];
    if (node?.kind === 'text' && node.text === text) return doc;
    return { ...doc, nodes: { ...doc.nodes, [textId]: { kind: 'text', id: textId, text } } };
  }
  const newId = createId();
  return {
    ...doc,
    nodes: { ...doc.nodes, [newId]: { kind: 'text', id: newId, text }, [id]: { ...el, children: [newId, ...el.children] } },
  };
}

export function setName(doc: DesignDocument, id: NodeId, name: string | null): DesignDocument {
  const names = { ...doc.names };
  if (name?.trim()) names[id] = name.trim();
  else delete names[id];
  return { ...doc, names };
}

export function setTitle(doc: DesignDocument, title: string): DesignDocument {
  return doc.title === title ? doc : { ...doc, title };
}

/** Rewrite a <select>'s <option> children from a list of labels, reusing existing option nodes. */
export function setSelectOptions(doc: DesignDocument, selectId: NodeId, labels: readonly string[]): DesignDocument {
  const select = getElement(doc, selectId);
  if (!select) return doc;
  const existing = select.children.filter((c) => getElement(doc, c)?.tag === 'option');
  let next = doc;
  const children: NodeId[] = [];
  labels.forEach((label, i) => {
    let optionId = existing[i];
    if (!optionId) {
      optionId = createId();
      next = { ...next, nodes: { ...next.nodes, [optionId]: { kind: 'element', id: optionId, tag: 'option', attrs: {}, classes: [], children: [] } } };
    }
    next = setText(next, optionId, label);
    children.push(optionId);
  });
  const stale = existing.slice(labels.length);
  next = updateElement(next, selectId, (el) => ({ ...el, children }));
  const nodes: MutableNodes = { ...next.nodes };
  for (const id of stale) for (const nid of subtreeIds(doc, id)) delete nodes[nid];
  return { ...next, nodes };
}

// ---------------------------------------------------------------------------------------------
// Styles

export function setDeclaration(doc: DesignDocument, className: string, prop: string, value: string | null): DesignDocument {
  const current = doc.styles.rules[className] ?? {};
  if (value === null || value === '') {
    if (!(prop in current)) return doc;
    const decls = { ...current };
    delete decls[prop];
    return withRule(doc, className, decls);
  }
  if (current[prop] === value) return doc;
  return withRule(doc, className, { ...current, [prop]: value });
}

function withRule(doc: DesignDocument, className: string, decls: Declarations): DesignDocument {
  return { ...doc, styles: { ...doc.styles, rules: { ...doc.styles.rules, [className]: decls } } };
}

/** Make sure an element has a primary class (creating one named after `base`). */
export function ensurePrimaryClass(doc: DesignDocument, id: NodeId, base: string): { doc: DesignDocument; className: string } {
  const el = getElement(doc, id);
  if (!el) return { doc, className: '' };
  const existing = el.classes[0];
  if (existing) {
    return { doc: existing in doc.styles.rules ? doc : withRule(doc, existing, {}), className: existing };
  }
  const className = uniqueClassName(takenClassNames(doc), base);
  const next = updateElement(withRule(doc, className, {}), id, (e) => ({ ...e, classes: [className] }));
  return { doc: next, className };
}

/** Set a property on each element's primary class (shared classes are only written once). */
export function setStyleOnNodes(doc: DesignDocument, ids: readonly NodeId[], prop: string, value: string | null): DesignDocument {
  let next = doc;
  const done = new Set<string>();
  for (const id of ids) {
    const el = getElement(next, id);
    if (!el) continue;
    if (!el.classes[0] && (value === null || value === '')) continue;
    const ensured = ensurePrimaryClass(next, id, el.tag);
    next = ensured.doc;
    if (done.has(ensured.className)) continue;
    done.add(ensured.className);
    next = setDeclaration(next, ensured.className, prop, value);
  }
  return next;
}

/** Rename a class everywhere (rule and every element using it), keeping rule order. */
export function renameClass(doc: DesignDocument, from: string, to: string): DesignDocument {
  if (from === to || takenClassNames(doc).has(to)) return doc;
  const rules: Record<string, Declarations> = {};
  for (const [name, decls] of Object.entries(doc.styles.rules)) rules[name === from ? to : name] = decls;
  const nodes: MutableNodes = { ...doc.nodes };
  for (const id of nodesWithClass(doc, from)) {
    const el = nodes[id] as ElementNode;
    nodes[id] = { ...el, classes: el.classes.map((c) => (c === from ? to : c)) };
  }
  return { ...doc, nodes, styles: { ...doc.styles, rules } };
}

/** Give one element its own copy of a shared primary class. */
export function detachClass(doc: DesignDocument, id: NodeId): DesignDocument {
  const el = getElement(doc, id);
  const shared = el?.classes[0];
  if (!el || !shared) return doc;
  const name = uniqueClassName(takenClassNames(doc), shared);
  const next = withRule(doc, name, { ...doc.styles.rules[shared] });
  return updateElement(next, id, (e) => ({ ...e, classes: [name, ...e.classes.slice(1)] }));
}

// ---------------------------------------------------------------------------------------------
// Canvas

export function setFrame(doc: DesignDocument, id: NodeId, point: Point): DesignDocument {
  const prev = doc.frames[id];
  if (prev && prev.x === point.x && prev.y === point.y) return doc;
  return { ...doc, frames: { ...doc.frames, [id]: { x: Math.round(point.x), y: Math.round(point.y) } } };
}

// ---------------------------------------------------------------------------------------------
// Composite edits

const POSITION_PROPS = ['position', 'left', 'top', 'right', 'bottom', 'inset', 'z-index'];

export interface WrapOptions {
  readonly direction: 'row' | 'column';
  readonly gap: number;
  /** Where to place the new container if the wrapped elements were absolutely positioned. */
  readonly placement: Point | null;
}

/**
 * Wrap siblings in a flex container ("add auto layout"). `ids` must be in their intended
 * visual order. Wrapped elements lose free positioning and flow inside the container.
 */
export function wrapInStack(doc: DesignDocument, ids: readonly NodeId[], options: WrapOptions): { doc: DesignDocument; id: NodeId | null } {
  const first = ids[0];
  if (!first) return { doc, id: null };
  const parentId = getParentId(doc, first);
  const parent = getElement(doc, parentId);
  if (!parent) return { doc, id: null };
  const siblings = ids.filter((id) => parent.children.includes(id));
  const index = Math.min(...siblings.map((id) => parent.children.indexOf(id)));

  const className = uniqueClassName(takenClassNames(doc), 'stack');
  const style: Record<string, string> = { display: 'flex', 'flex-direction': options.direction, gap: `${options.gap}px` };
  if (options.placement) {
    Object.assign(style, { position: 'absolute', left: `${Math.round(options.placement.x)}px`, top: `${Math.round(options.placement.y)}px` });
  }
  const id = createId();
  let next: DesignDocument = withRule(doc, className, style);
  next = { ...next, nodes: { ...next.nodes, [id]: { kind: 'element', id, tag: 'div', attrs: {}, classes: [className], children: [] } } };
  next = insertChild(next, parentId, index, id);

  siblings.forEach((childId, i) => {
    next = stripPosition(next, childId);
    next = moveNode(next, childId, id, i);
  });
  return { doc: next, id };
}

/** Remove free-positioning declarations from an element's own (unshared) class. */
export function stripPosition(doc: DesignDocument, id: NodeId): DesignDocument {
  const cls = getElement(doc, id)?.classes[0];
  if (!cls || nodesWithClass(doc, cls).length > 1) return doc;
  return POSITION_PROPS.reduce((d, prop) => setDeclaration(d, cls, prop, null), doc);
}

/**
 * Deep-copy nodes and insert each copy after its original. Classes used only inside the copied
 * subtree are copied too (so the duplicate is independent); classes shared with other elements
 * stay shared (duplicating a table row keeps sharing the cell class).
 */
export function duplicateNodes(doc: DesignDocument, ids: readonly NodeId[]): { doc: DesignDocument; ids: NodeId[] } {
  let next = doc;
  const created: NodeId[] = [];
  for (const sourceId of ids) {
    const subtree = new Set(subtreeIds(next, sourceId));
    const taken = takenClassNames(next);
    const classMap = new Map<string, string>();
    const rules: Record<string, Declarations> = { ...next.styles.rules };
    const nodes: MutableNodes = { ...next.nodes };

    const mapClass = (cls: string): string => {
      const users = nodesWithClass(next, cls);
      if (users.some((u) => !subtree.has(u))) return cls;
      let mapped = classMap.get(cls);
      if (!mapped) {
        mapped = uniqueClassName(taken, cls);
        taken.add(mapped);
        classMap.set(cls, mapped);
        rules[mapped] = { ...next.styles.rules[cls] };
      }
      return mapped;
    };

    const clone = (id: NodeId): NodeId => {
      const node = next.nodes[id];
      const newId = createId();
      if (!node) return newId;
      nodes[newId] =
        node.kind === 'text'
          ? { ...node, id: newId }
          : { ...node, id: newId, classes: node.classes.map(mapClass), children: node.children.map(clone) };
      return newId;
    };

    const copyId = clone(sourceId);
    next = { ...next, nodes, styles: { ...next.styles, rules } };
    if (isRoot(next, sourceId)) {
      next = insertChild(next, null, next.roots.indexOf(sourceId) + 1, copyId);
      const frame = next.frames[sourceId] ?? { x: 0, y: 0 };
      next = setFrame(next, copyId, { x: frame.x + 40, y: frame.y + 40 });
    } else {
      const parentId = getParentId(next, sourceId);
      const parent = getElement(next, parentId);
      if (!parent) continue;
      next = insertChild(next, parentId, parent.children.indexOf(sourceId) + 1, copyId);
      next = nudgeIfAbsolute(next, copyId, 16);
    }
    created.push(copyId);
  }
  return { doc: next, ids: created };
}

function nudgeIfAbsolute(doc: DesignDocument, id: NodeId, by: number): DesignDocument {
  const cls = getElement(doc, id)?.classes[0];
  const rule = cls ? doc.styles.rules[cls] : undefined;
  if (!cls || !rule || rule.position !== 'absolute') return doc;
  let next = doc;
  for (const prop of ['left', 'top'] as const) {
    const value = parseFloat(rule[prop] ?? '');
    if (Number.isFinite(value)) next = setDeclaration(next, cls, prop, `${value + by}px`);
  }
  return next;
}
