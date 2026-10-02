/**
 * Cloud projects: the same folder of files as a local workspace project, stored in R2 under the
 * signed-in user's prefix, with a D1 row per project for listing. Every route is scoped to the
 * session's user, so ownership is the key itself — no cross-user path can be formed.
 *
 *   GET    /api/projects                        → { location, projects: [{ id, updatedAt, files }] }
 *                                                  (files: the parts thumbnails need)
 *   POST   /api/projects                        { title, files, assetsFrom? } → { id }
 *   GET    /api/projects/<id>                   → { location, files }
 *   PUT    /api/projects/<id>                   { files: changed, names: all } → 204
 *   GET    /api/projects/<id>/assets/<name>     → the image
 *   PUT    /api/projects/<id>/assets/<name>     raw bytes → 204
 */
import type { Env } from './env.ts';

/** Same rules as the local workspace (server/projectStore.ts). */
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE_NAME = /^[a-z0-9][a-z0-9_.-]*\.(html|css|json)$/i;
const ASSET_NAME = /^[a-z0-9][a-z0-9_.-]*\.(png|jpe?g|gif|webp|avif|svg)$/i;
const ASSET_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
};
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const LOCATION = 'Your account';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, message: string) => json({ error: message }, status);

const projectPrefix = (owner: string, id: string) => `users/${owner}/projects/${id}/`;

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'untitled';
}

function titleOf(files: Record<string, string>): string | null {
  const html = files['index.html'] ?? Object.entries(files).find(([n]) => n.endsWith('.html'))?.[1];
  const match = html ? /<title>([^<]*)<\/title>/i.exec(html) : null;
  return match ? match[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() : null;
}

function isFiles(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([name, text]) => FILE_NAME.test(name) && typeof text === 'string' && text.length <= MAX_FILE_BYTES);
}

/** The text files of a project (no assets). */
async function readFiles(env: Env, owner: string, id: string, only?: (name: string) => boolean): Promise<Record<string, string>> {
  const prefix = projectPrefix(owner, id);
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor, delimiter: '/' });
    for (const o of page.objects) {
      const name = o.key.slice(prefix.length);
      if (FILE_NAME.test(name) && (!only || only(name))) names.push(name);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const files: Record<string, string> = {};
  await Promise.all(
    names.map(async (name) => {
      const object = await env.FILES.get(prefix + name);
      if (object) files[name] = await object.text();
    }),
  );
  return files;
}

async function exists(env: Env, owner: string, id: string): Promise<boolean> {
  const row = await env.DB.prepare('select 1 from project where owner_id = ? and id = ?').bind(owner, id).first();
  return row !== null;
}

async function uniqueId(env: Env, owner: string, title: string): Promise<string> {
  const base = slugify(title);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!(await exists(env, owner, id))) return id;
  }
}

