/**
 * Removes file revisions no project references anymore, so R2 storage stays proportional to
 * the projects themselves rather than to how often they were saved.
 *
 * Every save uploads changed files as new immutable revisions; the old ones become garbage once
 * the manifest moves on (and uploads whose commit lost a race never get referenced at all).
 * Deleting them right at commit would break editors still fetching the previous version, so a
 * scheduled sweep handles it instead:
 *
 * - Hourly: projects whose last save was 1–4 hours ago (idle, so nobody is mid-merge). One R2
 *   list per edited project; deletes are free. Missed runs are covered by the overlap.
 * - Weekly: everything saved in the last 8 days, plus the pre-revision (legacy) file copies.
 *
 * An object is deleted only when the current manifest doesn't reference it AND it was uploaded
 * more than an hour ago, so an upload whose commit is still on its way is never touched.
 */
import type { Env } from './env.ts';
import { parseVersions, projectPrefix, revisionKey } from './projects.ts';

const HOUR = 60 * 60 * 1000;
/** Superseded revisions stay readable this long; also the minimum age of anything deleted. */
export const GRACE_MS = HOUR;
export const WEEKLY_CRON = '0 4 * * SUN';
/** Projects swept per run (keeps one invocation small; the overlap catches the rest). */
const PROJECT_LIMIT = 500;

interface Row {
  owner_id: string;
  id: string;
  files: string;
}

export interface SweepResult {
  projects: number;
  deleted: number;
}

export async function sweepRevisions(env: Env, now: number, options: { lookbackMs: number; legacy?: boolean }): Promise<SweepResult> {
  const { results } = await env.DB.prepare('select owner_id, id, files from project where updated_at >= ? and updated_at < ? order by updated_at desc limit ?')
    .bind(now - GRACE_MS - options.lookbackMs, now - GRACE_MS, PROJECT_LIMIT)
    .all<Row>();
  let deleted = 0;
  for (const row of results) {
    try {
      deleted += await sweepProject(env, row, now, options.legacy ?? false);
    } catch (error) {
      // One project's failure must not stop the others; it is retried on the next run.
      console.error(`Revision sweep failed for a project: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  return { projects: results.length, deleted };
}

async function sweepProject(env: Env, row: Row, now: number, legacy: boolean): Promise<number> {
  const versions = parseVersions(row.files);
  // A manifest that can't be read means "keep everything", never "delete everything".
  if (!Object.keys(versions).length) return 0;
  const prefix = projectPrefix(row.owner_id, row.id);
  const keep = new Set(Object.entries(versions).map(([name, version]) => revisionKey(prefix, name, version)));
  const old = (o: R2Object) => o.uploaded.getTime() < now - GRACE_MS;
  const garbage: string[] = [];
  await list(env, `${prefix}revisions/`, undefined, (o) => {
    if (!keep.has(o.key) && old(o)) garbage.push(o.key);
  });
  if (legacy) {
    // Copies at the old mutable keys (<prefix><name>) are only served while the manifest still
    // points at their etag. Images live under assets/ and are not listed here (delimiter).
    await list(env, prefix, '/', (o) => {
      const name = o.key.slice(prefix.length);
      if (/\.(html|css|json)$/i.test(name) && versions[name] !== o.etag && old(o)) garbage.push(o.key);
    });
  }
  for (let i = 0; i < garbage.length; i += 1000) await env.FILES.delete(garbage.slice(i, i + 1000));
  return garbage.length;
}

async function list(env: Env, prefix: string, delimiter: string | undefined, visit: (o: R2Object) => void): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor, ...(delimiter ? { delimiter } : {}) });
    page.objects.forEach(visit);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** The Worker's cron entry point (see wrangler.jsonc triggers). */
export function scheduledSweep(env: Env, cron: string, now: number): Promise<SweepResult> {
  return cron === WEEKLY_CRON ? sweepRevisions(env, now, { lookbackMs: 8 * 24 * HOUR, legacy: true }) : sweepRevisions(env, now, { lookbackMs: 3 * HOUR });
}
