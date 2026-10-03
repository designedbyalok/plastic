import { synchronizeComponents } from '../document/components.ts';
import { normalizeInterFonts } from '../document/fontNames.ts';
import {
  extractStyleTokens,
  parseStyleSheet,
  parseTokenSheet,
  serializeStyleSheet,
  serializeTokenSheet,
} from '../document/css.ts';
import { FIRST_PAGE_FILE } from '../document/factory.ts';
import type { DesignDocument, NodeId, Page, Point, RulerGuide } from '../document/types.ts';
import { parseHTML, serializeHTML } from './html.ts';
import { PROJECT_FORMAT, PROJECT_VERSION, readProjectJson, type ProjectJson, type ViewportMeta } from './project.ts';

/**
 * The files of a project folder, by file name: one .html per page, styles.css, tokens.css and
 * project.json. Every .html file in the folder is a page.
 */
export type ProjectFiles = Readonly<Record<string, string>>;

export const STYLES_FILE = 'styles.css';
export const TOKENS_FILE = 'tokens.css';
export const PROJECT_FILE = 'project.json';

/** File names a project may contain (no folders; keeps every path inside the project). */
export const PROJECT_FILE_NAME = /^[a-z0-9][a-z0-9_.-]*\.(html|css|json)$/i;

export function isPageFile(name: string): boolean {
  return /\.html$/i.test(name) && PROJECT_FILE_NAME.test(name);
}

/** Editor state worth remembering between sessions (not undoable, not part of the design). */
export interface EditorMeta {
  readonly viewport: ViewportMeta | null;
  readonly collapsed: readonly NodeId[];
  readonly activePage: string | null;
}

/** Skip propagation only when canonicalizing a storage baseline for comparison. */
export interface ProjectOptions {
  readonly syncComponents?: boolean;
}

export function serializeProject(
  doc: DesignDocument,
  meta: EditorMeta,
  options: ProjectOptions = {},
): Record<string, string> {
  if (options.syncComponents !== false) doc = synchronizeComponents(doc);
  const roots = doc.pages.flatMap((p) => p.roots);
  const project: ProjectJson = {
    ...(doc.thumbnail && doc.nodes[doc.thumbnail.frame]?.kind === 'element' ? { thumbnail: doc.thumbnail } : {}),
    ...(doc.components ? { components: doc.components } : {}),
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    files: { styles: STYLES_FILE, tokens: TOKENS_FILE },
    pages: doc.pages.map((p) => ({ file: p.file, name: p.name, ...(p.canvas ? { canvas: p.canvas } : {}), ...(p.guides?.length ? { guides: p.guides.filter((g) => !g.frame || doc.nodes[g.frame]) } : {}) })),
    canvas: { viewport: meta.viewport, activePage: meta.activePage, frames: pick(doc.frames, roots) },
    layers: {
      names: pick(doc.names, Object.keys(doc.nodes)),
      collapsed: meta.collapsed.filter((id) => doc.nodes[id]),
      ...(doc.locked?.some((id) => doc.nodes[id]) ? { locked: doc.locked.filter((id) => doc.nodes[id]) } : {}),
    },
  };
  const files: Record<string, string> = {};
  for (const page of doc.pages) files[page.file] = serializeHTML(doc, page);
  files[STYLES_FILE] = serializeStyleSheet(doc.styles);
  files[TOKENS_FILE] = serializeTokenSheet(doc.tokens);
  files[PROJECT_FILE] = JSON.stringify(project, null, 2) + '\n';
  return files;
}

/** Page order: as listed in project.json, then any other .html files (index.html first). */
function pageOrder(files: ProjectFiles, project: ProjectJson): { file: string; name: string; canvas?: string; guides?: readonly RulerGuide[] }[] {
  const available = Object.keys(files).filter(isPageFile);
  const listed = project.pages.filter((p) => available.includes(p.file));
  const unlisted = available
    .filter((f) => !listed.some((p) => p.file === f))
    .sort((a, b) => (a === FIRST_PAGE_FILE ? -1 : b === FIRST_PAGE_FILE ? 1 : a.localeCompare(b)));
  const pages = [
    ...listed,
    ...unlisted.map((file, i) => ({
      file,
      name: file === FIRST_PAGE_FILE ? 'Page 1' : `Page ${listed.length + i + 1}`,
    })),
  ];
  return pages.length ? pages : [{ file: FIRST_PAGE_FILE, name: 'Page 1' }];
}

