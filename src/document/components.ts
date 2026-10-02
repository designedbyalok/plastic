/** Linked HTML subtrees. CSS stays shared; existing diff3 reconciliation preserves overrides. */
import { mergeFiles } from '../editor/merge.ts';
import { parseHTML, serializeNode } from '../serialization/html.ts';
import { createId } from './ids.ts';
import { insertChild, insertRoot, setFrame } from './ops.ts';
import { ancestorIds, getElement, getParentId, pageOf, subtreeIds } from './tree.ts';
import type { ComponentLibrary, DesignDocument, DocNode, NodeId } from './types.ts';

const EMPTY: ComponentLibrary = { definitions: {}, instances: {} };
const markupCache = new WeakMap<object, Map<NodeId, string>>();
function contextMarkup(doc: DesignDocument, id: NodeId, html: string): string {
  const tag = getElement(doc, id)?.tag ?? '';
  const tableContexts: Record<string, string[]> = {
    tr: ['table', 'tbody'],
    td: ['table', 'tbody', 'tr'],
    th: ['table', 'tbody', 'tr'],
    tbody: ['table'],
    thead: ['table'],
    tfoot: ['table'],
    caption: ['table'],
    colgroup: ['table'],
    col: ['table', 'colgroup'],
  };
  const wrappers =
    tableContexts[tag] ??
    (tag !== 'svg' && ancestorIds(doc, id).some((key) => getElement(doc, key)?.tag === 'svg') ? ['svg'] : []);
  for (const wrapper of [...wrappers].reverse()) html = `<${wrapper}>${html}</${wrapper}>`;
  return html;
}
function markup(doc: DesignDocument, id: NodeId): string {
  let cache = markupCache.get(doc.nodes);
  if (!cache) markupCache.set(doc.nodes, (cache = new Map()));
  let html = cache.get(id);
  if (html === undefined) cache.set(id, (html = contextMarkup(doc, id, serializeNode(doc, id))));
  return html;
}

export function componentOwner(doc: DesignDocument, id: NodeId): NodeId | null {
  const library = doc.components ?? EMPTY;
  return [id, ...ancestorIds(doc, id)].find((key) => library.definitions[key] || library.instances[key]) ?? null;
}

export function canDefineComponent(doc: DesignDocument, id: NodeId): boolean {
  if (!getElement(doc, id) || !pageOf(doc, id) || componentOwner(doc, id)) return false;
  const library = doc.components ?? EMPTY;
  return !subtreeIds(doc, id).some((key) => library.definitions[key] || library.instances[key]);
}

export function defineComponent(doc: DesignDocument, id: NodeId, name: string): DesignDocument {
  if (!canDefineComponent(doc, id) || !name.trim()) return doc;
  const library = doc.components ?? EMPTY;
  return { ...doc, components: { ...library, definitions: { ...library.definitions, [id]: name.trim() } } };
}

export function renameComponent(doc: DesignDocument, id: NodeId, name: string): DesignDocument {
  if (!doc.components?.definitions[id] || !name.trim()) return doc;
  return {
    ...doc,
    components: { ...doc.components, definitions: { ...doc.components.definitions, [id]: name.trim() } },
  };
}

/** Insert beside the selection, or as an artboard of the requested page. */
export function instantiateComponent(
  doc: DesignDocument,
  source: NodeId,
  pageFile: string,
  beside?: NodeId,
): { doc: DesignDocument; id: NodeId | null } {
  if (!doc.components?.definitions[source] || !getElement(doc, source) || !doc.pages.some((p) => p.file === pageFile))
    return { doc, id: null };
  const parent = beside ? getParentId(doc, beside) : null;
  if (parent && componentOwner(doc, parent)) return { doc, id: null };
  const nodes: Record<NodeId, DocNode> = { ...doc.nodes };
  const elements: Record<NodeId, NodeId> = {};
  const names = { ...doc.names };
  const clone = (key: NodeId): NodeId => {
    const node = doc.nodes[key]!;
    const id = createId();
    if (doc.names[key]) names[id] = doc.names[key]!;
    if (node.kind === 'element') {
      elements[key] = id;
      nodes[id] = { ...node, id, children: node.children.map(clone) };
    } else nodes[id] = { ...node, id };
    return id;
  };
  const id = clone(source);
  let next: DesignDocument = {
    ...doc,
    nodes,
    names,
    components: {
      ...doc.components,
      instances: { ...doc.components.instances, [id]: { source, elements, baseline: markup(doc, source) } },
    },
  };
  if (parent) {
    const children = getElement(doc, parent)!.children;
    next = insertChild(next, parent, children.indexOf(beside!) + 1, id);
  } else {
    const page = doc.pages.find((p) => p.file === pageFile)!;
    next = insertRoot(next, pageFile, beside ? page.roots.indexOf(beside) + 1 : page.roots.length, id);
    const frame = doc.frames[beside ?? source] ?? { x: 0, y: 0 };
    next = setFrame(next, id, { x: frame.x + 40, y: frame.y + 40 });
  }
  return { doc: next, id };
}

