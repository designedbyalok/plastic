/**
 * The design API agents use. Every call reads the project from disk, applies Plastic's own pure
 * document operations (the same ones the editor uses), and writes the files back. The dev server
 * watches those files, so an open editor shows agent edits live, as one undoable change each.
 */
import { parseStyleSheet } from '../../src/document/css.ts';
import { emptyDocument, instantiate } from '../../src/document/factory.ts';
import { ID_ATTR } from '../../src/document/markup.ts';
import { insertChild, insertRoot, moveNode, removeNodes, setAttribute, setFrame, setStyleOnNodes, setTag, setText, setTitle } from '../../src/document/ops.ts';
import { addPage, removePage, renamePage } from '../../src/document/pages.ts';
import { removeToken, renameToken, setToken, tokenKind } from '../../src/document/tokens.ts';
import { getElement, getParentId, pageOf, subtreeIds, textContent } from '../../src/document/tree.ts';
import type { Declarations, DesignDocument, DocNode, NodeId, Page } from '../../src/document/types.ts';
import { frameSpec, starterDocument } from '../../src/elements/insertables.ts';
import { layerName, kindLabel } from '../../src/elements/registry.ts';
import { parseProject, serializeProject, type EditorMeta } from '../../src/serialization/index.ts';
import { parseHTML, serializeNode } from '../../src/serialization/html.ts';
import { serializeStyleSheet, serializeTokenSheet } from '../../src/document/css.ts';
import type { ProjectStore } from '../projectStore.ts';
import { ensureDom } from './dom.ts';

export class DesignError extends Error {}

interface Open {
  doc: DesignDocument;
  meta: EditorMeta;
}

export class DesignApi {
  constructor(private readonly store: ProjectStore) {
    ensureDom();
  }

  private async open(file: string): Promise<Open> {
    const files = await this.store.read(file);
    if (!files) throw new DesignError(`No file "${file}". Use list_files to see what exists.`);
    return parseProject(files);
  }

  /** Open, edit, save. */
  private async edit<T>(file: string, fn: (doc: DesignDocument) => { doc: DesignDocument; result: T }): Promise<T> {
    let result!: T;
    await this.store.edit(file, (files) => {
      const opened = parseProject(files);
      const edited = fn(opened.doc);
      result = edited.result;
      return serializeProject(edited.doc, opened.meta);
    });
    return result;
  }

  private page(doc: DesignDocument, page?: string): Page {
    const found = page ? doc.pages.find((p) => p.file === page || p.name === page) : doc.pages[0];
    if (!found) throw new DesignError(`No page "${page}". Pages: ${doc.pages.map((p) => `${p.name} (${p.file})`).join(', ')}`);
    return found;
  }

  private element(doc: DesignDocument, id: string) {
    const el = getElement(doc, id);
    if (!el) throw new DesignError(`No element with id "${id}". Ids are the data-pl-id attributes; use get_page to see them.`);
    return el;
  }

  // --- files ---------------------------------------------------------------------------------

  async listFiles() {
    const projects = await this.store.list();
    return projects.map((p) => {
      const { doc } = parseProject(p.files);
      return {
        file: p.id,
        title: doc.title,
        pages: doc.pages.map((pg) => ({ page: pg.file, name: pg.name, artboards: pg.roots.length })),
        tokens: Object.keys(doc.tokens.values).length,
        updatedAt: new Date(p.updatedAt).toISOString(),
      };
    });
  }

  async createFile(title: string, withFrame: boolean) {
    const id = await this.store.uniqueId(title);
    const doc = setTitle(withFrame ? starterDocument() : emptyDocument(title), title);
    await this.store.write(id, serializeProject(doc, { viewport: null, collapsed: [], activePage: null }));
    return { file: id, pages: doc.pages.map((p) => p.file) };
  }

