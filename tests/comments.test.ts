import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { timeAgo } from '../src/comments/store';

const signal = vi.fn(async () => 1);
vi.mock('../worker/live.ts', () => ({ room: () => ({ signal }) }));

// Worker modules are imported by path so the browser typecheck doesn't pull in Worker types.
const commentsPath = '../worker/comments.ts';
const { handleComments, cleanBody, cleanAnchor } = await import(commentsPath);

const OWNER = 'owner1';
const OTHER = 'other1';

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec('create table "user" (id text primary key, name text, email text, image text)');
  database.exec('create table project (owner_id text, id text)');
  database.exec(readFileSync('migrations/0011_comments.sql', 'utf8'));
  database.exec(`insert into "user" values ('${OWNER}', 'Alok', 'alok@example.com', '/api/avatars/owner1/a.webp'), ('${OTHER}', '', 'sam@example.com', null)`);
  database.exec(`insert into project values ('${OWNER}', 'demo')`);
  const prepare = (sql: string) => {
    const statement = database.prepare(sql);
    const bound = (...args: never[]) => ({
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
    });
    return { bind: bound, ...bound() };
  };
  const DB = { prepare, batch: async (list: { all(): Promise<unknown> }[]) => Promise.all(list.map((s) => s.all())) };
  return { database, env: { DB } };
}

let env: { DB: unknown };
beforeEach(() => {
  env = setup().env;
  signal.mockClear();
});

const call = (method: string, path: string[] = [], body?: unknown, actor = OWNER) =>
  handleComments(
    new Request('https://plastic.test/api/projects/demo/comments', { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }),
    env, OWNER, 'demo', actor, path,
  ) as Promise<Response>;
const list = async (actor = OWNER) => (await (await call('GET', [], undefined, actor)).json()) as {
  me: { id: string; name: string; image: string | null };
  threads: { id: string; nodeId: string | null; x: number; resolvedAt: number | null; comments: { id: string; body: string; author: { name: string; image: string | null } }[] }[];
};

it('creates threads with replies, carrying each author’s name and photo', async () => {
  const created = await call('POST', [], { body: '  Tighten this  ', page: 'index.html', nodeId: 'abc123', x: 12, y: 8, worldX: 100, worldY: 200 });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect((await call('POST', [id], { body: 'On it' }, OTHER)).status).toBe(201);
  const data = await list();
  expect(data.me).toEqual({ id: OWNER, name: 'Alok', image: '/api/avatars/owner1/a.webp' });
  expect(data.threads).toHaveLength(1);
  const thread = data.threads[0]!;
  expect(thread.nodeId).toBe('abc123');
  expect(thread.comments.map((c) => [c.body, c.author.name, c.author.image])).toEqual([
    ['Tighten this', 'Alok', '/api/avatars/owner1/a.webp'],
    ['On it', 'sam', null],
  ]);
  expect(signal).toHaveBeenCalledTimes(2);
});

it('resolves, reopens on reply, and limits editing and deleting to the right people', async () => {
  const { id } = (await (await call('POST', [], { body: 'Hi', page: 'index.html', worldX: 0, worldY: 0 }, OTHER)).json()) as { id: string };
  expect((await call('PATCH', [id], { resolved: true })).status).toBe(204);
  expect((await list()).threads[0]!.resolvedAt).toBeGreaterThan(0);
  const reply = (await (await call('POST', [id], { body: 'Wait' })).json()) as { id: string };
  expect((await list()).threads[0]!.resolvedAt).toBeNull();

  // Only the author edits; the owner can still delete anyone's comment.
  expect((await call('PATCH', [id, reply.id], { body: 'Edited' }, OTHER)).status).toBe(403);
  expect((await call('PATCH', [id, reply.id], { body: 'Edited' })).status).toBe(204);
  expect((await list()).threads[0]!.comments[1]!.body).toBe('Edited');
  expect((await call('DELETE', [id, reply.id], undefined, OTHER)).status).toBe(403);
  expect((await call('DELETE', [id])).status).toBe(204);
  expect((await list()).threads).toEqual([]);
});

it('rejects empty, oversized and badly placed comments', async () => {
  expect((await call('POST', [], { body: '   ', page: 'index.html', worldX: 0, worldY: 0 })).status).toBe(400);
  expect((await call('POST', [], { body: 'x'.repeat(4001), page: 'index.html', worldX: 0, worldY: 0 })).status).toBe(400);
  expect((await call('POST', [], { body: 'Hi', page: '../secret', worldX: 0, worldY: 0 })).status).toBe(400);
  expect((await call('POST', [], { body: 'Hi', page: 'index.html', worldX: Number.NaN, worldY: 0 })).status).toBe(400);
  expect((await call('POST', ['nothex'], { body: 'Hi' })).status).toBe(404);
  expect(cleanBody('a\u0000b\r\nc')).toBe('ab\nc');
  expect(cleanAnchor({ nodeId: '<bad>', x: 5, y: 5, worldX: 1, worldY: 2 })).toEqual({ nodeId: null, x: 0, y: 0, worldX: 1, worldY: 2 });
});

it('describes comment times compactly', () => {
  const now = Date.UTC(2026, 9, 3, 12);
  expect(timeAgo(now - 10_000, now)).toBe('Just now');
  expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
  expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
  expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d ago');
});
