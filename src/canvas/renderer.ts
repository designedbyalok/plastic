/**
 * Keyed reconciler from document nodes to real DOM nodes.
 *
 * It creates exactly the elements, attributes and classes that the saved index.html contains,
 * so what you see on the canvas is the browser rendering the actual design, not a copy of it.
 * Immutable updates mean an unchanged node object needs no attribute patching.
 */
import { ID_ATTR, SVG_NS, childLayout, isUnsafeAttribute } from '../document/markup';
import type { DesignDocument, DocNode, ElementNode, NodeId } from '../document/types';
import { registerElement, unregisterElement } from './dom';

export class DomRenderer {
  private readonly dom = new Map<NodeId, Node>();
  private readonly rendered = new Map<NodeId, DocNode>();
  /** Whitespace between block-formatted children, mirroring the serializer's line breaks. */
  private readonly spacers = new Map<NodeId, Text[]>();
  private root: Node | null = null;

  constructor(private readonly mount: ShadowRoot) {}

  render(doc: DesignDocument, rootId: NodeId): void {
    const seen = new Set<NodeId>();
    const root = this.sync(doc, rootId, false, seen);
    if (root !== this.root) {
      this.root?.parentNode?.removeChild(this.root);
      if (root) this.mount.appendChild(root);
      this.root = root;
    }
    for (const [id, node] of this.dom) {
      if (seen.has(id)) continue;
      if (node instanceof Element) unregisterElement(id, node);
      this.dom.delete(id);
      this.rendered.delete(id);
      this.spacers.delete(id);
    }
  }

  /** Forget cached state so the next render re-patches every node. */
  invalidate(): void {
    this.rendered.clear();
  }

  dispose(): void {
    this.root?.parentNode?.removeChild(this.root);
    for (const [id, node] of this.dom) if (node instanceof Element) unregisterElement(id, node);
    this.dom.clear();
    this.rendered.clear();
    this.spacers.clear();
    this.root = null;
  }

  private sync(doc: DesignDocument, id: NodeId, inSvg: boolean, seen: Set<NodeId>): Node | null {
    const node = doc.nodes[id];
    if (!node) return null;
    seen.add(id);

    let dom = this.dom.get(id);
    let prev = this.rendered.get(id);
    const reusable =
      dom && (node.kind === 'text' ? dom.nodeType === 3 : dom instanceof Element && (dom as Element).localName === node.tag);
    if (!dom || !reusable) {
      if (dom instanceof Element) unregisterElement(id, dom);
      dom = this.create(node, inSvg);
      prev = undefined;
      this.dom.set(id, dom);
    }

    if (node.kind === 'text') {
      const text = dom as Text;
      if (text.data !== node.text) text.data = node.text;
    } else {
      const el = dom as Element;
      if (prev !== node) this.patch(el, prev?.kind === 'element' ? prev : undefined, node);
      const childSvg = inSvg || node.tag === 'svg';
      const block = childLayout(doc, node) === 'block';
      const kids: Node[] = [];
      node.children.forEach((childId, i) => {
        if (block && i > 0) kids.push(this.spacer(id, i - 1));
        const child = this.sync(doc, childId, childSvg, seen);
        if (child) kids.push(child);
      });
      reconcileChildren(el, kids);
      registerElement(id, el);
    }
    this.rendered.set(id, node);
    return dom;
  }

  private create(node: DocNode, inSvg: boolean): Node {
    if (node.kind === 'text') return document.createTextNode(node.text);
    let el: Element;
    try {
      el = inSvg || node.tag === 'svg' ? document.createElementNS(SVG_NS, node.tag) : document.createElement(node.tag);
    } catch {
      el = document.createElement('div');
    }
    el.setAttribute(ID_ATTR, node.id);
    return el;
  }

  private patch(el: Element, prev: ElementNode | undefined, next: ElementNode): void {
    if (prev?.attrs !== next.attrs) {
      const old = prev?.attrs ?? {};
      for (const name of Object.keys(old)) if (!(name in next.attrs)) el.removeAttribute(name);
      for (const [name, value] of Object.entries(next.attrs)) {
        if (prev && old[name] === value) continue;
        if (isUnsafeAttribute(name, value)) continue;
        try {
          el.setAttribute(name, value);
        } catch {
          // invalid attribute name from imported markup: keep it in the document, skip on canvas
        }
      }
      syncFormState(el);
    }
    if (prev?.classes !== next.classes) {
      if (next.classes.length) el.setAttribute('class', next.classes.join(' '));
      else el.removeAttribute('class');
    }
  }

  private spacer(parentId: NodeId, index: number): Text {
    let list = this.spacers.get(parentId);
    if (!list) this.spacers.set(parentId, (list = []));
    return (list[index] ??= document.createTextNode(' '));
  }
}

/** Make `parent.childNodes` equal `kids`, moving existing nodes rather than recreating them. */
function reconcileChildren(parent: Element, kids: readonly Node[]): void {
  kids.forEach((kid, i) => {
    const current = parent.childNodes[i];
    if (current !== kid) parent.insertBefore(kid, current ?? null);
  });
  while (parent.childNodes.length > kids.length) parent.removeChild(parent.lastChild!);
}

/** Live form state follows the attributes, since nobody types into the design while editing it. */
function syncFormState(el: Element): void {
  if (el instanceof HTMLInputElement) {
    el.checked = el.hasAttribute('checked');
    if (el.type !== 'file') el.value = el.getAttribute('value') ?? '';
  }
}
