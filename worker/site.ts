/**
 * The public site (landing, changelog, download) is built by Astro into dist/site/ and shares
 * the domain with the app. Visitors and search engines get the site at "/"; anyone with a
 * session cookie, or arriving on an auth link (/?auth=…, /?token=…, /?error=…), gets the app.
 * Only a cookie's presence is checked here (no database read): an expired session simply
 * lands on the app's sign-in screen.
 */
import type { Env } from './env.ts';

const PAGES: Record<string, string> = {
  '/changelog': '/site/changelog',
  '/download': '/site/download',
  '/sitemap.xml': '/site/sitemap.xml',
};
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;
const AUTH_PARAMS = ['auth', 'token', 'error', 'email'];

export function wantsApp(request: Request, url: URL): boolean {
  return AUTH_PARAMS.some((p) => url.searchParams.has(p)) || SESSION_COOKIE.test(request.headers.get('cookie') ?? '');
}

/** The site response for a site route, or null to let the app handle it. */
export async function serveSite(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  // One canonical URL per page.
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && PAGES[url.pathname.slice(0, -1)])
    return Response.redirect(new URL(url.pathname.slice(0, -1) + url.search, url).href, 301);
  let target: string | undefined;
  if (url.pathname === '/') {
    if (wantsApp(request, url)) return null;
    target = '/site/';
  } else target = PAGES[url.pathname];
  if (!target) return null;
  const response = await env.ASSETS.fetch(new Request(new URL(target, url), request));
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  // The landing page depends on the cookie (site vs app), so shared caches must not mix them.
  if (url.pathname === '/') headers.set('vary', 'cookie');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, { status: response.status, headers });
}
