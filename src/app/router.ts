/**
 * Two routes, mirroring the file-browser/editor split:  /  and  /file/<id>.
 * Plain History API; the dev server serves index.html for every path.
 */
import { useSyncExternalStore, type MouseEvent } from 'react';

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'files'; readonly folderId: string | null }
  | { readonly name: 'archive' }
  | { readonly name: 'profile' }
  | { readonly name: 'admin' }
  | { readonly name: 'file'; readonly id: string };

const NAVIGATE_EVENT = 'plastic:navigate';

export function parseRoute(pathname: string): Route {
  const file = /^\/file\/([^/]+)\/?$/.exec(pathname);
  if (file) return { name: 'file', id: decodeURIComponent(file[1]!) };
  const folder = /^\/files(?:\/([^/]+))?\/?$/.exec(pathname);
  if (folder) return { name: 'files', folderId: folder[1] ? decodeURIComponent(folder[1]) : null };
  if (/^\/archive\/?$/.test(pathname)) return { name: 'archive' };
  if (/^\/profile\/?$/.test(pathname)) return { name: 'profile' };
  if (/^\/admin\/?$/.test(pathname)) return { name: 'admin' };
  return { name: 'home' };
}

export function folderHref(id: string | null): string {
  return id ? `/files/${encodeURIComponent(id)}` : '/files';
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
