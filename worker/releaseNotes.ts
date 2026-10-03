/**
 * The release-notes email (marketing, so always with one-click unsubscribe). Members get each
 * edition once: automatically right after they finish signing up, and existing members when an
 * admin sends the current edition from the Waitlist page.
 *
 *   GET  /api/unsubscribe?e=<email>&s=<signature>   confirmation page (a GET never unsubscribes,
 *                                                     so link scanners can't opt people out)
 *   POST /api/unsubscribe?e=<email>&s=<signature>   unsubscribe (the page's button, and mail
 *                                                     clients' one-click List-Unsubscribe-Post)
 */
import type { Env } from './env.ts';
import { deliverInBackground, sendEmail } from './emails.ts';

/** The edition in emails/design/release-notes.html. Change it when that email changes. */
export const RELEASE_NOTES_EDITION = '2026-10';
/** Sends per admin request: Resend's free plan allows 100 emails a day across all mail. */
export const RELEASE_NOTES_BATCH = 40;

async function signature(env: Env, email: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.BETTER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`unsubscribe:release-notes:${email.toLowerCase()}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function unsubscribeUrl(env: Env, email: string): Promise<string> {
  const url = new URL('/api/unsubscribe', env.BETTER_AUTH_URL);
  url.searchParams.set('e', email.toLowerCase());
  url.searchParams.set('s', await signature(env, email));
  return url.href;
}

/**
 * Send the current edition to `email` unless they opted out or already have it. The send is
 * recorded first (insert-or-ignore), so concurrent triggers can't send twice.
 */
export async function sendReleaseNotes(env: Env, email: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const address = email.toLowerCase();
  const opted = await env.DB.prepare('select release_notes_opt_out as out from email_preference where email = ?').bind(address).first<{ out: number }>();
  if (opted?.out) return false;
  const claimed = await env.DB.prepare('insert into release_note_send (email, release, sent_at) values (?, ?, ?) on conflict do nothing')
    .bind(address, RELEASE_NOTES_EDITION, Date.now())
    .run();
  if (claimed.meta.changes !== 1) return false;
  const delivery = sendEmail(
    env,
    'release-notes',
    address,
    { actionUrl: new URL('/changelog', env.BETTER_AUTH_URL).href, unsubscribeUrl: await unsubscribeUrl(env, address) },
    `release-notes:${RELEASE_NOTES_EDITION}:${address}`,
  ).catch(async (error: unknown) => {
    // Not delivered: release the claim so the next send picks this member up again.
    await env.DB.prepare('delete from release_note_send where email = ? and release = ?').bind(address, RELEASE_NOTES_EDITION).run();
    throw error;
  });
  await deliverInBackground(delivery);
  return true;
}

/** Members (accounts with a verified email) who should still get the current edition. */
const PENDING = `from "user" u
  left join email_preference p on p.email = lower(u.email)
  left join release_note_send r on r.email = lower(u.email) and r.release = ?
  where u.emailVerified = 1 and coalesce(p.release_notes_opt_out, 0) = 0 and r.email is null`;

export async function pendingReleaseNotes(env: Env): Promise<number> {
  const row = await env.DB.prepare(`select count(*) as n ${PENDING}`).bind(RELEASE_NOTES_EDITION).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Send the current edition to up to one batch of pending members. */
export async function sendReleaseNotesBatch(env: Env): Promise<{ sent: number; remaining: number }> {
  const { results } = await env.DB.prepare(`select lower(u.email) as email ${PENDING} order by u.createdAt limit ?`)
    .bind(RELEASE_NOTES_EDITION, RELEASE_NOTES_BATCH)
    .all<{ email: string }>();
  let sent = 0;
  for (const { email } of results) if (await sendReleaseNotes(env, email)) sent++;
  return { sent, remaining: await pendingReleaseNotes(env) };
}

const page = (title: string, body: string, form = '') =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} • Plastic</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161616;color:rgb(255 255 255/.92);font:16px/1.6 Inter,system-ui,sans-serif}
main{max-width:420px;padding:32px}h1{margin:0 0 8px;font-size:24px;letter-spacing:-.02em}p{margin:0 0 20px;color:rgb(255 255 255/.66)}
button,a.b{display:inline-block;height:40px;padding:0 16px;border:0;border-radius:10px;background:#f2f2f2;color:#1e1e1e;font:500 14px/40px Inter,system-ui,sans-serif;text-decoration:none;cursor:pointer}a{color:inherit}</style></head>
<body><main><h1>${title}</h1><p>${body}</p>${form}</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } },
  );

export async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') ?? '').toLowerCase();
  const valid = email.length > 3 && email.length <= 254 && (url.searchParams.get('s') ?? '') === (await signature(env, email));
  if (!valid) return page('Link not recognized', 'This unsubscribe link is incomplete. Use the link in the latest release-notes email.');
  if (request.method === 'POST') {
    await env.DB.prepare(
      'insert into email_preference (email, release_notes_opt_out, updated_at) values (?, 1, ?) on conflict (email) do update set release_notes_opt_out = 1, updated_at = excluded.updated_at',
    )
      .bind(email, Date.now())
      .run();
    return page('You’re unsubscribed', 'You won’t get Plastic release notes anymore. Account emails, like sign-in links, still arrive.', '<a class="b" href="/">Back to Plastic</a>');
  }
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const escaped = email.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return page(
    'Unsubscribe from release notes?',
    `Stop sending Plastic release notes to ${escaped}. Account emails, like sign-in links, still arrive.`,
    `<form method="post"><button type="submit">Unsubscribe</button></form>`,
  );
}
