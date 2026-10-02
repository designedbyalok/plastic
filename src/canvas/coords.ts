/**
 * Three coordinate spaces, never mixed:
 *
 *  - document space: CSS pixels inside an artboard. This is what styles store (left: 120px).
 *  - world space:    the infinite canvas. Artboards sit at `frames[id]` in world space.
 *  - screen space:   pixels inside the canvas viewport element (client coords minus its origin).
 *
 * screen = world * zoom + (viewport.x, viewport.y). The zoom is applied as one CSS transform on
 * the world layer, so element styles are never rewritten when zooming.
 */
import type { Point } from '../document/types.ts';

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export function screenToWorld(p: Point, v: Viewport): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function worldToScreen(p: Point, v: Viewport): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Zoom while keeping the world point under `anchor` (screen space) fixed. */
export function zoomAround(v: Viewport, anchor: Point, zoom: number): Viewport {
  const z = clampZoom(zoom);
  const world = screenToWorld(anchor, v);
  return { zoom: z, x: anchor.x - world.x * z, y: anchor.y - world.y * z };
}

/** Viewport that fits a world rect into a screen of the given size. */
export function fitRect(rect: Rect, screen: { width: number; height: number }, padding = 64, maxZoom = 1): Viewport {
  const zoom = clampZoom(
    Math.min(maxZoom, (screen.width - padding * 2) / Math.max(1, rect.width), (screen.height - padding * 2) / Math.max(1, rect.height)),
  );
  return {
    zoom,
    x: (screen.width - rect.width * zoom) / 2 - rect.x * zoom,
    y: (screen.height - rect.height * zoom) / 2 - rect.y * zoom,
  };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