  async getFile(file: string) {
    const { doc } = await this.open(file);
    return {
      file,
      title: doc.title,
      pages: doc.pages.map((p) => ({ page: p.file, name: p.name, artboards: p.roots.map((id) => ({ id, name: layerName(doc, id), x: doc.frames[id]?.x ?? 0, y: doc.frames[id]?.y ?? 0 })) })),
      classes: Object.keys(doc.styles.rules),
      tokens: doc.tokens.values,
    };
  }

  /** A page: its HTML (ids included), an indented outline, and the shared CSS. */
  async getPage(file: string, page?: string) {
    const { doc } = await this.open(file);
    const pg = this.page(doc, page);
    return {
      page: pg.file,
      name: pg.name,
      outline: pg.roots.map((id) => outline(doc, id, 0)).join('\n'),
      html: pg.roots.map((id) => serializeNode(doc, id, 0)).join('\n'),
      frames: Object.fromEntries(pg.roots.map((id) => [id, doc.frames[id] ?? { x: 0, y: 0 }])),
      css: serializeStyleSheet(doc.styles),
      tokensCss: serializeTokenSheet(doc.tokens),
    };
  }

  async getNode(file: string, id: string) {
    const { doc } = await this.open(file);
    const el = this.element(doc, id);
    return {
      id,
      tag: el.tag,
      kind: kindLabel(el),
      name: layerName(doc, id),
      page: pageOf(doc, id)?.file ?? null,
      parent: getParentId(doc, id),
      attributes: el.attrs,
      classes: el.classes,
      css: Object.fromEntries(el.classes.map((c) => [c, doc.styles.rules[c] ?? {}])),
      text: textContent(doc, id),
      children: el.children.filter((c) => doc.nodes[c]?.kind === 'element'),
      html: serializeNode(doc, id, 0),
    };
  }

  // --- writing designs -----------------------------------------------------------------------

  /**
   * Insert HTML (one or more elements) into an element, or onto a page as new artboards. Class
   * rules in `css` are merged into styles.css; any other CSS (e.g. @media) is appended.
   */
  async writeHtml(file: string, input: { html: string; css?: string; page?: string; parentId?: string; index?: number; x?: number; y?: number }) {
    return this.edit(file, (doc) => {
      let next = mergeCss(doc, input.css);
      const parsed = parseHTML(`<!doctype html><body>${input.html}</body>`, new Set(Object.keys(next.nodes)));
      if (!parsed.roots.length) throw new DesignError('The html contains no elements.');
      next = { ...next, nodes: { ...next.nodes, ...parsed.nodes } };
      if (input.parentId) {
        const parent = this.element(next, input.parentId);
        const at = input.index ?? parent.children.length;
        parsed.roots.forEach((id, i) => (next = insertChild(next, parent.id, at + i, id)));
      } else {
        const pg = this.page(next, input.page);
        let x = input.x ?? nextArtboardX(next, pg);
        parsed.roots.forEach((id, i) => {
          next = insertRoot(next, pg.file, input.index !== undefined ? input.index + i : Number.MAX_SAFE_INTEGER, id);
          next = setFrame(next, id, { x, y: input.y ?? 0 });
          x += 560;
        });
      }
      return { doc: next, result: { created: parsed.roots, outline: parsed.roots.map((id) => outline(next, id, 0)).join('\n') } };
    });
  }

  /** Replace everything on a page with new HTML (and optional CSS). */
  async setPageHtml(file: string, input: { html: string; css?: string; page?: string }) {
    return this.edit(file, (doc) => {
      const pg = this.page(doc, input.page);
      let next = removeNodes(doc, pg.roots);
      next = mergeCss(next, input.css);
      const parsed = parseHTML(`<!doctype html><body>${input.html}</body>`, new Set(Object.keys(next.nodes)));
      next = { ...next, nodes: { ...next.nodes, ...parsed.nodes } };
      let x = 0;
      for (const id of parsed.roots) {
        next = setFrame(insertRoot(next, pg.file, Number.MAX_SAFE_INTEGER, id), id, doc.frames[id] ?? { x, y: 0 });
        x += 560;
      }
      return { doc: next, result: { page: pg.file, artboards: parsed.roots } };
    });
  }

