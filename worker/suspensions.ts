/**
 * Suspending members (admins only). A suspension can start now or after a grace period. While
 * it's in effect, no sign-in (password, magic link, Google) creates a session, and the person's
 * existing sessions are ended, so every request they make is refused. Their files are kept;
 * lifting the suspension restores everything.
 *
 *   POST /api/admin/suspend     { email, when: 'now' | '30d', reason? } → { ok, startsAt }
 *   POST /api/admin/unsuspend   { email } → { ok }
 */
import type { Env } from './env.ts';
import { isAdmin } from './waitlist.ts';

export const GRACE_DAYS = 30;
const DAY = 86_400_000;

export const SUSPENDED_MESSAGE = 'This account is suspended. If you think that’s a mistake, reply to any email from Plastic.';

/** Is this person suspended right now? (Checked when any sign-in creates a session.) */
export async function isSuspended(env: Env, userId: string, now = Date.now()): Promise<boolean> {
  const row = await env.DB.prepare('select starts_at from suspension where user_id = ?').bind(userId).first<{ starts_at: number }>();
  return Boolean(row && row.starts_at <= now);
}

async function signOutEverywhere(env: Env, userId: string, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('delete from session where userId = ?').bind(userId),
    env.DB.prepare('update suspension set signed_out_at = ? where user_id = ?').bind(now, userId),
  ]);
}

export async function suspend(
  env: Env,
  admin: string,
  email: string,
  when: 'now' | '30d',
  reason: string | null,
  now = Date.now(),
): Promise<{ ok: true; startsAt: number } | { error: string; status: number }> {
  if (isAdmin(env, email)) return { error: 'Admins can’t be suspended.', status: 409 };
  const user = await env.DB.prepare('select id from "user" where lower(email) = ?').bind(email.toLowerCase()).first<{ id: string }>();
  if (!user) return { error: 'They don’t have an account.', status: 404 };
  const startsAt = when === 'now' ? now : now + GRACE_DAYS * DAY;
  await env.DB.prepare(
    `insert into suspension (user_id, starts_at, reason, created_at, created_by, signed_out_at) values (?, ?, ?, ?, ?, null)
     on conflict (user_id) do update set starts_at = excluded.starts_at, reason = excluded.reason, created_at = excluded.created_at,
       created_by = excluded.created_by, signed_out_at = null`,
  )
    .bind(user.id, startsAt, reason, now, admin)
    .run();
  if (when === 'now') await signOutEverywhere(env, user.id, now);
  return { ok: true, startsAt };
}

export async function unsuspend(env: Env, email: string): Promise<void> {
  await env.DB.prepare('delete from suspension where user_id = (select id from "user" where lower(email) = ?)').bind(email.toLowerCase()).run();
}

/** Hourly: end the sessions of scheduled suspensions that have started. */
export async function startDueSuspensions(env: Env, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare('select user_id from suspension where signed_out_at is null and starts_at <= ?').bind(now).all<{ user_id: string }>();
  for (const { user_id } of results) await signOutEverywhere(env, user_id, now);
  return results.length;
}

/**
 * A browser following a sign-in link (magic link, Google callback) gets a page, not JSON: when
 * the sign-in is refused because the account is suspended, send it to the sign-in screen with a
 * clear message instead of a raw error.
 */
export async function friendlyAuthError(request: Request, response: Response, env: Env): Promise<Response> {
  if (request.method !== 'GET' || response.status !== 403 || !response.headers.get('content-type')?.includes('json')) return response;
  const body = (await response.clone().json().catch(() => null)) as { code?: string } | null;
  if (body?.code !== 'ACCOUNT_SUSPENDED') return response;
  const signIn = new URL('/', env.BETTER_AUTH_URL);
  signIn.searchParams.set('auth', 'sign-in');
  signIn.searchParams.set('error', 'account_suspended');
  return new Response(null, { status: 302, headers: { location: signIn.href, 'cache-control': 'no-store' } });
}
