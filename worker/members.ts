/**
 * What one person costs to run, for the admin Waitlist page: account and sign-in history, files,
 * activity, and the R2 storage under their prefix. Everything here maps to something on the
 * Cloudflare bill: R2 storage and operations, D1 rows and writes, Worker requests.
 *
 *   GET /api/admin/members/<email>   admin → MemberDetails
 *
 * D1 work is one batch of indexed reads. Storage is measured by listing the person's R2 prefix,
 * which costs one Class A operation per 1,000 objects, so it only happens when an admin opens
 * the panel, and the listing stops at MAX_PAGES.
 */
import type { Env } from './env.ts';
import { parseVersions, projectPrefix, revisionKey } from './projects.ts';
import { RELEASE_NOTES_EDITION } from './releaseNotes.ts';

const MAX_PAGES = 10;
const DAY = 86_400_000;

interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
  createdAt: string;
}

export interface MemberDetails {
  email: string;
  waitlist: { joinedAt: number; source: string; invitedAt: number | null; role: string | null; teamSize: string | null; useCase: string | null } | null;
  account: {
    name: string;
    createdAt: string;
    emailVerified: boolean;
    signInMethods: string[];
    lastSignIn: string | null;
    lastActive: string | null;
    activeSessions: number;
    releaseNotes: { edition: string; received: boolean; unsubscribed: boolean };
    suspension: { startsAt: number; reason: string | null; by: string } | null;
  } | null;
  files: { active: number; archived: number; folders: number; lastEdited: number | null } | null;
  activity: { savesLast30Days: number; savesLast365Days: number; activeDaysLast30: number } | null;
  storage: {
    bytes: number;
    objects: number;
    current: { bytes: number; objects: number };
    oldVersions: { bytes: number; objects: number };
    images: { bytes: number; objects: number };
    /** True when the listing stopped at MAX_PAGES; the numbers are then lower bounds. */
    partial: boolean;
    listOperations: number;
  } | null;
}

export async function memberDetails(env: Env, email: string): Promise<MemberDetails> {
  const address = email.toLowerCase();
  const waitlist = await env.DB.prepare('select created_at, source, invited_at, role, team_size, use_case from waitlist where email = ?')
    .bind(address)
    .first<{ created_at: number; source: string; invited_at: number | null; role: string | null; team_size: string | null; use_case: string | null }>();
  const user = await env.DB.prepare('select id, name, email, emailVerified, createdAt from "user" where lower(email) = ?').bind(address).first<UserRow>();
  const base: MemberDetails = {
    email: address,
    waitlist: waitlist
      ? { joinedAt: waitlist.created_at, source: waitlist.source, invitedAt: waitlist.invited_at, role: waitlist.role, teamSize: waitlist.team_size, useCase: waitlist.use_case }
      : null,
    account: null,
    files: null,
    activity: null,
    storage: null,
  };
  if (!user) return base;

  const now = Date.now();
  const day = (offset: number) => new Date(now - offset * DAY).toISOString().slice(0, 10);
  const [providers, sessions, projects, folders, activity, releaseNotes, suspension] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare('select providerId from account where userId = ?').bind(user.id),
    env.DB.prepare(
      'select max(createdAt) as lastSignIn, max(updatedAt) as lastActive, sum(case when expiresAt > ? then 1 else 0 end) as active from session where userId = ?',
    ).bind(new Date(now).toISOString(), user.id),
    env.DB.prepare(
      'select sum(case when archived_at is null then 1 else 0 end) as active, sum(case when archived_at is not null then 1 else 0 end) as archived, max(updated_at) as lastEdited from project where owner_id = ?',
    ).bind(user.id),
    env.DB.prepare('select count(*) as n from folder where owner_id = ?').bind(user.id),
    env.DB.prepare(
      'select sum(case when day >= ? then edits else 0 end) as d30, sum(edits) as d365, sum(case when day >= ? then 1 else 0 end) as days30 from activity where owner_id = ? and day >= ?',
    ).bind(day(30), day(30), user.id, day(365)),
    env.DB.prepare(
      'select (select count(*) from release_note_send where email = ? and release = ?) as received, (select release_notes_opt_out from email_preference where email = ?) as unsubscribed',
    ).bind(address, RELEASE_NOTES_EDITION, address),
    env.DB.prepare('select starts_at, reason, created_by from suspension where user_id = ?').bind(user.id),
  ]);
  const one = (result: D1Result<Record<string, unknown>> | undefined) => result?.results?.[0] ?? {};
  const num = (value: unknown) => Number(value ?? 0) || 0;
  const s = one(sessions);
  const p = one(projects);
  const a = one(activity);
  const r = one(releaseNotes);

  return {
    ...base,
    account: {
      name: user.name,
      createdAt: user.createdAt,
      emailVerified: Boolean(user.emailVerified),
      signInMethods: [...new Set((providers?.results ?? []).map((row) => (row.providerId === 'credential' ? 'password' : String(row.providerId))))],
      lastSignIn: (s.lastSignIn as string | null) ?? null,
      lastActive: (s.lastActive as string | null) ?? null,
      activeSessions: num(s.active),
      releaseNotes: { edition: RELEASE_NOTES_EDITION, received: num(r.received) > 0, unsubscribed: num(r.unsubscribed) > 0 },
      suspension: suspension?.results?.[0]
        ? { startsAt: num(one(suspension).starts_at), reason: (one(suspension).reason as string | null) ?? null, by: String(one(suspension).created_by) }
        : null,
    },
    files: { active: num(p.active), archived: num(p.archived), folders: num(one(folders).n), lastEdited: (p.lastEdited as number | null) ?? null },
    activity: { savesLast30Days: num(a.d30), savesLast365Days: num(a.d365), activeDaysLast30: num(a.days30) },
    storage: await measureStorage(env, user.id),
  };
}

/** Sum the person's R2 objects: files the manifests point at, older versions awaiting cleanup, and images. */
async function measureStorage(env: Env, owner: string): Promise<NonNullable<MemberDetails['storage']>> {
  const { results } = await env.DB.prepare('select id, files from project where owner_id = ?').bind(owner).all<{ id: string; files: string }>();
  const current = new Set<string>();
  const legacy = new Map<string, string>();
  for (const row of results) {
    const prefix = projectPrefix(owner, row.id);
    for (const [name, version] of Object.entries(parseVersions(row.files))) {
      current.add(revisionKey(prefix, name, version));
      legacy.set(prefix + name, version);
    }
  }
  const totals = { current: { bytes: 0, objects: 0 }, oldVersions: { bytes: 0, objects: 0 }, images: { bytes: 0, objects: 0 } };
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await env.FILES.list({ prefix: `users/${owner}/`, cursor });
    pages++;
    for (const object of page.objects) {
      const bucket = object.key.includes('/assets/') || object.key.startsWith(`users/${owner}/avatar/`)
        ? totals.images
        : current.has(object.key) || legacy.get(object.key) === object.etag
          ? totals.current
          : totals.oldVersions;
      bucket.bytes += object.size;
      bucket.objects++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && pages < MAX_PAGES);
  const all = [totals.current, totals.oldVersions, totals.images];
  return {
    bytes: all.reduce((n, t) => n + t.bytes, 0),
    objects: all.reduce((n, t) => n + t.objects, 0),
    ...totals,
    partial: Boolean(cursor),
    listOperations: pages,
  };
}