type ParsedProject = { doc: DesignDocument; meta: EditorMeta };

/**
 * Read a project's files into a document, one page at a time: it yields after each page so
 * a caller can let the browser breathe (parseProjectAsync). Returns the document as stored,
 * before components are synchronized (finishProject does that).
 */
function* readProjectFiles(files: ProjectFiles): Generator<void, ParsedProject, void> {
  const project = readProjectJson(files[PROJECT_FILE] ?? '');
  const seen = new Set<NodeId>();
  const nodes: DesignDocument['nodes'] = {};
  const pages: Page[] = [];
  let title = '';
  for (const { file, name, canvas, guides } of pageOrder(files, project)) {
    const markup = parseHTML(files[file] ?? '', seen);
    Object.assign(nodes, markup.nodes);
    pages.push({ file, name, roots: markup.roots, ...(canvas ? { canvas } : {}), ...(guides ? { guides: guides.filter((g) => !g.frame || markup.nodes[g.frame]) } : {}) });
    if (!title || file === FIRST_PAGE_FILE) title = files[file] ? markup.title : title;
    yield;
  }

  let styles = parseStyleSheet(files[STYLES_FILE] ?? '');
  let tokens = parseTokenSheet(files[TOKENS_FILE] ?? '');
  if (files[TOKENS_FILE] === undefined) {
    // Older projects kept `:root` variables in styles.css; they become tokens.
    const moved = extractStyleTokens(styles);
    tokens = moved.tokens;
    styles = moved.styles;
  }

  const frames: Record<NodeId, Point> = {};
  for (const page of pages) {
    let nextX = 0;
    for (const id of page.roots) {
      // Roots without a stored position (e.g. added by hand) are laid out left to right.
      const known = project.canvas.frames[id];
      frames[id] = known ?? { x: nextX, y: 0 };
      nextX = Math.max(nextX, (known?.x ?? nextX) + 560);
    }
  }
  const doc: DesignDocument = {
    ...(project.thumbnail && nodes[project.thumbnail.frame]?.kind === 'element' ? { thumbnail: project.thumbnail } : {}),
    ...(project.components ? { components: project.components } : {}),
    title: title || 'Untitled',
    nodes,
    pages,
    styles,
    tokens,
    frames,
    names: pick(project.layers.names, Object.keys(nodes)),
    ...(project.layers.locked?.some((id) => nodes[id]) ? { locked: project.layers.locked.filter((id) => nodes[id]) } : {}),
  };
  const activePage = pages.some((p) => p.file === project.canvas.activePage) ? project.canvas.activePage : null;
  return { doc, meta: { viewport: project.canvas.viewport, collapsed: project.layers.collapsed, activePage } };
}

/** The document the editor works on, from one read as stored (see readProjectFiles). */
export function finishProject(stored: ParsedProject, options: ProjectOptions = {}): ParsedProject {
  return { doc: normalizeInterFonts(options.syncComponents === false ? stored.doc : synchronizeComponents(stored.doc)), meta: stored.meta };
}

export function parseProject(files: ProjectFiles, options: ProjectOptions = {}): ParsedProject {
  const steps = readProjectFiles(files);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return finishProject(step.value, options);
}

/**
 * parseProject for big files: the same result as stored (finish it with finishProject), but
 * pausing after each page so the tab keeps painting and never shows "page unresponsive".
 */
export async function parseProjectAsync(files: ProjectFiles, onPage?: (done: number, total: number) => void): Promise<ParsedProject> {
  const total = Object.keys(files).filter(isPageFile).length;
  const steps = readProjectFiles(files);
  let done = 0;
  let last = performance.now();
  let step = steps.next();
  while (!step.done) {
    onPage?.(++done, total);
    // Yield only once a slice of work has piled up: small files open without any delay.
    if (performance.now() - last > 40) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      last = performance.now();
    }
    step = steps.next();
  }
  return step.value;
}

export function sameFiles(a: ProjectFiles, b: ProjectFiles | null | undefined): boolean {
  if (!b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function pick<T>(record: Readonly<Record<string, T>>, keys: readonly string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
