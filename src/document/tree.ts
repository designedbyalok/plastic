import type { DesignDocument, ElementNode, NodeId, Page, TextNode } from './types';

const parentCache = new WeakMap<object, Map<NodeId, NodeId>>();

/** Child → parent lookup, derived lazily and cached per `nodes` object. */
export function parentMap(doc: DesignDocument): ReadonlyMap<NodeId, NodeId> {
  let map = parentCache.get(doc.nodes);
  if (!map) {
    map = new Map();
    for (const node of Object.values(doc.nodes)) {
      if (node.kind === 'element') for (const child of node.children) map.set(child, node.id);
    }
    parentCache.set(doc.nodes, map);
  }
  return map;
}

export function getParentId(doc: DesignDocument, id: NodeId): NodeId | null {
  return parentMap(doc).get(id) ?? null;
}

export function getElement(doc: DesignDocument, id: NodeId | null | undefined): ElementNode | undefined {
  if (!id) return undefined;
  const node = doc.nodes[id];
  return node?.kind === 'element' ? node : undefined;
}

/** Nearest ancestor first. */
export function ancestorIds(doc: DesignDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  for (let p = getParentId(doc, id); p; p = getParentId(doc, p)) out.push(p);
  return out;
}

export function isAncestorOf(doc: DesignDocument, ancestor: NodeId, id: NodeId): boolean {
  return ancestorIds(doc, id).includes(ancestor);
}

/** The node and all of its descendants, depth first. */
export function subtreeIds(doc: DesignDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const visit = (nid: NodeId) => {
    out.push(nid);
    const node = doc.nodes[nid];
    if (node?.kind === 'element') node.children.forEach(visit);
  };
  visit(id);
  return out;
}

export function isRoot(doc: DesignDocument, id: NodeId): boolean {
  return doc.pages.some((p) => p.roots.includes(id));
}

/** Root ids of every page. */
export function allRoots(doc: DesignDocument): NodeId[] {
  return doc.pages.flatMap((p) => p.roots);
}

export function getPage(doc: DesignDocument, file: string | null | undefined): Page | undefined {
  return doc.pages.find((p) => p.file === file);
}

/** The page a node lives on. */
export function pageOf(doc: DesignDocument, id: NodeId): Page | undefined {
  const root = rootOf(doc, id);
  return doc.pages.find((p) => p.roots.includes(root));
}

export function rootOf(doc: DesignDocument, id: NodeId): NodeId {
  const chain = ancestorIds(doc, id);
  return chain[chain.length - 1] ?? id;
}

export function elementChildren(doc: DesignDocument, el: ElementNode): ElementNode[] {
  return el.children.map((c) => doc.nodes[c]).filter((n): n is ElementNode => n?.kind === 'element');
}

export function textChildren(doc: DesignDocument, el: ElementNode): TextNode[] {
  return el.children.map((c) => doc.nodes[c]).filter((n): n is TextNode => n?.kind === 'text');
}

export function hasOnlyTextChildren(doc: DesignDocument, el: ElementNode): boolean {
  return el.children.every((c) => doc.nodes[c]?.kind === 'text');
}

export function textContent(doc: DesignDocument, id: NodeId): string {
  const node = doc.nodes[id];
  if (!node) return '';
  if (node.kind === 'text') return node.text;
  return node.children.map((c) => textContent(doc, c)).join('');
}

/** Elements that carry this class. */
export function nodesWithClass(doc: DesignDocument, className: string): NodeId[] {
  return Object.values(doc.nodes)
    .filter((n): n is ElementNode => n.kind === 'element' && n.classes.includes(className))
    .map((n) => n.id);
}

/** Drop ids whose ancestor is also in the list (so a gesture never moves a node twice). */
export function topmostIds(doc: DesignDocument, ids: readonly NodeId[]): NodeId[] {
  const set = new Set(ids);
  return ids.filter((id) => doc.nodes[id] && !ancestorIds(doc, id).some((a) => set.has(a)));
}

/** The element itself or its nearest ancestor that satisfies the predicate. */
export function closestElement(
  doc: DesignDocument,
  id: NodeId,
  predicate: (el: ElementNode) => boolean,
): ElementNode | undefined {
  for (const nid of [id, ...ancestorIds(doc, id)]) {
    const el = getElement(doc, nid);
    if (el && predicate(el)) return el;
  }
  return undefined;
}
