import { slugifyClassName } from './css.ts';
import { createId } from './ids.ts';
import type { Declarations, DesignDocument, DocNode, NodeId } from './types.ts';
import { EMPTY_SHEET } from './css.ts';

/**
 * A declarative description of markup to create, used by insert templates and importers.
 * Strings are text nodes.
 */
export interface NodeSpec {
  readonly tag: string;
  readonly attrs?: Readonly<Record<string, string>>;
  /**
   * Class name to create (made unique in the document). Repeating the same base within one
   * spec tree reuses one class, e.g. every table cell sharing `.data-table-td`.
   */
  readonly className?: string;
  /** Declarations for the class rule, taken from the first occurrence of `className`. */
  readonly style?: Declarations;
  readonly children?: readonly (NodeSpec | string)[];
}

export const FIRST_PAGE_FILE = 'index.html';

export function emptyDocument(title = 'Untitled'): DesignDocument {
  return {
    title,
    nodes: {},
    pages: [{ file: FIRST_PAGE_FILE, name: 'Page 1', roots: [] }],
    styles: EMPTY_SHEET,
    tokens: { values: {}, preserved: '' },
    frames: {},
    names: {},
  };
}

export function takenClassNames(doc: DesignDocument): Set<string> {
  const taken = new Set(Object.keys(doc.styles.rules));
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'element') for (const c of node.classes) taken.add(c);
  }
  return taken;
}

export function uniqueClassName(taken: ReadonlySet<string>, base: string): string {
  const name = slugifyClassName(base);
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}-${n}`)) n++;
  return `${name}-${n}`;
}

/** Add the nodes and class rules described by `spec`. The new subtree is not yet attached. */
export function instantiate(doc: DesignDocument, spec: NodeSpec): { doc: DesignDocument; id: NodeId } {
  const nodes: Record<NodeId, DocNode> = { ...doc.nodes };
  const rules: Record<string, Declarations> = { ...doc.styles.rules };
  const taken = takenClassNames(doc);
  const classFor = new Map<string, string>();

  const build = (s: NodeSpec | string): NodeId => {
    const id = createId();
    if (typeof s === 'string') {
      nodes[id] = { kind: 'text', id, text: s };
      return id;
    }
    const classes: string[] = [];
    if (s.className) {
      let name = classFor.get(s.className);
      if (!name) {
        name = uniqueClassName(taken, s.className);
        taken.add(name);
        classFor.set(s.className, name);
        rules[name] = { ...s.style };
      }
      classes.push(name);
    }
    const children = (s.children ?? []).map(build);
    nodes[id] = { kind: 'element', id, tag: s.tag, attrs: { ...s.attrs }, classes, children };
    return id;
  };

  const id = build(spec);
  return { doc: { ...doc, nodes, styles: { ...doc.styles, rules } }, id };
}

/** Return a copy of the spec with extra declarations merged into its root class. */
export function withRootStyle(spec: NodeSpec, extra: Declarations): NodeSpec {
  return { ...spec, className: spec.className ?? spec.tag, style: { ...spec.style, ...extra } };
}