  async addFrame(file: string, input: { page?: string; width?: number; height?: number; x?: number; y?: number }) {
    return this.edit(file, (doc) => {
      const pg = this.page(doc, input.page);
      const made = instantiate(doc, frameSpec(input.width, input.height));
      let next = insertRoot(made.doc, pg.file, Number.MAX_SAFE_INTEGER, made.id);
      next = setFrame(next, made.id, { x: input.x ?? nextArtboardX(doc, pg), y: input.y ?? 0 });
      return { doc: next, result: { id: made.id, className: getElement(next, made.id)?.classes[0] } };
    });
  }

  /** Set (or remove with null) declarations on a class, or on each element's own class. */
  async updateStyles(file: string, input: { className?: string; ids?: string[]; styles: Record<string, string | null> }) {
    return this.edit(file, (doc) => {
      let next = doc;
      if (input.className) {
        const rules: Record<string, Declarations> = { ...next.styles.rules };
        const decls: Record<string, string> = { ...rules[input.className] };
        for (const [prop, value] of Object.entries(input.styles)) {
          if (value === null || value === '') delete decls[prop];
          else decls[prop] = value;
        }
        rules[input.className] = decls;
        next = { ...next, styles: { ...next.styles, rules } };
      } else if (input.ids?.length) {
        input.ids.forEach((id) => this.element(next, id));
        for (const [prop, value] of Object.entries(input.styles)) next = setStyleOnNodes(next, input.ids, prop, value);
      } else {
        throw new DesignError('Pass className or ids.');
      }
      const classes = input.className ? [input.className] : (input.ids ?? []).map((id) => getElement(next, id)?.classes[0]).filter(Boolean);
      return { doc: next, result: { rules: Object.fromEntries(classes.map((c) => [c, next.styles.rules[c!]])) } };
    });
  }

  async setAttributes(file: string, id: string, attributes: Record<string, string | null>, tag?: string) {
    return this.edit(file, (doc) => {
      this.element(doc, id);
      let next = tag ? setTag(doc, id, tag.toLowerCase()) : doc;
      for (const [name, value] of Object.entries(attributes)) next = setAttribute(next, id, name, value);
      return { doc: next, result: { id, tag: getElement(next, id)?.tag, attributes: getElement(next, id)?.attrs } };
    });
  }

  async setText(file: string, id: string, text: string) {
    return this.edit(file, (doc) => {
      this.element(doc, id);
      return { doc: setText(doc, id, text), result: { id, text } };
    });
  }

  async deleteNodes(file: string, ids: string[]) {
    return this.edit(file, (doc) => {
      ids.forEach((id) => this.element(doc, id));
      return { doc: removeNodes(doc, ids), result: { deleted: ids.flatMap((id) => subtreeIds(doc, id)).filter((n) => doc.nodes[n]?.kind === 'element').length } };
    });
  }

  async moveNode(file: string, id: string, parentId: string, index?: number) {
    return this.edit(file, (doc) => {
      this.element(doc, id);
      const parent = this.element(doc, parentId);
      const next = moveNode(doc, id, parentId, index ?? parent.children.length);
      if (next === doc) throw new DesignError('Cannot move an element into itself.');
      return { doc: next, result: { id, parent: parentId } };
    });
  }

  // --- pages ---------------------------------------------------------------------------------

  async createPage(file: string, name: string) {
    return this.edit(file, (doc) => {
      const made = addPage(doc, name);
      return { doc: made.doc, result: { page: made.file, name } };
    });
  }

  async renamePage(file: string, page: string, name: string) {
    return this.edit(file, (doc) => {
      const pg = this.page(doc, page);
      return { doc: renamePage(doc, pg.file, name), result: { page: pg.file, name } };
    });
  }

