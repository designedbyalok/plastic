/**
 * Bridge from document ids to the live DOM elements the renderer created, plus helpers that
 * convert DOM measurements into screen space. This is the only place the editor touches the
 * rendered design directly.
 */
import { ID_ATTR } from '../document/markup';
import type { NodeId, Point } from '../document/types';
import type { Rect } from './coords';

const elements = new Map<NodeId, Element>();
const hosts = new Map<NodeId, HTMLElement>();
const rerenderListeners = new Set<() => void>();
let viewportElement: HTMLElement | null = null;

export function registerElement(id: NodeId, el: Element): void {
  elements.set(id, el);
}

export function unregisterElement(id: NodeId, el: Element): void {
  if (elements.get(id) === el) elements.delete(id);
}

export function domElement(id: NodeId | null | undefined): HTMLElement | null {
  if (!id) return null;
  const el = elements.get(id);
  return el && el.isConnected ? (el as HTMLElement) : null;
}

export function registerHost(rootId: NodeId, host: HTMLElement): () => void {
  hosts.set(rootId, host);
  return () => {
    if (hosts.get(rootId) === host) hosts.delete(rootId);
  };
}

export function hostOf(rootId: NodeId): HTMLElement | null {
  return hosts.get(rootId) ?? null;
}

/** Ask every artboard to re-sync its DOM even if the document did not change. */
export function requestRerender(): void {
  rerenderListeners.forEach((fn) => fn());
}

export function onRerenderRequest(fn: () => void): () => void {
  rerenderListeners.add(fn);
  return () => rerenderListeners.delete(fn);
}

export function setViewportElement(el: HTMLElement | null): void {
  viewportElement = el;
}

export function getViewportElement(): HTMLElement | null {
  return viewportElement;
}

/** Client (window) coordinates → canvas screen space. */
export function toScreen(clientX: number, clientY: number): Point {
  const r = viewportElement?.getBoundingClientRect();
  return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
}

export function toScreenRect(r: DOMRect): Rect {
  const origin = toScreen(0, 0);
  return { x: r.left + origin.x, y: r.top + origin.y, width: r.width, height: r.height };
}

export function screenRectOf(id: NodeId): Rect | null {
  const el = domElement(id);
  return el ? toScreenRect(el.getBoundingClientRect()) : null;
}

export function nodeIdOf(target: EventTarget | null | undefined): NodeId | null {
  return target instanceof Element ? target.getAttribute(ID_ATTR) : null;
}

/** Deepest design element in an event's composed path (crosses shadow roots). */
export function nodeIdFromPath(path: readonly EventTarget[]): NodeId | null {
  for (const target of path) {
    const id = nodeIdOf(target);
    if (id) return id;
  }
  return null;
}

/** Design elements under a client point, deepest first. */
export function elementsAtPoint(clientX: number, clientY: number): HTMLElement[] {
  for (const host of hosts.values()) {
    const root = host.shadowRoot;
    const r = host.getBoundingClientRect();
    if (!root || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const hits = root
      .elementsFromPoint(clientX, clientY)
      .filter((el): el is HTMLElement => el.getRootNode() === root && el.hasAttribute(ID_ATTR));
    if (hits.length) return hits;
  }
  return [];
}

export function isOutOfFlow(el: Element | null): boolean {
  if (!el) return false;
  const position = getComputedStyle(el).position;
  return position === 'absolute' || position === 'fixed';
}
