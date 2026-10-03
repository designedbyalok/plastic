/**
 * The link in an "invite accepted" email. It's signed for one acceptance (the email and the
 * moment it was accepted) and works for INVITE_DAYS. Opening it mints a fresh one-time magic
 * link and signs the person straight in (see invites.ts), so the email can sit in an inbox for
 * days, and a mail scanner opening it first can't use it up for the real person.
 *
 * Cancelling or re-accepting an invite changes the acceptance moment, which voids older links.
 */
import type { Env } from './env.ts';

export const INVITE_DAYS = 7;

export async function inviteSignature(env: Env, email: string, invitedAt: number, expires: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`invite:${email.toLowerCase()}:${invitedAt}:${expires}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function inviteLink(env: Env, email: string, invitedAt: number, now = Date.now()): Promise<string> {
  const expires = now + INVITE_DAYS * 86_400_000;
  const url = new URL('/api/invite', env.BETTER_AUTH_URL);
  url.searchParams.set('e', email.toLowerCase());
  url.searchParams.set('t', String(invitedAt));
  url.searchParams.set('x', String(expires));
  url.searchParams.set('s', await inviteSignature(env, email, invitedAt, expires));
  return url.href;
}