async function copyAssets(env: Env, owner: string, from: string, to: string): Promise<void> {
  const source = `${projectPrefix(owner, from)}assets/`;
  const target = `${projectPrefix(owner, to)}assets/`;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: source, cursor });
    for (const o of page.objects) {
      const object = await env.FILES.get(o.key);
      if (object) await env.FILES.put(target + o.key.slice(source.length), object.body, { httpMetadata: object.httpMetadata });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** Thumbnails render the first page with the shared CSS; send just those parts in listings. */
function thumbnailFiles(name: string): boolean {
  return name === 'index.html' || name === 'project.json' || name === 'styles.css' || name === 'tokens.css';
}

export async function handleProjects(request: Request, env: Env, owner: string, path: string[]): Promise<Response> {
  const method = request.method;

  if (path.length === 0) {
    if (method === 'GET') {
      const { results } = await env.DB.prepare('select id, updated_at from project where owner_id = ? order by updated_at desc').bind(owner).all<{ id: string; updated_at: number }>();
      const projects = await Promise.all(results.map(async (p) => ({ id: p.id, updatedAt: p.updated_at, files: await readFiles(env, owner, p.id, thumbnailFiles) })));
      return json({ location: LOCATION, projects: projects.filter((p) => Object.keys(p.files).some((n) => n.endsWith('.html'))) });
    }
    if (method === 'POST') {
      const body = (await request.json().catch(() => null)) as { title?: unknown; files?: unknown; assetsFrom?: unknown } | null;
      if (!body || !isFiles(body.files) || !Object.keys(body.files).some((n) => n.endsWith('.html'))) return error(400, 'Expected { title, files: { "index.html": "…", … } }.');
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled';
      const id = await uniqueId(env, owner, title);
      if (typeof body.assetsFrom === 'string' && PROJECT_ID.test(body.assetsFrom) && (await exists(env, owner, body.assetsFrom))) await copyAssets(env, owner, body.assetsFrom, id);
      const prefix = projectPrefix(owner, id);
      await Promise.all(Object.entries(body.files).map(([name, text]) => env.FILES.put(prefix + name, text)));
      const now = Date.now();
      await env.DB.prepare('insert into project (owner_id, id, title, created_at, updated_at) values (?, ?, ?, ?, ?)').bind(owner, id, title, now, now).run();
      return json({ id }, 201);
    }
    return error(405, 'Method not allowed.');
  }

  const id = path[0]!;
  if (!PROJECT_ID.test(id)) return error(404, 'Not found.');
  const prefix = projectPrefix(owner, id);

  if (path.length === 1) {
    if (method === 'GET') {
      if (!(await exists(env, owner, id))) return json({ location: LOCATION, files: null });
      return json({ location: LOCATION, files: await readFiles(env, owner, id) });
    }
    if (method === 'PUT') {
      if (!(await exists(env, owner, id))) return error(404, 'No such file.');
      const body = (await request.json().catch(() => null)) as { files?: unknown; names?: unknown } | null;
      if (!body || !isFiles(body.files) || !Array.isArray(body.names) || !body.names.every((n) => typeof n === 'string')) {
        return error(400, 'Expected { files: { changed… }, names: [every file name] }.');
      }
      const names = new Set(body.names as string[]);
      if (![...names].some((n) => n.endsWith('.html'))) return error(400, 'A project needs at least one page.');
      await Promise.all(Object.entries(body.files).map(([name, text]) => env.FILES.put(prefix + name, text)));
      // Pages that no longer exist (deleted in the editor) are removed.
      const current = await env.FILES.list({ prefix, delimiter: '/' });
      const stale = current.objects.map((o) => o.key.slice(prefix.length)).filter((n) => n.endsWith('.html') && FILE_NAME.test(n) && !names.has(n));
      if (stale.length) await env.FILES.delete(stale.map((n) => prefix + n));
      const title = titleOf(body.files);
      const now = Date.now();
      await (title
        ? env.DB.prepare('update project set updated_at = ?, title = ? where owner_id = ? and id = ?').bind(now, title, owner, id)
        : env.DB.prepare('update project set updated_at = ? where owner_id = ? and id = ?').bind(now, owner, id)
      ).run();
      return empty(204);
    }
    return error(405, 'Method not allowed.');
  }

  if (path.length === 3 && path[1] === 'assets') {
    const name = path[2]!;
    if (!ASSET_NAME.test(name)) return error(404, 'Not found.');
    const key = `${prefix}assets/${name}`;
    if (method === 'GET') {
      const object = await env.FILES.get(key);
      if (!object) return error(404, 'Not found.');
      return new Response(object.body, {
        headers: {
          'content-type': ASSET_TYPES[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'private, max-age=3600',
          etag: object.httpEtag,
          // SVGs are images here, never documents that run script.
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
        },
      });
    }
    if (method === 'PUT') {
      if (!(await exists(env, owner, id))) return error(404, 'No such file.');
      const size = Number(request.headers.get('content-length') ?? 0);
      if (size > MAX_FILE_BYTES) return error(413, 'Images can be up to 25 MB.');
      await env.FILES.put(key, request.body, { httpMetadata: { contentType: ASSET_TYPES[name.split('.').pop()!.toLowerCase()] } });
      return empty(204);
    }
    return error(405, 'Method not allowed.');
  }

  return error(404, 'Not found.');
}
