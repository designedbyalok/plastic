/**
 * The library around projects: folders, the archive, and the activity behind the profile page.
 * All cheap D1 operations scoped to the session's user.
 *
 *   GET    /api/folders                  → { folders: [{ id, name, createdAt }] }
 *   POST   /api/folders                  { name } → { folder }
 *   PATCH  /api/folders/<id>             { name } → 204
 *   DELETE /api/folders/<id>             → 204 (its files move back to Files)
 *   PATCH  /api/projects/<id>/place      { folderId?: string | null, archived?: boolean } → 204
 *   DELETE /api/projects/<id>            → 204 (archived files only; removes its storage)
 *   GET    /api/activity                 → { days: { "YYYY-MM-DD": edits }, files }
 */
import type { Env } from './env.ts';

const FOLDER_ID = /^[a-z0-9]{8,32}$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, message: string) => json({ error: message }, status);

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

async function body<T>(request: Request): Promise<T | null> {
  if (Number(request.headers.get('content-length') ?? 0) > 16 * 1024) return null;
  return (await request.json().catch(() => null)) as T | null;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, 120);
  return name || null;
}

/** Count one edit for today (UTC). Called on every commit: a single upsert. */
export async function recordEdit(env: Env, owner: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare('insert into activity (owner_id, day, edits) values (?, ?, 1) on conflict (owner_id, day) do update set edits = edits + 1').bind(owner, day).run();
}

export async function handleFolders(request: Request, env: Env, owner: string, path: string[]): Promise<Response> {
  const method = request.method;
  if (path.length === 0) {
    if (method === 'GET') {
      const { results } = await env.DB.prepare('select id, name, created_at from folder where owner_id = ? order by name collate nocase').bind(owner).all<{ id: string; name: string; created_at: number }>();
      return json({ folders: results.map((f) => ({ id: f.id, name: f.name, createdAt: f.created_at })) });
    }
    if (method === 'POST') {
      const name = cleanName((await body<{ name?: unknown }>(request))?.name);
      if (!name) return error(400, 'A folder needs a name.');
      const folder = { id: newId(), name, createdAt: Date.now() };
      await env.DB.prepare('insert into folder (owner_id, id, name, created_at) values (?, ?, ?, ?)').bind(owner, folder.id, folder.name, folder.createdAt).run();
      return json({ folder }, 201);
    }
    return error(405, 'Method not allowed.');
  }
  const id = path[0]!;
  if (!FOLDER_ID.test(id) || path.length > 1) return error(404, 'Not found.');
  if (method === 'PATCH') {
    const name = cleanName((await body<{ name?: unknown }>(request))?.name);
    if (!name) return error(400, 'A folder needs a name.');
    const result = await env.DB.prepare('update folder set name = ? where owner_id = ? and id = ?').bind(name, owner, id).run();
    return result.meta.changes ? empty(204) : error(404, 'No such folder.');
  }
  if (method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('update project set folder_id = null where owner_id = ? and folder_id = ?').bind(owner, id),
      env.DB.prepare('delete from folder where owner_id = ? and id = ?').bind(owner, id),
    ]);
    return empty(204);
  }
  return error(405, 'Method not allowed.');
}

/** PATCH /api/projects/<id>/place: move into a folder and/or archive/restore. */
export async function placeProject(request: Request, env: Env, owner: string, id: string): Promise<Response> {
  const input = await body<{ folderId?: unknown; archived?: unknown }>(request);
  if (!input) return error(400, 'Expected { folderId?, archived? }.');
  const sets: string[] = [];
  const values: unknown[] = [];
  if ('folderId' in input) {
    const folderId = input.folderId === null ? null : typeof input.folderId === 'string' && FOLDER_ID.test(input.folderId) ? input.folderId : undefined;
    if (folderId === undefined) return error(400, 'Unknown folder.');
    if (folderId && !(await env.DB.prepare('select 1 from folder where owner_id = ? and id = ?').bind(owner, folderId).first())) return error(404, 'No such folder.');
    sets.push('folder_id = ?');
    values.push(folderId);
  }
  if (typeof input.archived === 'boolean') {
    sets.push('archived_at = ?');
    values.push(input.archived ? Date.now() : null);
  }
  if (!sets.length) return error(400, 'Nothing to change.');
  const result = await env.DB.prepare(`update project set ${sets.join(', ')} where owner_id = ? and id = ?`).bind(...values, owner, id).run();
  return result.meta.changes ? empty(204) : error(404, 'No such file.');
}

/** DELETE /api/projects/<id>: permanently remove an archived file and everything it stored. */
export async function deleteProject(env: Env, owner: string, id: string): Promise<Response> {
  if (!PROJECT_ID.test(id)) return error(404, 'Not found.');
  const row = await env.DB.prepare('select archived_at from project where owner_id = ? and id = ?').bind(owner, id).first<{ archived_at: number | null }>();
  if (!row) return error(404, 'No such file.');
  if (!row.archived_at) return error(409, 'Archive a file before deleting it.');
  const prefix = `users/${owner}/projects/${id}/`;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor });
    if (page.objects.length) await env.FILES.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.DB.prepare('delete from project where owner_id = ? and id = ?').bind(owner, id).run();
  return empty(204);
}

export async function activity(env: Env, owner: string): Promise<Response> {
  const since = new Date(Date.now() - 371 * 86_400_000).toISOString().slice(0, 10);
  const [days, files] = await env.DB.batch<{ day?: string; edits?: number; files?: number }>([
    env.DB.prepare('select day, edits from activity where owner_id = ? and day >= ? order by day').bind(owner, since),
    env.DB.prepare('select count(*) as files from project where owner_id = ? and archived_at is null').bind(owner),
  ]);
  return json({
    days: Object.fromEntries((days!.results ?? []).map((r) => [r.day, r.edits])),
    files: files!.results?.[0]?.files ?? 0,
  });
}
