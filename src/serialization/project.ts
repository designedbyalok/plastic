/**
 * project.json: editor metadata only. Deleting it loses canvas placement and layer names,
 * never the design itself.
 */
import type { NodeId, Point } from '../document/types';

export const PROJECT_FORMAT = 'plastic';
export const PROJECT_VERSION = 1;

export interface ViewportMeta {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface ProjectJson {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: number;
  readonly files: { readonly html: string; readonly css: string };
  readonly canvas: {
    readonly viewport: ViewportMeta | null;
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
    files: { html: 'index.html', css: 'styles.css' },
    canvas: { viewport: null, frames: {} },
    layers: { names: {}, collapsed: [] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

/** Tolerant reader: unknown or malformed fields fall back to defaults. Future migrations go here. */
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
  const v = canvas.viewport;
  const viewport = isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number' ? { x: v.x, y: v.y, zoom: v.zoom } : null;
  const collapsed = Array.isArray(layers.collapsed) ? layers.collapsed.filter((id): id is string => typeof id === 'string') : [];

  return { ...base, canvas: { viewport, frames }, layers: { names, collapsed } };
}
