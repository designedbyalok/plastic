/**
 * The waitlist and invites. Plastic is invite-only so resources go to people actually using it:
 *
 *   POST /api/waitlist                 public  { email, name?, role?, teamSize?, useCase?, source? } → { ok }
 *                                              (a new address gets a thank-you email, within a daily cap)
 *   GET  /api/admin/waitlist           admin   ?filter=waiting|invited|joined|rejected|all&before=<ms> → { entries, next, counts }
 *   POST /api/admin/decide             admin   { email, action: accept|reject|cancel|restore } → { ok, emailed? }
 *   POST /api/admin/invite             admin   { email } → add someone directly and accept them → { ok, emailed }
 *   POST /api/admin/suspend|unsuspend  admin   see suspensions.ts
 *   POST /api/admin/release-notes      admin   send the current edition to members who haven't had it → { sent, remaining }
 *   GET  /api/admin/members/<email>    admin   sign-ins, files, activity and storage for one person (see members.ts)
 *
 * Joining costs one D1 write (a repeat is a no-op) and the answer never reveals whether an email
 * was already listed. Admins are the emails in ADMIN_EMAILS.
 */
import type { Env } from './env.ts';
import { deliverInBackground, sendEmail } from './emails.ts';
import { RELEASE_NOTES_EDITION, pendingReleaseNotes, sendReleaseNotesBatch } from './releaseNotes.ts';
import { checkEmail } from './emailCheck.ts';
import { inviteLink } from './inviteLink.ts';
import { suspend, unsuspend } from './suspensions.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, message: string) => json({ error: message }, status);

export const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const ROLES = ['designer', 'engineer', 'design-engineer', 'product', 'founder', 'student', 'other'];
const TEAM_SIZES = ['solo', '2-10', '11-50', '51-200', '200+'];
const SOURCES = ['home', 'download', 'changelog', 'sign-in'];
const MAX_BODY = 4096;
/**
 * Thank-you emails per rolling day. Resend's free plan allows 100 emails a day, shared with
 * sign-in, verification and invite emails, so a burst of sign-ups (or someone submitting other
 * people's addresses) can never use up the allowance account emails depend on. Over the cap,
 * people still join the list; they just don't get the thank-you.
 */
const THANKS_PER_DAY = 60;
const PAGE = 50;

export const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
};

const pick = (value: unknown, allowed: readonly string[]) => (typeof value === 'string' && allowed.includes(value) ? value : null);
const text = (value: unknown, max: number) => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
};

export function isAdmin(env: Env, email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

/** May this email create an account? Admins always; everyone else once invited. */
export async function canCreateAccount(env: Env, email: string): Promise<boolean> {
  if (isAdmin(env, email)) return true;
  const row = await env.DB.prepare('select invited_at from waitlist where email = ?').bind(email.toLowerCase()).first<{ invited_at: number | null }>();
  return Boolean(row?.invited_at);
}

/** Pages a no-JavaScript form post may return to (fragment validated separately). */
const RETURN_PATHS = ['/', '/changelog', '/download'];

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const size = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isFinite(size) || size > MAX_BODY) return null;
  try {
    // The site's forms post JSON when JavaScript runs, and a plain form otherwise.
    if (request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))
      return Object.fromEntries(new URLSearchParams(await request.text()));
    const value = (await request.json()) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function joinWaitlist(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return error(405, 'Method not allowed.');
  // Only from this site's own forms.
  const origin = request.headers.get('origin');
  if (origin !== new URL(env.BETTER_AUTH_URL).origin && origin !== new URL(request.url).origin) return error(403, 'Cross-origin request.');
  const body = await readJson(request);
  if (!body) return error(400, 'Expected a small JSON body.');
  // A plain form post goes back to its page, where #<form>-joined shows the confirmation.
  const form = request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded');
  const back = form && typeof body.redirect === 'string' ? /^(\/[a-z]*)#([a-z-]{1,40})$/.exec(body.redirect) : null;
  const done = () =>
    back && RETURN_PATHS.includes(back[1]!) ? Response.redirect(new URL(`${back[1]}#${back[2]}`, request.url).href, 303) : json({ ok: true });
  // A hidden field people never see: bots that fill it get a success without a write.
  if (typeof body.website === 'string' && body.website) return done();
  const email = normalizeEmail(body.email);
  if (!email) return error(400, 'Enter a valid email address.');
  // Typos, temporary inboxes and domains that take no mail never reach the list (or an email).
  const problem = await checkEmail(email);
  if (problem) return json({ error: problem.message, reason: problem.reason, ...('suggestion' in problem ? { suggestion: problem.suggestion } : {}) }, 400);
  const now = Date.now();
  const added = await env.DB.prepare(
    'insert into waitlist (email, name, role, team_size, use_case, source, created_at) values (?, ?, ?, ?, ?, ?, ?) on conflict (email) do nothing',
  )
    .bind(email, text(body.name, 80), pick(body.role, ROLES), pick(body.teamSize, TEAM_SIZES), text(body.useCase, 500), pick(body.source, SOURCES) ?? 'home', now)
    .run();
  // A thank-you, once per address (a repeat sign-up sends nothing).
  if (added.meta.changes === 1 && env.RESEND_API_KEY) {
    const today = await env.DB.prepare('select count(*) as n from waitlist where created_at > ?').bind(now - 86_400_000).first<{ n: number }>();
    if ((today?.n ?? 0) <= THANKS_PER_DAY)
      await deliverInBackground(sendEmail(env, 'waitlist', email, { actionUrl: new URL('/changelog', env.BETTER_AUTH_URL).href }, `waitlist:${email}`));
  }
  // Same answer for new and existing emails, so the list can't be probed.
  return done();
}

