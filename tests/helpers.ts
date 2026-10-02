import { emptyDocument, instantiate, type NodeSpec } from '../src/document/factory';
import { insertChild, setFrame } from '../src/document/ops';
import { getElement } from '../src/document/tree';
import type { DesignDocument, ElementNode, NodeId } from '../src/document/types';

/** Build a document with one root from a spec. */
export function docFrom(spec: NodeSpec): { doc: DesignDocument; root: NodeId } {
  const made = instantiate(emptyDocument('Test'), spec);
  return { doc: setFrame(insertChild(made.doc, null, 0, made.id), made.id, { x: 0, y: 0 }), root: made.id };
}

export function el(doc: DesignDocument, id: NodeId | undefined): ElementNode {
  const node = getElement(doc, id);
  if (!node) throw new Error(`no element ${id}`);
  return node;
}

/** Structure without ids, for comparing documents across a round trip. */
export function shape(doc: DesignDocument, id: NodeId): unknown {
  const node = doc.nodes[id];
  if (!node) return null;
  if (node.kind === 'text') return node.text;
  return { tag: node.tag, attrs: node.attrs, classes: node.classes, children: node.children.map((c) => shape(doc, c)) };
}
