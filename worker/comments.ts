/**
 * Comments on a file, like Figma's and Paper's: pins on the canvas, each the start of a thread
 * with replies. They live in D1 beside the file (never in its HTML), so commenting doesn't
 * touch the design or its history, and each comment carries its author (name and photo).
 *
 *   GET    …/comments                      → { me, owner, threads: Thread[] }
 *   POST   …/comments                      { body, page, nodeId?, x?, y?, worldX, worldY } → Thread
 *   POST   …/comments/<thread>             { body } (a reply) → Comment
 *   PATCH  …/comments/<thread>             { resolved } | { nodeId?, x?, y?, worldX, worldY } → 204
 *   PATCH  …/comments/<thread>/<comment>   { body } (its author only) → 204
 *   DELETE …/comments/<thread>             the whole thread (its author or the file's owner) → 204
 *   DELETE …/comments/<thread>/<comment>   one reply (its author or the file's owner) → 204
 *
 * After a change, open editors of the file are told over the live room and fetch again.
 */
import type { Env } from './env.ts';
import { room } from './live.ts';

const ID = /^[a-f0-9]{32}$/;
const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE = /^[a-z0-9][a-z0-9_.-]*\.html$/i;
export const MAX_BODY = 4000;
const MAX_THREADS = 1000;
const MAX_REPLIES = 500;

export interface CommentAuthor { readonly id: string; readonly name: string; readonly image: string | null }
export interface CommentItem { readonly id: string; readonly author: CommentAuthor; readonly body: string; readonly createdAt: number; readonly editedAt: number | null }
export interface CommentThread {
  readonly id: string;
  readonly page: string;
  readonly nodeId: string | null;
  readonly x: number;
  readonly y: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly resolvedAt: number | null;
  readonly comments: CommentItem[];
}

interface Row {
  id: string; thread_id: string; author_id: string; body: string; created_at: number; edited_at: number | null;
  page: string | null; node_id: string | null; x: number | null; y: number | null; world_x: number | null; world_y: number | null;
  resolved_at: number | null; name: string | null; email: string | null; image: string | null;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const empty = (status = 204) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, message: string) => json({ error: message }, status);
const newId = () => crypto.randomUUID().replace(/-/g, '');
const finite = (value: unknown, limit = 1e7): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/** Trimmed text within the limit, or null. Line breaks are kept; other control characters aren't. */
export function cleanBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const body = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  return body && body.length <= MAX_BODY ? body : null;
}

/** Where a pin goes: a layer and an offset in it, plus its canvas position as a fallback. */
export function cleanAnchor(value: Record<string, unknown>): { nodeId: string | null; x: number; y: number; worldX: number; worldY: number } | null {
  if (!finite(value.worldX) || !finite(value.worldY)) return null;
  const nodeId = typeof value.nodeId === 'string' && NODE_ID.test(value.nodeId) ? value.nodeId : null;
  const x = nodeId && finite(value.x, 1e6) ? value.x : 0;
  const y = nodeId && finite(value.y, 1e6) ? value.y : 0;
  return { nodeId, x, y, worldX: value.worldX, worldY: value.worldY };
}

function threads(rows: Row[]): CommentThread[] {
  const byThread = new Map<string, { root?: Row; comments: CommentItem[] }>();
  for (const row of rows) {
    const entry = byThread.get(row.thread_id) ?? { comments: [] };
    if (row.id === row.thread_id) entry.root = row;
    entry.comments.push({
      id: row.id,
      author: { id: row.author_id, name: row.name || row.email?.split('@')[0] || 'Someone', image: row.image },
      body: row.body,
      createdAt: row.created_at,
      editedAt: row.edited_at,
    });
    byThread.set(row.thread_id, entry);
  }
  return [...byThread.values()].flatMap(({ root, comments }) => {
    // A thread without its first comment (its author's account was deleted) has no pin.
    if (!root?.page) return [];
    return [{
      id: root.id, page: root.page, nodeId: root.node_id, x: root.x ?? 0, y: root.y ?? 0,
      worldX: root.world_x ?? 0, worldY: root.world_y ?? 0, resolvedAt: root.resolved_at, comments,
    }];
  });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > 32 * 1024) return null;
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/**
 * `owner`/`project` name the file (already checked to exist and be readable by `actor`);
 * `actor` is the signed-in person commenting.
 */
