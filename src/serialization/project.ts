/**
 * project.json: editor metadata only. Deleting it loses canvas placement, page names and order,
 * and layer names, never the design itself.
 */
import type { NodeId, Point } from '../document/types';

export const PROJECT_FORMAT = 'plastic';
export const PROJECT_VERSION = 2;

export interface ViewportMeta {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface PageMeta {
  readonly file: string;
  readonly name: string;
  readonly canvas?: string;
}

export interface ProjectJson {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: number;
  readonly files: { readonly styles: string; readonly tokens: string };
  /** Pages in order. Their HTML files live next to project.json. */
  readonly pages: readonly PageMeta[];
  readonly canvas: {
    readonly viewport: ViewportMeta | null;
    readonly activePage: string | null;
    /** Artboard positions in world coordinates, keyed by `data-pl-id`. */
    readonly frames: Readonly<Record<NodeId, Point>>;
  };
  readonly layers: {
    readonly names: Readonly<Record<NodeId, string>>;
    readonly collapsed: readonly NodeId[];
  };
}

export function defaultProjectJson(): ProjectJson {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    files: { styles: 'styles.css', tokens: 'tokens.css' },
    pages: [],
    canvas: { viewport: null, activePage: null, frames: {} },
    layers: { names: {}, collapsed: [] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

/** Tolerant reader: unknown or malformed fields fall back to defaults. Version 1 had no pages. */
export function readProjectJson(text: string): ProjectJson {
  const base = defaultProjectJson();
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return base;
  }
  if (!isRecord(raw)) return base;
  const canvas = isRecord(raw.canvas) ? raw.canvas : {};
  const layers = isRecord(raw.layers) ? raw.layers : {};

  const frames: Record<NodeId, Point> = {};
  if (isRecord(canvas.frames)) {
    for (const [id, p] of Object.entries(canvas.frames)) if (isPoint(p)) frames[id] = { x: p.x, y: p.y };
  }
  const names: Record<NodeId, string> = {};
  if (isRecord(layers.names)) {
    for (const [id, name] of Object.entries(layers.names)) if (typeof name === 'string') names[id] = name;
  }
  const pages: PageMeta[] = Array.isArray(raw.pages)
    ? raw.pages.flatMap((p) =>
        isRecord(p) && typeof p.file === 'string' && typeof p.name === 'string'
          ? [{ file: p.file, name: p.name, ...(typeof p.canvas === 'string' ? { canvas: p.canvas } : {}) }]
          : [],
      )
    : [];
  const v = canvas.viewport;
  const viewport = isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number' ? { x: v.x, y: v.y, zoom: v.zoom } : null;
  const collapsed = Array.isArray(layers.collapsed) ? layers.collapsed.filter((id): id is string => typeof id === 'string') : [];
  const activePage = typeof canvas.activePage === 'string' ? canvas.activePage : null;

  return { ...base, pages, canvas: { viewport, activePage, frames }, layers: { names, collapsed } };
}
