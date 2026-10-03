/**
 * Cloud projects, designed to stay inside Cloudflare's free allowances:
 *
 * - The project row in D1 holds a version (immutable content hash) per file, so listing and opening never list
 *   R2 (a "Class A" operation) — they're one indexed D1 query.
 * - File contents move as raw bodies uploaded/downloaded through R2. The Worker never parses or builds big
 *   JSON, which keeps every request far below the free plan's CPU limit.
 * - File URLs carry their version (?v=), so browsers cache them forever: thumbnails and unchanged
 *   files are downloaded once.
 * - A save uploads only changed files, then one small commit.
 *
 *   GET    /api/projects                         → { location, projects: [{ id, title, updatedAt, files, folderId, archivedAt }] }
 *   POST   /api/projects                         { title, assetsFrom? } → { id }
 *   GET    /api/projects/<id>                    → { files: { name: version } } (files: null if missing)
 *   GET    /api/projects/<id>/files/<name>?v=…   → the file (immutable when ?v is given)
 *   PUT    /api/projects/<id>/files/<name>       raw text, x-plastic-sha256: <hex> → { version }
 *   POST   /api/projects/<id>/commit             { files: { name: version }, title?, notify? } → 204
 *   GET    /api/projects/<id>/assets/<name>      → the image (names are content hashes: immutable)
 *   PUT    /api/projects/<id>/assets/<name>      raw bytes → 204
 *   GET    /api/projects/<id>/live?client=<id>   WebSocket for live sync (see live.ts)
 */
import type { Env } from './env.ts';
import { CLIENT_ID, room, withPeer } from './live.ts';
import { participantFor } from '../src/editor/presenceProtocol.ts';
import { deleteProject, placeProject, recordEdit } from './library.ts';

/** Same rules as the local workspace (server/projectStore.ts). */
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const FILE_NAME = /^[a-z0-9][a-z0-9_.-]*\.(html|css|json)$/i;
export const ASSET_NAME = /^[a-z0-9][a-z0-9_.-]*\.(png|jpe?g|gif|webp|avif|svg)$/i;
const ASSET_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
};
const FILE_TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8' };
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 500;
const LOCATION = 'Your account';
export const REVISION = /^[a-f0-9]{32,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
/** Hex SHA-256 of the upload body, computed by the browser and verified by R2. */
export const CHECKSUM_HEADER = 'x-plastic-sha256';
const LEGACY_UPLOAD_BYTES = 1024 * 1024;
export const revisionKey = (prefix: string, name: string, version: string) => `${prefix}revisions/${name}/${version}`;
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

const IMMUTABLE = 'private, max-age=31536000, immutable';

type Versions = Record<string, string>;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, message: string) => json({ error: message }, status);
const extension = (name: string) => name.split('.').pop()!.toLowerCase();

export const projectPrefix = (owner: string, id: string) => `users/${owner}/projects/${id}/`;

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'untitled';
}

export function parseVersions(text: string | null | undefined): Versions {
  try {
    const value = JSON.parse(text ?? '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([n, v]) => FILE_NAME.test(n) && typeof v === 'string')) as Versions;
  } catch {
    return {};
  }
}

function isVersions(value: unknown): value is Versions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_FILES && entries.every(([n, v]) => FILE_NAME.test(n) && typeof v === 'string' && v.length <= 64);
}

export interface Row {
  id: string;
  title: string;
  updated_at: number;
  files: string;
  preview_id?: string | null;
  folder_id?: string | null;
  archived_at?: number | null;
}

/**
 * Projects saved before versions were recorded have files = '{}'. List their R2 folder once and
 * store the versions; after that they never need a list again.
 */
export async function backfill(env: Env, owner: string, row: Row): Promise<Versions> {
  const known = parseVersions(row.files);
  if (Object.keys(known).length) return known;
  const prefix = projectPrefix(owner, row.id);
  const versions: Versions = {};
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor, delimiter: '/' });
    for (const o of page.objects) {
      const name = o.key.slice(prefix.length);
      if (FILE_NAME.test(name)) versions[name] = o.etag;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (Object.keys(versions).length) await env.DB.prepare('update project set files = ? where owner_id = ? and id = ?').bind(JSON.stringify(versions), owner, row.id).run();
  return versions;
}

async function getRow(env: Env, owner: string, id: string): Promise<Row | null> {
  return env.DB.prepare('select id, title, updated_at, files, preview_id from project where owner_id = ? and id = ?').bind(owner, id).first<Row>();
}

async function uniqueId(env: Env, owner: string, title: string): Promise<string> {
  const base = slugify(title);
  const { results } = await env.DB.prepare("select id from project where owner_id = ? and (id = ? or id like ? escape '\\')")
    .bind(owner, base, `${base.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`)
    .all<{ id: string }>();
  const taken = new Set(results.map((r) => r.id));
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(id)) return id;
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

async function readBody<T>(request: Request, limit = 256 * 1024): Promise<T | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null;
  return (await request.json().catch(() => null)) as T | null;
}

