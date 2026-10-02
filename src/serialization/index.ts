import { parseStyleSheet, serializeStyleSheet } from '../document/css';
import type { DesignDocument, NodeId, Point } from '../document/types';
import { parseHTML, serializeHTML } from './html';
import { PROJECT_FORMAT, PROJECT_VERSION, readProjectJson, type ProjectJson, type ViewportMeta } from './project';

/** The three files of a project folder. */
export interface ProjectFiles {
  readonly html: string;
  readonly css: string;
  readonly project: string;
}

/** Editor state worth remembering between sessions (not undoable, not part of the design). */
export interface EditorMeta {
  readonly viewport: ViewportMeta | null;
  readonly collapsed: readonly NodeId[];
}

export function serializeProject(doc: DesignDocument, meta: EditorMeta): ProjectFiles {
  const project: ProjectJson = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    files: { html: 'index.html', css: 'styles.css' },
    canvas: { viewport: meta.viewport, frames: pick(doc.frames, doc.roots) },
    layers: { names: pick(doc.names, Object.keys(doc.nodes)), collapsed: meta.collapsed.filter((id) => doc.nodes[id]) },
  };
  return {
    html: serializeHTML(doc),
    css: serializeStyleSheet(doc.styles),
    project: JSON.stringify(project, null, 2) + '\n',
  };
}

export function parseProject(files: ProjectFiles): { doc: DesignDocument; meta: EditorMeta } {
  const markup = parseHTML(files.html);
  const project = readProjectJson(files.project);
  const frames: Record<NodeId, Point> = {};
  let nextX = 0;
  for (const id of markup.roots) {
    // Roots without a stored position (e.g. added by hand) are laid out left to right.
    const known = project.canvas.frames[id];
    frames[id] = known ?? { x: nextX, y: 0 };
    nextX = Math.max(nextX, (known?.x ?? nextX) + 560);
  }
  const doc: DesignDocument = {
    title: markup.title,
    nodes: markup.nodes,
    roots: markup.roots,
    styles: parseStyleSheet(files.css),
    frames,
    names: pick(project.layers.names, Object.keys(markup.nodes)),
  };
  return { doc, meta: { viewport: project.canvas.viewport, collapsed: project.layers.collapsed } };
}

function pick<T>(record: Readonly<Record<string, T>>, keys: readonly string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