interface Entry {
  email: string;
  name: string | null;
  role: string | null;
  team_size: string | null;
  use_case: string | null;
  source: string;
  created_at: number;
  invited_at: number | null;
  rejected_at: number | null;
  joined: number;
  suspension_starts_at: number | null;
}

/**
 * Where people are: Waiting (no decision yet) → Joined once accepted from the list (whether or
 * not they've signed in yet) or Rejected. People an admin added by email are Invited until they
 * sign up, then Joined.
 */
const FILTERS: Record<string, string> = {
  waiting: 'w.invited_at is null and w.rejected_at is null and u.id is null',
  invited: "w.invited_at is not null and u.id is null and w.source = 'admin'",
  joined: "u.id is not null or (w.invited_at is not null and w.source <> 'admin')",
  rejected: 'w.rejected_at is not null and u.id is null',
  all: '1 = 1',
};

/**
 * Accept someone: their invite stands from now, and they get the "invite accepted" email with a
 * link that signs them straight in. Returns whether the email went out.
 */
async function sendAcceptance(env: Env, email: string, invitedAt: number): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  await deliverInBackground(sendEmail(env, 'invite', email, { actionUrl: await inviteLink(env, email, invitedAt) }, `invite:${email}:${invitedAt}`));
  return true;
}

export async function handleAdmin(request: Request, env: Env, admin: { email: string; name: string }, path: string[]): Promise<Response> {
  if (!isAdmin(env, admin.email)) return error(403, 'Admins only.');
  const url = new URL(request.url);

  if (path[0] === 'waitlist' && path.length === 1) {
    if (request.method !== 'GET') return error(405, 'Method not allowed.');
    const filter = FILTERS[url.searchParams.get('filter') ?? 'waiting'] ?? FILTERS.waiting!;
    const before = Number(url.searchParams.get('before') ?? NaN);
    const { results } = await env.DB.prepare(
      `select w.email, w.name, w.role, w.team_size, w.use_case, w.source, w.created_at, w.invited_at, w.rejected_at, (u.id is not null) as joined,
         s.starts_at as suspension_starts_at
       from waitlist w left join "user" u on u.email = w.email left join suspension s on s.user_id = u.id
       where (${filter}) and w.created_at < ? order by w.created_at desc limit ?`,
    )
      .bind(Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, PAGE + 1)
      .all<Entry>();
    const counts = await env.DB.prepare(
      `select count(*) as total,
         sum(w.invited_at is null and w.rejected_at is null and u.id is null) as waiting,
         sum(w.invited_at is not null and u.id is null and w.source = 'admin') as invited,
         sum(u.id is not null or (w.invited_at is not null and w.source <> 'admin')) as joined,
         sum(w.rejected_at is not null and u.id is null) as rejected
       from waitlist w left join "user" u on u.email = w.email`,
    ).first<Record<string, number | null>>();
    const page = results.slice(0, PAGE);
    return json({
      entries: page.map((e) => ({
        email: e.email,
        name: e.name,
        role: e.role,
        teamSize: e.team_size,
        useCase: e.use_case,
        source: e.source,
        createdAt: e.created_at,
        invitedAt: e.invited_at,
        rejectedAt: e.rejected_at,
        joined: Boolean(e.joined),
        suspendedFrom: e.suspension_starts_at,
        admin: isAdmin(env, e.email),
      })),
      next: results.length > PAGE ? page[page.length - 1]!.created_at : null,
      counts: {
        total: counts?.total ?? 0,
        waiting: counts?.waiting ?? 0,
        invited: counts?.invited ?? 0,
        joined: counts?.joined ?? 0,
        rejected: counts?.rejected ?? 0,
      },
      mail: Boolean(env.RESEND_API_KEY),
      // Only where email can be sent (the Waitlist page shows the control only then).
      releaseNotes: env.RESEND_API_KEY ? { edition: RELEASE_NOTES_EDITION, pending: await pendingReleaseNotes(env) } : null,
    });
  }

  if (path[0] === 'invite' && path.length === 1) {
    if (request.method !== 'POST') return error(405, 'Method not allowed.');
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    if (!email) return error(400, 'Enter a valid email address.');
    const problem = await checkEmail(email);
    if (problem) return json({ error: problem.message, reason: problem.reason, ...('suggestion' in problem ? { suggestion: problem.suggestion } : {}) }, 400);
    const now = Date.now();
    // Add someone who isn't on the list (or accept them if they are) in one step.
    const changed = await env.DB.prepare(
      `insert into waitlist (email, source, created_at, invited_at, invited_by) values (?, 'admin', ?, ?, ?)
       on conflict (email) do update set invited_at = excluded.invited_at, invited_by = excluded.invited_by, rejected_at = null
       where waitlist.invited_at is null`,
    )
      .bind(email, now, now, admin.email)
      .run();
    if (changed.meta.changes !== 1) return json({ ok: true, emailed: false, already: true });
    return json({ ok: true, emailed: await sendAcceptance(env, email, now) });
  }

  if (path[0] === 'decide' && path.length === 1) {
    if (request.method !== 'POST') return error(405, 'Method not allowed.');
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    const action = body?.action;
    if (!email) return error(400, 'Enter a valid email address.');
    const row = await env.DB.prepare(
      'select w.source, w.invited_at, w.rejected_at, (u.id is not null) as joined from waitlist w left join "user" u on u.email = w.email where w.email = ?',
    )
      .bind(email)
      .first<{ source: string; invited_at: number | null; rejected_at: number | null; joined: number }>();
    if (!row) return error(404, 'That person isn’t on the waitlist.');
    if (row.joined) return error(409, 'They already have an account.');
    const now = Date.now();
    if (action === 'accept') {
      if (row.invited_at) return json({ ok: true, emailed: false, already: true });
      await env.DB.prepare('update waitlist set invited_at = ?, invited_by = ?, rejected_at = null where email = ?').bind(now, admin.email, email).run();
      return json({ ok: true, emailed: await sendAcceptance(env, email, now) });
    }
    if (action === 'reject') {
      // No email: they simply stay on the list without an invite, and can't re-join.
      await env.DB.prepare('update waitlist set rejected_at = ?, invited_at = null, invited_by = null where email = ?').bind(now, email).run();
      return json({ ok: true });
    }
    if (action === 'cancel') {
      if (!row.invited_at) return json({ ok: true, already: true });
      // Added by mistake (an admin typed it): remove them. From the list: back to waiting.
      // Either way invited_at is gone, so the emailed link and account creation stop working.
      if (row.source === 'admin') await env.DB.prepare('delete from waitlist where email = ?').bind(email).run();
      else await env.DB.prepare('update waitlist set invited_at = null, invited_by = null where email = ?').bind(email).run();
      return json({ ok: true, removed: row.source === 'admin' });
    }
    if (action === 'restore') {
      await env.DB.prepare('update waitlist set rejected_at = null where email = ?').bind(email).run();
      return json({ ok: true });
    }
    return error(400, 'Unknown action.');
  }

  if ((path[0] === 'suspend' || path[0] === 'unsuspend') && path.length === 1) {
    if (request.method !== 'POST') return error(405, 'Method not allowed.');
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    if (!email) return error(400, 'Enter a valid email address.');
    if (path[0] === 'unsuspend') {
      await unsuspend(env, email);
      return json({ ok: true });
    }
    const when = body?.when === '30d' ? '30d' : body?.when === 'now' ? 'now' : null;
    if (!when) return error(400, 'Choose when the suspension starts.');
    const result = await suspend(env, admin.email, email, when, text(body?.reason, 300));
    return 'error' in result ? error(result.status, result.error) : json(result);
  }

  if (path[0] === 'members' && path.length === 2) {
    if (request.method !== 'GET') return error(405, 'Method not allowed.');
    const email = normalizeEmail(path[1]);
    if (!email) return error(400, 'Enter a valid email address.');
    // Loaded on demand: it reads project storage (projects.ts and live sync), which the
    // waitlist and auth paths never need.
    const { memberDetails } = await import('./members.ts');
    return json(await memberDetails(env, email));
  }

  if (path[0] === 'release-notes' && path.length === 1) {
    if (request.method !== 'POST') return error(405, 'Method not allowed.');
    if (!env.RESEND_API_KEY) return error(503, 'Email isn’t configured on this server.');
    return json(await sendReleaseNotesBatch(env));
  }

  return error(404, 'Not found');
}
