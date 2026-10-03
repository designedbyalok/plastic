/**
 * Bridge from document ids to the live DOM elements the renderer created, plus helpers that
 * convert DOM measurements into screen space. This is the only place the editor touches the
 * rendered design directly.
 *
 * Design elements live inside per-artboard iframes (other documents, other JS realms), so:
 *  - rects are mapped from the iframe's own coordinates into the editor window (`clientRectOf`),
 *  - computed styles come from the element's own window (`styleOf`),
 *  - never use `instanceof` on design nodes (it fails across realms); check `nodeType` instead.
 */
import { ID_ATTR } from '../document/markup.ts';
import type { NodeId, Point } from '../document/types.ts';
import type { Rect } from './coords.ts';

const elements = new Map<NodeId, Element>();
/** Artboard iframes by root id. */
const hosts = new Map<NodeId, HTMLIFrameElement>();
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

export function registerHost(rootId: NodeId, host: HTMLIFrameElement): () => void {
  hosts.set(rootId, host);
  return () => {
    if (hosts.get(rootId) === host) hosts.delete(rootId);
  };
}

export function hostOf(rootId: NodeId): HTMLIFrameElement | null {
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

/** An artboard iframe's scale: its on-screen width over its CSS width (the zoom, measured). */
function frameScale(frame: HTMLIFrameElement, rect: DOMRect): number {
  return frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
}

/** Bounding rect of any design element in editor-window client coordinates. */
export function clientRectOf(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const frame = el.ownerDocument.defaultView?.frameElement as HTMLIFrameElement | null | undefined;
  if (!frame || el.ownerDocument === document) return r;
  const fr = frame.getBoundingClientRect();
  const scale = frameScale(frame, fr);
  return new DOMRect(fr.left + frame.clientLeft * scale + r.left * scale, fr.top + frame.clientTop * scale + r.top * scale, r.width * scale, r.height * scale);
}

/** Computed style from the element's own window (required for iframe content). */
export function styleOf(el: Element): CSSStyleDeclaration {
  return (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
}

export function toScreenRect(r: DOMRect): Rect {
  const origin = toScreen(0, 0);
  return { x: r.left + origin.x, y: r.top + origin.y, width: r.width, height: r.height };
}

export function screenRectOf(id: NodeId): Rect | null {
  const el = domElement(id);
  return el ? toScreenRect(clientRectOf(el)) : null;
}

function isElement(value: unknown): value is Element {
  return typeof value === 'object' && value !== null && (value as Node).nodeType === 1;
}

export function nodeIdOf(target: EventTarget | null | undefined): NodeId | null {
  return isElement(target) ? target.getAttribute(ID_ATTR) : null;
}

/**
 * Design elements under a client point, deepest first. Artboard iframes never receive pointer
 * events themselves; the canvas hit-tests into their documents instead.
 */
export function elementsAtPoint(clientX: number, clientY: number): HTMLElement[] {
  for (const frame of [...hosts.values()].reverse()) {
    const doc = frame.contentDocument;
    const r = frame.getBoundingClientRect();
    if (!doc || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const scale = frameScale(frame, r);
    const hits = doc
      .elementsFromPoint((clientX - r.left) / scale, (clientY - r.top) / scale)
      .filter((el): el is HTMLElement => el.hasAttribute(ID_ATTR));
    if (hits.length) return hits;
  }
  return [];
}

let hitFilter: ((id: NodeId | null) => NodeId | null) | null = null;

/** Redirect canvas picks (locked layers pass the click to the layer above them). */
export function setHitFilter(filter: typeof hitFilter): void {
  hitFilter = filter;
}

/** The deepest pickable design element under a client point. */
export function nodeIdAt(clientX: number, clientY: number): NodeId | null {
  const id = nodeIdOf(elementsAtPoint(clientX, clientY)[0]);
  return hitFilter ? hitFilter(id) : id;
}

export function isOutOfFlow(el: Element | null): boolean {
  if (!el) return false;
  const position = styleOf(el).position;
  return position === 'absolute' || position === 'fixed';
}
