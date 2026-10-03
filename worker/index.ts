/**
 * Plastic on Cloudflare Workers. The app itself is static (dist/, served by the assets binding
 * with a single-page-app fallback, so /file/<id> deep links work); this Worker only runs for
 * /api/*.
 *
 *   GET  /api/health       → { auth: true, providers: ["email", "github", …] }
 *   *    /api/auth/*       → Better Auth (sign up/in/out, sessions, OAuth callbacks)
 *   *    /api/projects/*   → the signed-in user's files (see projects.ts); …/live is the
 *                             WebSocket for live sync (see live.ts)
 *   *    /api/folders/*, GET /api/activity → folders and profile activity (see library.ts)
 */
import { serveFilePreview, servePreviewImage } from './previews.ts';
import { getAuth, providers } from './auth.ts';
import type { Env } from './env.ts';
import { handleProjects } from './projects.ts';
import { activity, handleFolders } from './library.ts';

export { ProjectRoom } from './live.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const previewImage = /^\/api\/previews\/([a-f0-9]{32})\/image$/.exec(url.pathname);
    if (previewImage) return servePreviewImage(request, env, previewImage[1]!);
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/file/') && url.searchParams.has('preview')) return serveFilePreview(request, env);
    if (url.pathname === '/api/health') {
      // Asked once per page load; the answer only changes on deploy, so let browsers reuse it.
      return Response.json({ auth: true, providers: providers(env) }, { headers: { 'cache-control': 'public, max-age=600' } });
    }
    if (url.pathname.startsWith('/api/auth/')) {
      if (!env.BETTER_AUTH_SECRET) return json({ error: 'BETTER_AUTH_SECRET is not set.' }, 500);
      return getAuth(env).handler(request);
    }
    const scoped = ['/api/projects', '/api/folders', '/api/activity'].find((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
    if (scoped) {
      if (!env.BETTER_AUTH_SECRET) return json({ error: 'BETTER_AUTH_SECRET is not set.' }, 500);
      const session = await getAuth(env).api.getSession({ headers: request.headers });
      if (!session) return json({ error: 'Sign in to see your files.' }, 401);
      // Writes must come from this site (cookies are SameSite=Lax; this closes the rest).
      // WebSocket handshakes are GETs, so they're origin-checked too.
      if ((request.method !== 'GET' && request.method !== 'HEAD') || request.headers.get('upgrade')) {
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(env.BETTER_AUTH_URL).origin && origin !== url.origin) return json({ error: 'Cross-origin request.' }, 403);
      }
      const path = url.pathname.split('/').slice(3).filter(Boolean).map(decodeURIComponent);
      if (scoped === '/api/folders') return handleFolders(request, env, session.user.id, path);
      if (scoped === '/api/activity') return request.method === 'GET' ? activity(env, session.user.id) : json({ error: 'Method not allowed.' }, 405);
      return handleProjects(request, env, session.user.id, path);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
