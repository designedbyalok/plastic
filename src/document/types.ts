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
  /**
   * Everything else in styles.css (at-rules, complex selectors), kept verbatim and on the same
   * side of the class rules as in the file, because cascade order matters: `:root` variables
   * usually come first, `@media` overrides must come after the rules they override.
   */
  readonly preserved: string;
  readonly preservedAfter: string;
}

/**
 * Design tokens: CSS custom properties declared on `:root` in tokens.css, keyed by name without
 * the leading "--" (e.g. "color-primary"). The prefix decides the token's kind, following the
 * Tailwind v4 theme namespaces: color-, spacing-, radius-, font-, text-, font-weight-, leading-,
 * tracking-, opacity-, shadow-.
 */
export interface TokenSheet {
  readonly values: Readonly<Record<string, string>>;
  /** Everything else in tokens.css (e.g. a dark-mode override block), kept verbatim. */
  readonly preserved: string;
}

/** A page is one HTML file of the project. Its file name is its stable id. */
export interface Page {
  readonly file: string;
  /** Display name (editor metadata, project.json). */
  readonly name: string;
  /** Children of this page's <body>; each is shown as an artboard on the page's canvas. */
  readonly roots: readonly NodeId[];
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface DesignDocument {
  readonly title: string;
  /** All nodes of all pages. Ids are unique across the project. */
  readonly nodes: Readonly<Record<NodeId, DocNode>>;
  /** Pages in order. Always at least one. */
  readonly pages: readonly Page[];
  /** styles.css, shared by every page. */
  readonly styles: StyleSheet;
  /** tokens.css, shared by every page and loaded before styles.css. */
  readonly tokens: TokenSheet;
  /** Canvas position of each root, in world coordinates. Editor metadata (project.json). */
  readonly frames: Readonly<Record<NodeId, Point>>;
  /** User-given layer names. Editor metadata (project.json). */
  readonly names: Readonly<Record<NodeId, string>>;
}
