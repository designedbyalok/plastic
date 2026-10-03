/**
 *   GET /api/invite?e=&t=&x=&s=   public: open an "invite accepted" link → signed in
 *
 * Checks the link (signature, expiry, and that the invite still stands), then asks Better Auth
 * for a fresh magic link without emailing it, and redirects through it: Better Auth creates the
 * account if needed (the invite allows it), marks the email verified and signs the person in.
 */
import type { Env } from './env.ts';
import { getAuth } from './auth.ts';
import { magicLinkCapture } from './emails.ts';
import { inviteSignature } from './inviteLink.ts';

function signInWith(env: Env, email: string, error?: string): Response {
  const url = new URL('/', env.BETTER_AUTH_URL);
  url.searchParams.set('auth', 'sign-in');
  url.searchParams.set('email', email);
  if (error) url.searchParams.set('error', error);
  return redirect(url.href);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

export async function handleInviteLink(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') ?? '').toLowerCase();
  const invitedAt = Number(url.searchParams.get('t'));
  const expires = Number(url.searchParams.get('x'));
  const signature = url.searchParams.get('s') ?? '';
  if (!email || !Number.isFinite(invitedAt) || !Number.isFinite(expires) || signature !== (await inviteSignature(env, email, invitedAt, expires)))
    return signInWith(env, email, 'invite_invalid');
  if (expires < Date.now()) return signInWith(env, email, 'invite_expired');
  // Cancelled (or re-accepted with a newer link) since this email was sent?
  const row = await env.DB.prepare('select invited_at from waitlist where email = ?').bind(email).first<{ invited_at: number | null }>();
  if (row?.invited_at !== invitedAt) return signInWith(env, email, 'invite_cancelled');
  // Without email there's no magic-link sign-in: they create a password instead.
  if (!env.RESEND_API_KEY) {
    const signUp = new URL('/', env.BETTER_AUTH_URL);
    signUp.searchParams.set('auth', 'sign-up');
    signUp.searchParams.set('email', email);
    return redirect(signUp.href);
  }
  const capture: { url: string | null } = { url: null };
  await magicLinkCapture.run(capture, () =>
    getAuth(env).api.signInMagicLink({ body: { email, callbackURL: '/', errorCallbackURL: '/?auth=sign-in' }, headers: request.headers }),
  );
  return capture.url ? redirect(capture.url) : signInWith(env, email);
}