export async function handleComments(request: Request, env: Env, owner: string, project: string, actor: string, path: string[]): Promise<Response> {
  const method = request.method;
  const exists = await env.DB.prepare('select 1 from project where owner_id = ? and id = ?').bind(owner, project).first();
  if (!exists) return error(404, 'No such file.');
  const changed = () => room(env, owner, project).signal('comments').catch(() => 0);

  if (path.length === 0) {
    if (method === 'GET') {
      const [rows, me] = await env.DB.batch<Row & { id: string; name: string | null; image: string | null }>([
        env.DB.prepare(
          `select c.id, c.thread_id, c.author_id, c.body, c.created_at, c.edited_at, c.page, c.node_id, c.x, c.y, c.world_x, c.world_y, c.resolved_at,
                  u.name, u.email, u.image
             from comment c join "user" u on u.id = c.author_id
            where c.owner_id = ? and c.project_id = ? order by c.created_at limit 20000`,
        ).bind(owner, project),
        env.DB.prepare('select id, name, email, image from "user" where id = ?').bind(actor),
      ]);
      const self = me!.results?.[0] as { id: string; name: string | null; email: string | null; image: string | null } | undefined;
      return json({
        me: { id: actor, name: self?.name || self?.email?.split('@')[0] || 'You', image: self?.image ?? null },
        owner,
        threads: threads((rows!.results ?? []) as Row[]),
      });
    }
    if (method === 'POST') {
      const input = await readBody(request);
      const body = cleanBody(input?.body);
      const anchor = input && cleanAnchor(input);
      const page = typeof input?.page === 'string' && PAGE.test(input.page) ? input.page : null;
      if (!body || !anchor || !page) return error(400, `Expected { body (up to ${MAX_BODY} characters), page, worldX, worldY }.`);
      const count = await env.DB.prepare('select count(*) as n from comment where owner_id = ? and project_id = ? and id = thread_id').bind(owner, project).first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_THREADS) return error(409, 'This file has too many comments. Resolve or delete some first.');
      const id = newId();
      const now = Date.now();
      await env.DB.prepare(
        `insert into comment (id, owner_id, project_id, thread_id, author_id, body, created_at, page, node_id, x, y, world_x, world_y)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, owner, project, id, actor, body, now, page, anchor.nodeId, anchor.x, anchor.y, anchor.worldX, anchor.worldY).run();
      await changed();
      return json({ id, createdAt: now }, 201);
    }
    return error(405, 'Method not allowed.');
  }

  const threadId = path[0]!;
  if (!ID.test(threadId) || path.length > 2) return error(404, 'Not found.');
  const root = await env.DB.prepare('select author_id, resolved_at from comment where id = ? and thread_id = ? and owner_id = ? and project_id = ?')
    .bind(threadId, threadId, owner, project).first<{ author_id: string; resolved_at: number | null }>();
  if (!root) return error(404, 'That comment was deleted.');

  if (path.length === 1) {
    if (method === 'POST') {
      const body = cleanBody((await readBody(request))?.body);
      if (!body) return error(400, `Expected { body } (up to ${MAX_BODY} characters).`);
      const count = await env.DB.prepare('select count(*) as n from comment where thread_id = ?').bind(threadId).first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_REPLIES) return error(409, 'This thread is full. Start a new comment.');
      const id = newId();
      const now = Date.now();
      // Replying reopens a resolved thread, as in Figma.
      await env.DB.batch([
        env.DB.prepare('insert into comment (id, owner_id, project_id, thread_id, author_id, body, created_at) values (?, ?, ?, ?, ?, ?, ?)')
          .bind(id, owner, project, threadId, actor, body, now),
        env.DB.prepare('update comment set resolved_at = null, resolved_by = null where id = ?').bind(threadId),
      ]);
      await changed();
      return json({ id, createdAt: now }, 201);
    }
    if (method === 'PATCH') {
      const input = await readBody(request);
      if (!input) return error(400, 'Expected { resolved } or a new position.');
      if (typeof input.resolved === 'boolean') {
        await env.DB.prepare('update comment set resolved_at = ?, resolved_by = ? where id = ?')
          .bind(input.resolved ? Date.now() : null, input.resolved ? actor : null, threadId).run();
      } else {
        const anchor = cleanAnchor(input);
        if (!anchor) return error(400, 'Expected { resolved } or { worldX, worldY }.');
        if (root.author_id !== actor && owner !== actor) return error(403, 'Only its author can move this comment.');
        await env.DB.prepare('update comment set node_id = ?, x = ?, y = ?, world_x = ?, world_y = ? where id = ?')
          .bind(anchor.nodeId, anchor.x, anchor.y, anchor.worldX, anchor.worldY, threadId).run();
      }
      await changed();
      return empty();
    }
    if (method === 'DELETE') {
      if (root.author_id !== actor && owner !== actor) return error(403, 'Only its author or the file’s owner can delete this thread.');
      await env.DB.prepare('delete from comment where thread_id = ? and owner_id = ? and project_id = ?').bind(threadId, owner, project).run();
      await changed();
      return empty();
    }
    return error(405, 'Method not allowed.');
  }

  const commentId = path[1]!;
  if (!ID.test(commentId)) return error(404, 'Not found.');
  const comment = await env.DB.prepare('select author_id from comment where id = ? and thread_id = ?').bind(commentId, threadId).first<{ author_id: string }>();
  if (!comment) return error(404, 'That comment was deleted.');
  if (method === 'PATCH') {
    if (comment.author_id !== actor) return error(403, 'Only its author can edit this comment.');
    const body = cleanBody((await readBody(request))?.body);
    if (!body) return error(400, `Expected { body } (up to ${MAX_BODY} characters).`);
    await env.DB.prepare('update comment set body = ?, edited_at = ? where id = ?').bind(body, Date.now(), commentId).run();
    await changed();
    return empty();
  }
  if (method === 'DELETE') {
    if (comment.author_id !== actor && owner !== actor) return error(403, 'Only its author or the file’s owner can delete this comment.');
    // The first comment is the thread: deleting it deletes the thread.
    if (commentId === threadId) await env.DB.prepare('delete from comment where thread_id = ?').bind(threadId).run();
    else await env.DB.prepare('delete from comment where id = ?').bind(commentId).run();
    await changed();
    return empty();
  }
  return error(405, 'Method not allowed.');
}