/** The signed-in person, as others in the file see them. */
export interface Member {
  readonly id: string;
  readonly name?: string | null;
  readonly image?: string | null;
}

/** One project file at a version (immutable when the version was asked for by URL). */
export async function serveFile(env: Env, prefix: string, name: string, version: string | undefined, immutable: boolean): Promise<Response> {
  let object = version ? await env.FILES.get(revisionKey(prefix, name, version)) : null;
  // Existing projects used mutable keys. Only serve legacy bytes if their etag matches.
  if (!object) {
    const legacy = await env.FILES.get(prefix + name);
    if (legacy && (!version || legacy.etag === version)) object = legacy;
  }
  if (!object) return error(404, 'No such revision.');
  return new Response(object.body, {
    headers: {
      'content-type': FILE_TYPES[extension(name)]!,
      'cache-control': immutable ? IMMUTABLE : 'no-store',
      etag: object.httpEtag,
      'x-content-type-options': 'nosniff',
      // HTML may be inspected/downloaded on the app origin without executing design code.
      ...(extension(name) === 'html' ? { 'content-security-policy': 'sandbox allow-same-origin' } : {}),
    },
  });
}

/** A project image (names are content hashes, so an image never changes under its URL). */
export async function serveAsset(env: Env, prefix: string, name: string): Promise<Response> {
  const object = await env.FILES.get(`${prefix}assets/${name}`);
  if (!object) return error(404, 'Not found.');
  return new Response(object.body, {
    headers: {
      'content-type': ASSET_TYPES[extension(name)] ?? 'application/octet-stream',
      'cache-control': IMMUTABLE,
      etag: object.httpEtag,
      // SVGs are images here, never documents that run script.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function handleProjects(request: Request, env: Env, owner: string, path: string[], user?: Member): Promise<Response> {
  const method = request.method;

  if (path.length === 0) {
    if (method === 'GET') {
      const { results } = await env.DB.prepare('select id, title, updated_at, files, folder_id, archived_at from project where owner_id = ? order by updated_at desc').bind(owner).all<Row>();
      const projects = await Promise.all(
        results.map(async (row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at, files: await backfill(env, owner, row), folderId: row.folder_id ?? null, archivedAt: row.archived_at ?? null })),
      );
      return json({ location: LOCATION, projects: projects.filter((p) => Object.keys(p.files).some((n) => n.endsWith('.html'))) });
    }
    if (method === 'POST') {
      const body = await readBody<{ title?: unknown; assetsFrom?: unknown; folderId?: unknown }>(request);
      if (!body) return error(400, 'Expected { title }.');
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : 'Untitled';
      const id = await uniqueId(env, owner, title);
      const now = Date.now();
      const folderId = typeof body.folderId === 'string' && (await env.DB.prepare('select 1 from folder where owner_id = ? and id = ?').bind(owner, body.folderId).first()) ? body.folderId : null;
      await env.DB.prepare("insert into project (owner_id, id, title, created_at, updated_at, files, folder_id) values (?, ?, ?, ?, ?, '{}', ?)").bind(owner, id, title, now, now, folderId).run();
      if (typeof body.assetsFrom === 'string' && PROJECT_ID.test(body.assetsFrom) && (await getRow(env, owner, body.assetsFrom))) await copyAssets(env, owner, body.assetsFrom, id);
      return json({ id }, 201);
    }
    return error(405, 'Method not allowed.');
  }

  const id = path[0]!;
  if (!PROJECT_ID.test(id)) return error(404, 'Not found.');
  const prefix = projectPrefix(owner, id);

  if (path.length === 2 && path[1] === 'place') {
    if (method !== 'PATCH') return error(405, 'Method not allowed.');
    return placeProject(request, env, owner, id);
  }

  if (path.length === 1) {
    if (method === 'DELETE') return deleteProject(env, owner, id);
    if (method !== 'GET') return error(405, 'Method not allowed.');
    const row = await getRow(env, owner, id);
    let previewId = row?.preview_id;
    if (row && !previewId) {
      const token = crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare('update project set preview_id = ? where owner_id = ? and id = ? and preview_id is null').bind(token, owner, id).run();
      previewId = (await getRow(env, owner, id))?.preview_id ?? token;
    }
    return json({ location: LOCATION, owner, previewId, files: row ? await backfill(env, owner, row) : null });
  }

  if (path.length === 3 && path[1] === 'files') {
    const name = path[2]!;
    if (!FILE_NAME.test(name)) return error(404, 'Not found.');
    if (method === 'GET') {
      const requested = new URL(request.url).searchParams.get('v');
      if (requested !== null && !REVISION.test(requested)) return error(400, 'Invalid revision.');
      const row = await getRow(env, owner, id);
      if (!row) return error(404, 'No such file.');
      return serveFile(env, prefix, name, requested ?? parseVersions(row.files)[name], requested !== null);
    }
    if (method === 'PUT') {
      const size = Number(request.headers.get('content-length') ?? NaN);
      if (!Number.isFinite(size)) return error(411, 'Content-Length is required.');
      if (size > MAX_FILE_BYTES) return error(413, 'Files can be up to 25 MB.');
      if (!(await getRow(env, owner, id))) return error(404, 'No such file.');
      const contentType = FILE_TYPES[extension(name)]!;
      const claimed = request.headers.get(CHECKSUM_HEADER)?.toLowerCase() ?? '';
      if (SHA256.test(claimed)) {
        // The browser hashes the file; the body streams straight into R2, which verifies the
        // checksum itself. The Worker never buffers or hashes the bytes (no CPU per megabyte).
        try {
          await env.FILES.put(revisionKey(prefix, name, claimed), request.body, { sha256: claimed, httpMetadata: { contentType } });
        } catch {
          return error(400, 'Checksum mismatch.');
        }
        return json({ version: claimed });
      }
      // Clients from before checksums (a tab left open across a deploy): hash here, small files only.
      if (size > LEGACY_UPLOAD_BYTES) return error(428, 'Reload Plastic to save this file.');
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > LEGACY_UPLOAD_BYTES) return error(413, 'Reload Plastic to save this file.');
      const version = hex(await crypto.subtle.digest('SHA-256', bytes));
      await env.FILES.put(revisionKey(prefix, name, version), bytes, { httpMetadata: { contentType } });
      return json({ version });
    }
    return error(405, 'Method not allowed.');
  }

  if (path.length === 2 && path[1] === 'commit') {
    if (method !== 'POST') return error(405, 'Method not allowed.');
    const body = await readBody<{ files?: unknown; title?: unknown; notify?: unknown; base?: unknown }>(request);
    if (!body || !isVersions(body.files) || !Object.keys(body.files).some((n) => n.endsWith('.html'))) return error(400, 'Expected { files: { name: version }, title? } with at least one page.');
    const row = await getRow(env, owner, id);
    if (!row) return error(404, 'No such file.');
    const before = parseVersions(row.files);
    if (body.base !== undefined && (!isVersions(body.base) || JSON.stringify(Object.entries(body.base).sort()) !== JSON.stringify(Object.entries(before).sort()))) return error(409, 'Project changed elsewhere.');
    const files = body.files;
    if (!Object.values(files).every((v) => REVISION.test(v))) return error(400, 'Invalid revision.');
    // Changed references must actually exist before publishing the new manifest.
    for (const [name, version] of Object.entries(files)) {
      if (before[name] === version) continue;
      const object = await env.FILES.head(revisionKey(prefix, name, version));
      if (!object) {
        const legacy = await env.FILES.head(prefix + name);
        if (!legacy || legacy.etag !== version) return error(400, 'Missing file revision.');
      }
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : row.title;
    const now = Date.now();
    const committed = await env.DB.prepare('update project set files = ?, title = ?, updated_at = ? where owner_id = ? and id = ? and files = ?').bind(JSON.stringify(files), title, now, owner, id, row.files).run();
    if (committed.meta.changes !== 1) return error(409, 'Project changed elsewhere.');
    await recordEdit(env, owner);
    // Superseded revisions stay readable for a while (editors may still be fetching them) and
    // are deleted by the scheduled sweep once the project has been idle (see cleanup.ts).
    // Editors with a live connection announce their own saves over it (much cheaper); the
    // server only notifies the room for saves made without one.
    if (body.notify === true) {
      const from = request.headers.get('x-plastic-client') ?? '';
      await room(env, owner, id).changed({ files, from: CLIENT_ID.test(from) ? from : '' });
    }
    return empty(204);
  }

  if (path.length === 2 && path[1] === 'live') {
    if (method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return error(426, 'Expected a WebSocket.');
    if (!(await getRow(env, owner, id))) return error(404, 'No such file.');
    const client = new URL(request.url).searchParams.get('client') ?? '';
    if (!CLIENT_ID.test(client)) return error(400, 'Invalid client.');
    return room(env, owner, id).fetch(withPeer(request, participantFor(client, { id: owner, name: user?.name, image: user?.image }, 'owner')));
  }

  if (path.length === 3 && path[1] === 'assets') {
    const name = path[2]!;
    if (!ASSET_NAME.test(name)) return error(404, 'Not found.');
    const key = `${prefix}assets/${name}`;
    if (method === 'GET') return serveAsset(env, prefix, name);
    if (method === 'PUT') {
      const size = Number(request.headers.get('content-length') ?? NaN);
      if (!Number.isFinite(size)) return error(411, 'Content-Length is required.');
      if (size > MAX_FILE_BYTES) return error(413, 'Images can be up to 25 MB.');
      if (!(await getRow(env, owner, id))) return error(404, 'No such file.');
      await env.FILES.put(key, request.body, { httpMetadata: { contentType: ASSET_TYPES[extension(name)] } });
      return empty(204);
    }
    return error(405, 'Method not allowed.');
  }

  return error(404, 'Not found.');
}
