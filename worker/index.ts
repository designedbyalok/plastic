/**
 * Plastic on Cloudflare Workers. The app itself is static (dist/, served by the assets binding
 * with a single-page-app fallback, so /file/<id> deep links work); this Worker only runs for
 * /api/*.
 *
 *   GET  /api/health       → { auth: true, providers: ["email", "github", …] }
 *   *    /api/auth/*       → Better Auth (sign up/in/out, sessions, OAuth callbacks)
 */
import { getAuth, providers } from './auth.ts';
import type { Env } from './env.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ auth: true, providers: providers(env) });
    if (url.pathname.startsWith('/api/auth/')) {
      if (!env.BETTER_AUTH_SECRET) return json({ error: 'BETTER_AUTH_SECRET is not set.' }, 500);
      return getAuth(env).handler(request);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
