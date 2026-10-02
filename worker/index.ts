/**
 * Plastic on Cloudflare Workers. The app itself is static (dist/, served by the assets binding
 * with a single-page-app fallback, so /file/<id> deep links work); this Worker only runs for
 * /api/*.
 *
 *   GET  /api/health       → { auth: true, providers: ["email", "github", …] }
 *   *    /api/auth/*       → Better Auth (sign up/in/out, sessions, OAuth callbacks)
 *   *    /api/projects/*   → the signed-in user's files (see projects.ts)
 */
import { getAuth, providers } from './auth.ts';
import type { Env } from './env.ts';
import { handleProjects } from './projects.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ auth: true, providers: providers(env) });
    if (url.pathname.startsWith('/api/auth/')) {
      if (!env.BETTER_AUTH_SECRET) return json({ error: 'BETTER_AUTH_SECRET is not set.' }, 500);
      return getAuth(env).handler(request);
    }
    if (url.pathname === '/api/projects' || url.pathname.startsWith('/api/projects/')) {
      if (!env.BETTER_AUTH_SECRET) return json({ error: 'BETTER_AUTH_SECRET is not set.' }, 500);
      const session = await getAuth(env).api.getSession({ headers: request.headers });
      if (!session) return json({ error: 'Sign in to see your files.' }, 401);
      // Writes must come from this site (cookies are SameSite=Lax; this closes the rest).
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(env.BETTER_AUTH_URL).origin && origin !== url.origin) return json({ error: 'Cross-origin request.' }, 403);
      }
      const path = url.pathname.split('/').slice(3).filter(Boolean).map(decodeURIComponent);
      return handleProjects(request, env, session.user.id, path);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
