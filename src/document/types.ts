/**
 * The design document: what an interface *is* (elements), how it looks (class rules),
 * and where its artboards sit on the canvas.
 *
 * Everything here is plain, immutable data. Nothing in this folder imports React or the
 * editor; it can be used by a CLI, an MCP server, or an importer just as well.
 */

export type NodeId = string;

export interface ElementNode {
  readonly kind: 'element';
  readonly id: NodeId;
  /** Lowercase HTML tag (case preserved inside SVG). This is the element's semantic identity. */
  readonly tag: string;
  /** HTML attributes except `class` and the editor id. Boolean attributes are present with "". */
  readonly attrs: Readonly<Record<string, string>>;
  /** CSS classes in order. The first one is the "primary" class that the inspector edits. */
  readonly classes: readonly string[];
  readonly children: readonly NodeId[];
}

export interface TextNode {
  readonly kind: 'text';
  readonly id: NodeId;
  readonly text: string;
}

export type DocNode = ElementNode | TextNode;

/** CSS declarations keyed by property name (kebab-case), in authoring order. */
export type Declarations = Readonly<Record<string, string>>;

export interface StyleSheet {
  /** Single-class rules (`.name { … }`): the part of styles.css the inspector edits. */
  readonly rules: Readonly<Record<string, Declarations>>;
  /** Everything else in styles.css (at-rules, complex selectors), kept verbatim. */
  readonly preserved: string;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface DesignDocument {
  readonly title: string;
  readonly nodes: Readonly<Record<NodeId, DocNode>>;
  /** Children of <body>. Each one is shown as an artboard on the canvas. */
  readonly roots: readonly NodeId[];
  readonly styles: StyleSheet;
  /** Canvas position of each root, in world coordinates. Editor metadata (project.json). */
  readonly frames: Readonly<Record<NodeId, Point>>;
  /** User-given layer names. Editor metadata (project.json). */
  readonly names: Readonly<Record<NodeId, string>>;
}
