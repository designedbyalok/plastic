/**
 * Snapping, like Figma's: positions lock to other objects' edges and centers and to other points
 * (with a guide line), and otherwise round to whole document pixels. Everything is in screen
 * space; targets are collected once when a gesture starts.
 */
import { getElement, getParentId } from '../document/tree.ts';
import type { NodeId, Point } from '../document/types.ts';
import { useEditor } from '../editor/store.ts';
import type { Rect } from './coords.ts';
import { getViewportElement, screenRectOf } from './dom.ts';
import { useGesture, type Line } from './gestureStore.ts';

/** How close (screen px) a position must be to a target to snap. */
export const SNAP_DISTANCE = 5;

// --- preferences -------------------------------------------------------------------------------

export interface SnapPrefs {
  /** Round to whole document pixels. */
  readonly pixel: boolean;
  /** Snap to other objects and points. */
  readonly objects: boolean;
}

const PREFS_KEY = 'plastic:snap';
let prefs: SnapPrefs = readPrefs();
const listeners = new Set<() => void>();

function readPrefs(): SnapPrefs {
  try {
    return { pixel: true, objects: true, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<SnapPrefs>) };
  } catch {
    return { pixel: true, objects: true };
  }
}

export function snapPrefs(): SnapPrefs {
  return prefs;
}

export function setSnapPref(key: keyof SnapPrefs, on: boolean): void {
  prefs = { ...prefs, [key]: on };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // a preference only
  }
  listeners.forEach((fn) => fn());
}

export function onSnapPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- targets -----------------------------------------------------------------------------------

export interface SnapTargets {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** Screen position of the artboard's document origin, for the pixel grid. */
  readonly origin: Point | null;
}

const EMPTY: SnapTargets = { xs: [], ys: [], origin: null };

function rootOf(id: NodeId | null): NodeId | null {
  const { doc } = useEditor.getState();
  let current = id;
  while (current) {
    const parent = getParentId(doc, current);
    if (!parent) return current;
    current = parent;
  }
  return null;
}

/**
 * Edges and centers of every element in the artboard holding `near` (and the artboard itself),
 * except `exclude` and what's inside them; plus any extra points.
 */
export function collectTargets(near: NodeId | null, exclude: readonly NodeId[], points: readonly Point[] = []): SnapTargets {
  const root = rootOf(near);
  const origin = root ? screenRectOf(root) : null;
  const xs: number[] = points.map((p) => p.x);
  const ys: number[] = points.map((p) => p.y);
  if (!prefs.objects) return { xs: [], ys: [], origin: origin ? { x: origin.x, y: origin.y } : null };
  if (root) {
    const { doc } = useEditor.getState();
    const skip = new Set(exclude);
    let budget = 600;
    const walk = (id: NodeId) => {
      if (skip.has(id) || budget-- <= 0) return;
      const el = getElement(doc, id);
      if (!el) return;
      const r = screenRectOf(id);
      if (r && (r.width || r.height)) {
        xs.push(r.x, r.x + r.width / 2, r.x + r.width);
        ys.push(r.y, r.y + r.height / 2, r.y + r.height);
      }
      // Shapes inside an svg aren't separate objects to snap to.
      if (el.tag !== 'svg') el.children.forEach(walk);
    };
    walk(root);
  }
  return { xs, ys, origin: origin ? { x: origin.x, y: origin.y } : null };
}

// --- snapping ----------------------------------------------------------------------------------

function nearest(value: number, candidates: readonly number[]): number | null {
  let best: number | null = null;
  let distance = SNAP_DISTANCE;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d <= distance) {
      distance = d;
      best = c;
    }
  }
  return best;
}

function viewportSize(): { width: number; height: number } {
  const el = getViewportElement();
  return { width: el?.clientWidth ?? 4000, height: el?.clientHeight ?? 4000 };
}

const vertical = (x: number): Line => ({ x1: x, y1: 0, x2: x, y2: viewportSize().height });
const horizontal = (y: number): Line => ({ x1: 0, y1: y, x2: viewportSize().width, y2: y });

/** Round a screen coordinate to whole document pixels of the artboard. */
function toPixel(value: number, origin: number): number {
  const zoom = useEditor.getState().viewport.zoom;
  return origin + Math.round((value - origin) / zoom) * zoom;
}

/** Snap one point. Guides are shown for the axes that locked onto a target. */
export function snapPoint(p: Point, targets: SnapTargets = EMPTY, show = true): Point {
  const sx = nearest(p.x, targets.xs);
  const sy = nearest(p.y, targets.ys);
  const guides: Line[] = [];
  let x = p.x;
  let y = p.y;
  if (sx !== null) {
    x = sx;
    guides.push(vertical(sx));
  } else if (prefs.pixel && targets.origin) {
    x = toPixel(p.x, targets.origin.x);
  }
  if (sy !== null) {
    y = sy;
    guides.push(horizontal(sy));
  } else if (prefs.pixel && targets.origin) {
    y = toPixel(p.y, targets.origin.y);
  }
  if (show) useGesture.getState().set({ guides });
  return { x, y };
}

/**
 * Snap a moving box: its left/center/right and top/middle/bottom each try the targets; the
 * closest match per axis wins. Returns the corrected offset of the box.
 */
export function snapRect(rect: Rect, targets: SnapTargets): Point {
  const guides: Line[] = [];
  const axis = (edges: number[], candidates: readonly number[], line: (v: number) => Line) => {
    let best: { delta: number; at: number } | null = null;
    for (const e of edges) {
      const hit = nearest(e, candidates);
      if (hit !== null && (!best || Math.abs(hit - e) < Math.abs(best.delta))) best = { delta: hit - e, at: hit };
    }
    if (best) guides.push(line(best.at));
    return best?.delta ?? 0;
  };
  const dx = axis([rect.x, rect.x + rect.width / 2, rect.x + rect.width], targets.xs, vertical);
  const dy = axis([rect.y, rect.y + rect.height / 2, rect.y + rect.height], targets.ys, horizontal);
  useGesture.getState().set({ guides });
  return { x: dx, y: dy };
}

export function clearGuides(): void {
  useGesture.getState().set({ guides: [] });
}

/** Screen → client coordinates (the inverse of dom.toScreen). */
export function toClient(p: Point): Point {
  const r = getViewportElement()?.getBoundingClientRect();
  return { x: p.x + (r?.left ?? 0), y: p.y + (r?.top ?? 0) };
}
