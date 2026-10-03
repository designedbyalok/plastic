/**
 * project.json: editor metadata only. Deleting it loses canvas placement, page names and order,
 * and layer names, never the design itself.
 */
import type { ComponentLibrary, FileThumbnail, NodeId, Point, RulerGuide } from '../document/types.ts';

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
  readonly guides?: readonly RulerGuide[];
}

export interface ProjectJson {
  readonly thumbnail?: FileThumbnail;
  readonly components?: ComponentLibrary;
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
          ? [{ file: p.file, name: p.name, ...(typeof p.canvas === 'string' ? { canvas: p.canvas } : {}), ...(Array.isArray(p.guides) ? { guides: readGuides(p.guides) } : {}) }]
          : [],
      )
    : [];
  const v = canvas.viewport;
  const viewport =
    isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number'
      ? { x: v.x, y: v.y, zoom: v.zoom }
      : null;
  const collapsed = Array.isArray(layers.collapsed)
    ? layers.collapsed.filter((id): id is string => typeof id === 'string')
    : [];
  const activePage = typeof canvas.activePage === 'string' ? canvas.activePage : null;

  const components = readComponents(raw.components);
  return {
    ...base,
    ...(readThumbnail(raw.thumbnail) ? { thumbnail: readThumbnail(raw.thumbnail) } : {}),
    ...(components ? { components } : {}),
    pages,
    canvas: { viewport, activePage, frames },
    layers: { names, collapsed },
  };
}

/** Ignore malformed component metadata without discarding any HTML. */
function readComponents(raw: unknown): ComponentLibrary | undefined {
  if (!isRecord(raw) || !isRecord(raw.definitions) || !isRecord(raw.instances)) return undefined;
  const validId = (id: string) => /^[\w-]{1,64}$/.test(id);
  const definitions = Object.fromEntries(
    Object.entries(raw.definitions)
      .filter(([id, name]) => validId(id) && typeof name === 'string' && name.trim())
      .map(([id, name]) => [id, String(name)]),
  );
  const instances: Record<string, ComponentLibrary['instances'][string]> = {};
  for (const [id, link] of Object.entries(raw.instances)) {
    if (
      !validId(id) ||
      !isRecord(link) ||
      typeof link.source !== 'string' ||
      !validId(link.source) ||
      typeof link.baseline !== 'string' ||
      !isRecord(link.elements)
    )
      continue;
    const entries = Object.entries(link.elements);
    if (
      !entries.every(([key, value]) => validId(key) && typeof value === 'string' && validId(value)) ||
      new Set(entries.map(([, value]) => value)).size !== entries.length ||
      link.elements[link.source] !== id
    )
      continue;
    instances[id] = { source: link.source, baseline: link.baseline, elements: link.elements as Record<string, string> };
  }
  return { definitions, instances };
}

function readGuides(raw: unknown[]): RulerGuide[] {
  const ids = new Set<string>();
  return raw.flatMap((guide) => {
    if (!isRecord(guide) || typeof guide.id !== 'string' || !/^[\w-]{1,64}$/.test(guide.id) || ids.has(guide.id) ||
      (guide.axis !== 'x' && guide.axis !== 'y') || typeof guide.value !== 'number' || !Number.isFinite(guide.value) ||
      (guide.frame !== undefined && (typeof guide.frame !== 'string' || !/^[\w-]{1,64}$/.test(guide.frame)))) return [];
    ids.add(guide.id);
    return [{ id: guide.id, axis: guide.axis, value: guide.value, ...(typeof guide.frame === 'string' ? { frame: guide.frame } : {}) }];
  });
}

/** Only bounded raster snapshots can become public link images. */
export function readThumbnail(raw: unknown): FileThumbnail | undefined {
  if (!isRecord(raw) || typeof raw.frame !== 'string' || !/^[\w-]{1,64}$/.test(raw.frame) ||
    typeof raw.image !== 'string' || raw.image.length > 2_000_000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw.image) ||
    typeof raw.width !== 'number' || !Number.isInteger(raw.width) || raw.width < 1 || raw.width > 1200 ||
    typeof raw.height !== 'number' || !Number.isInteger(raw.height) || raw.height < 1 || raw.height > 1200 ||
    typeof raw.source !== 'string' || !/^[a-f0-9]{64}$/.test(raw.source)) return undefined;
  return { ...(typeof raw.page === 'string' && /^[a-z0-9][a-z0-9_.-]*\.html$/i.test(raw.page) ? { page: raw.page } : {}), frame: raw.frame, image: raw.image, width: raw.width, height: raw.height, source: raw.source };
}