  async deletePage(file: string, page: string) {
    return this.edit(file, (doc) => {
      const pg = this.page(doc, page);
      if (doc.pages.length <= 1) throw new DesignError('A file needs at least one page.');
      return { doc: removePage(doc, pg.file), result: { deleted: pg.file } };
    });
  }

  // --- tokens --------------------------------------------------------------------------------

  async getTokens(file: string) {
    const { doc } = await this.open(file);
    return {
      tokens: Object.fromEntries(Object.entries(doc.tokens.values).map(([n, v]) => [n, { value: v, kind: tokenKind(n), css: `var(--${n})` }])),
      tokensCss: serializeTokenSheet(doc.tokens),
    };
  }

  /** Create or update tokens (null deletes). Names are without "--", e.g. "color-primary". */
  async setTokens(file: string, tokens: Record<string, string | null>) {
    return this.edit(file, (doc) => {
      let next = doc;
      for (const [rawName, value] of Object.entries(tokens)) {
        const name = rawName.replace(/^--/, '');
        next = value === null ? removeToken(next, name) : setToken(next, name, value);
      }
      return { doc: next, result: { tokens: next.tokens.values } };
    });
  }

  async renameToken(file: string, from: string, to: string) {
    return this.edit(file, (doc) => {
      const next = renameToken(doc, from.replace(/^--/, ''), to.replace(/^--/, ''));
      if (next === doc) throw new DesignError(`Cannot rename "${from}" to "${to}" (missing token, invalid or taken name).`);
      return { doc: next, result: { from, to } };
    });
  }
}

/** Merge class rules from agent CSS; anything that isn't a single-class rule is appended. */
function mergeCss(doc: DesignDocument, css: string | undefined): DesignDocument {
  if (!css?.trim()) return doc;
  return { ...doc, styles: parseStyleSheet(`${serializeStyleSheet(doc.styles)}\n${css}`) };
}

function nextArtboardX(doc: DesignDocument, page: Page): number {
  if (!page.roots.length) return 0;
  const xs = page.roots.map((id) => doc.frames[id]?.x ?? 0);
  // Without layout we can't know widths; leave a generous gap after the right-most artboard.
  const widest = Math.max(...page.roots.map((id) => widthOf(doc, id)));
  return Math.max(...xs) + Math.max(widest, 480) + 80;
}

function widthOf(doc: DesignDocument, id: NodeId): number {
  const cls = getElement(doc, id)?.classes[0];
  const w = cls ? parseFloat(doc.styles.rules[cls]?.width ?? '') : NaN;
  return Number.isFinite(w) ? w : 480;
}

/** Compact, readable tree: `<form.login-form #id> "Sign in"`. */
function outline(doc: DesignDocument, id: NodeId, depth: number): string {
  const node: DocNode | undefined = doc.nodes[id];
  if (!node || node.kind !== 'element') return '';
  // Every attribute (semantics and behavior both matter); long values such as data URLs are cut.
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => (v === '' ? k : `${k}="${v.length > 40 ? `${v.slice(0, 37)}…` : v}"`))
    .join(' ');
  // The element's own text, also when mixed with children (<label>Email<input></label>).
  const text = node.children
    .map((c) => doc.nodes[c])
    .filter((n) => n?.kind === 'text')
    .map((n) => (n as { text: string }).text)
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ');
  const head = `${'  '.repeat(depth)}<${node.tag}${node.classes.map((c) => `.${c}`).join('')}${attrs ? ` ${attrs}` : ''}> ${ID_ATTR}=${id}${text ? ` "${text.length > 60 ? `${text.slice(0, 57)}…` : text}"` : ''}`;
  const children = node.children.map((c) => outline(doc, c, depth + 1)).filter(Boolean);
  return [head, ...children].join('\n');
}

