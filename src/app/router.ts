/**
 * Two routes, mirroring the file-browser/editor split:  /  and  /file/<id>.
 * Plain History API; the dev server serves index.html for every path.
 */
import { useSyncExternalStore, type MouseEvent } from 'react';

export type Route = { readonly name: 'home' } | { readonly name: 'file'; readonly id: string };

const NAVIGATE_EVENT = 'plastic:navigate';

export function parseRoute(pathname: string): Route {
  const match = /^\/file\/([^/]+)\/?$/.exec(pathname);
  return match ? { name: 'file', id: decodeURIComponent(match[1]!) } : { name: 'home' };
}

export function fileHref(id: string): string {
  return `/file/${encodeURIComponent(id)}`;
}

export function navigate(href: string): void {
  if (href === location.pathname) return;
  history.pushState(null, '', href);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** onClick for <a href>: client-side navigation for plain clicks, normal behavior otherwise. */
export function linkClick(e: MouseEvent<HTMLAnchorElement>): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(e.currentTarget.getAttribute('href') ?? '/');
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}