/** Remove a link without changing rendered nodes, CSS, or layout. */
export function detachComponent(doc: DesignDocument, root: NodeId): DesignDocument {
  if (!doc.components) return doc;
  const definitions = { ...doc.components.definitions };
  const instances = { ...doc.components.instances };
  delete definitions[root];
  delete instances[root];
  for (const [id, link] of Object.entries(instances)) if (link.source === root) delete instances[id];
  return { ...doc, components: { definitions, instances } };
}

/** Normalize instance ids to main identities for the existing semantic HTML merge. */
function normalizedInstance(doc: DesignDocument, root: NodeId, elements: Readonly<Record<NodeId, NodeId>>): string {
  const reverse = new Map(Object.entries(elements).map(([source, local]) => [local, source]));
  const nodes: Record<NodeId, DocNode> = {};
  for (const id of subtreeIds(doc, root)) {
    const node = doc.nodes[id]!;
    const key = reverse.get(id) ?? id;
    nodes[key] =
      node.kind === 'element'
        ? { ...node, id: key, children: node.children.map((c) => reverse.get(c) ?? c) }
        : { ...node, id: key };
  }
  return contextMarkup(doc, reverse.get(root) ?? root, serializeNode({ ...doc, nodes }, reverse.get(root) ?? root));
}

/** Called after edits and file loads. No links means no work; unchanged main markup skips merges. */
export function synchronizeComponents(doc: DesignDocument, resetRoot?: NodeId): DesignDocument {
  if (!doc.components) return doc;
  let next = doc;
  const definitions = Object.fromEntries(
    Object.entries(doc.components.definitions).filter(([id]) => getElement(doc, id) && pageOf(doc, id)),
  );
  const instances = { ...doc.components.instances };
  let changed = Object.keys(definitions).length !== Object.keys(doc.components.definitions).length;
  for (const [root, link] of Object.entries(instances)) {
    if (!getElement(next, root) || !definitions[link.source] || !pageOf(next, root)) {
      delete instances[root];
      changed = true;
      continue;
    }
    // Imported malformed/nested links must never recursively expand or replace a main.
    const sourceIds = new Set(subtreeIds(next, link.source));
    if (
      sourceIds.has(root) ||
      ancestorIds(next, root).some((id) => definitions[id] || instances[id]) ||
      Object.keys(link.elements).some((id) => sourceIds.has(link.elements[id]!))
    ) {
      delete instances[root];
      changed = true;
      continue;
    }
    const incoming = markup(next, link.source);
    if (incoming === link.baseline && root !== resetRoot) continue;
    const local = root === resetRoot ? link.baseline : normalizedInstance(next, root, link.elements);
    const html = mergeFiles({ 'index.html': link.baseline }, { 'index.html': local }, { 'index.html': incoming })[
      'index.html'
    ]!;
    const parsed = parseHTML(html);
    const mergedRoot = getElement({ ...next, nodes: parsed.nodes }, link.source)?.id;
    // Invalid metadata/markup loses its link, never its visible subtree.
    if (mergedRoot !== link.source) {
      delete instances[root];
      changed = true;
      continue;
    }
    const mergedNodes = subtreeIds({ ...next, nodes: parsed.nodes }, mergedRoot).map((id) => parsed.nodes[id]!);
    const oldIds = new Set(subtreeIds(next, root));
    const nodes: Record<NodeId, DocNode> = { ...next.nodes };
    const elements = { ...link.elements, [link.source]: root };
    const remap = new Map<NodeId, NodeId>();
    for (const node of mergedNodes) {
      if (node.kind !== 'element') continue;
      // Locally inserted elements retain their own ids. New main elements receive fresh ids.
      const known = elements[node.id];
      const localId =
        known && (!next.nodes[known] || oldIds.has(known)) ? known : oldIds.has(node.id) ? node.id : createId();
      remap.set(node.id, localId);
      if (sourceIds.has(node.id)) elements[node.id] = localId;
    }
    // Preserve text node identities when their parent/ordinal survives (including after reload).
    for (const node of mergedNodes) {
      if (node.kind !== 'element') continue;
      const old = getElement(next, remap.get(node.id));
      const texts = old?.children.filter((id) => next.nodes[id]?.kind === 'text') ?? [];
      let ordinal = 0;
      for (const id of node.children)
        if (parsed.nodes[id]?.kind === 'text') remap.set(id, texts[ordinal++] ?? createId());
    }
    for (const id of oldIds) delete nodes[id];
    for (const node of mergedNodes) {
      const id = remap.get(node.id) ?? createId();
      nodes[id] =
        node.kind === 'element' ? { ...node, id, children: node.children.map((c) => remap.get(c)!) } : { ...node, id };
    }
    const names = Object.fromEntries(Object.entries(next.names).filter(([id]) => nodes[id]));
    for (const [source, id] of Object.entries(elements))
      if (nodes[id] && !names[id] && next.names[source]) names[id] = next.names[source]!;
    instances[root] = { ...link, elements, baseline: incoming };
    next = { ...next, nodes, names };
    changed = true;
  }
  return changed ? { ...next, components: { definitions, instances } } : doc;
}
