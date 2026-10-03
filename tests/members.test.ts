import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../worker/live.ts', () => ({ CLIENT_ID: /^[a-z0-9]{8,32}$/, room: () => ({ changed: vi.fn() }) }));
const modulePath = '../worker/members.ts';
const { memberDetails } = await import(modulePath);

const iso = (ms: number) => new Date(ms).toISOString();

function harness() {
  const database = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').sort()) database.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const prepare = (sql: string) => {
    const statement = database.prepare(sql);
    const bound = (...args: never[]) => ({
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
    });
    return { bind: bound, ...bound() };
  };
  const objects: { key: string; size: number; etag: string }[] = [];
  const list = vi.fn(async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
    const matching = objects.filter((o) => o.key.startsWith(prefix));
    const start = Number(cursor ?? 0);
    const page = matching.slice(start, start + 2);
    return { objects: page, truncated: start + 2 < matching.length, cursor: String(start + 2) };
  });
  const env = {
    DB: { prepare, batch: async (statements: { all(): Promise<unknown> }[]) => Promise.all(statements.map((s) => s.all())) },
    FILES: { list },
  };
  return { env, database, objects, list };
}

describe('member details', () => {
  it('reports waitlist-only people without touching storage', async () => {
    const h = harness();
    h.database.prepare('insert into waitlist (email, source, created_at) values (?, ?, ?)').run('ada@example.com', 'home', 1);
    const details = await memberDetails(h.env, 'Ada@Example.com');
    expect(details.waitlist).toMatchObject({ source: 'home', invitedAt: null });
    expect(details.account).toBeNull();
    expect(h.list).not.toHaveBeenCalled();
  });

  it('measures sign-ins, files, saves and storage split into current, old versions and images', async () => {
    const h = harness();
    const now = Date.now();
    const db = h.database;
    db.prepare('insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, ?, ?, 1, ?, ?)').run('u1', 'Ada', 'ada@example.com', iso(now - 9e8), iso(now));
    db.prepare('insert into account (id, accountId, providerId, userId, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?)').run('a1', 'u1', 'credential', 'u1', iso(now), iso(now));
    db.prepare('insert into account (id, accountId, providerId, userId, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?)').run('a2', 'g1', 'google', 'u1', iso(now), iso(now));
    const session = db.prepare('insert into session (id, expiresAt, token, createdAt, updatedAt, userId) values (?, ?, ?, ?, ?, ?)');
    session.run('s1', iso(now - 1000), 't1', iso(now - 9e7), iso(now - 8e7), 'u1');
    session.run('s2', iso(now + 9e8), 't2', iso(now - 3600e3), iso(now - 60e3), 'u1');
    const current = 'a'.repeat(64);
    db.prepare('insert into project (owner_id, id, title, created_at, updated_at, files) values (?, ?, ?, ?, ?, ?)').run('u1', 'p1', 'One', now, now - 5000, JSON.stringify({ 'index.html': current }));
    db.prepare('insert into project (owner_id, id, title, created_at, updated_at, files, archived_at) values (?, ?, ?, ?, ?, ?, ?)').run('u1', 'p2', 'Two', now, now - 9000, '{}', now);
    db.prepare('insert into folder (owner_id, id, name, created_at) values (?, ?, ?, ?)').run('u1', 'f1', 'Work', now);
    db.prepare('insert into activity (owner_id, day, edits) values (?, ?, ?)').run('u1', iso(now).slice(0, 10), 12);
    db.prepare('insert into activity (owner_id, day, edits) values (?, ?, ?)').run('u1', iso(now - 100 * 864e5).slice(0, 10), 30);
    const prefix = 'users/u1/projects/p1/';
    h.objects.push(
      { key: `${prefix}revisions/index.html/${current}`, size: 1000, etag: 'e1' },
      { key: `${prefix}revisions/index.html/${'b'.repeat(64)}`, size: 400, etag: 'e2' },
      { key: `${prefix}assets/photo.png`, size: 5000, etag: 'e3' },
      { key: 'users/someone-else/projects/x/assets/big.png', size: 9e9, etag: 'e4' },
    );

    const details = await memberDetails(h.env, 'ada@example.com');
    expect(details.account).toMatchObject({ name: 'Ada', emailVerified: true, activeSessions: 1, lastSignIn: iso(now - 3600e3), lastActive: iso(now - 60e3) });
    expect([...details.account!.signInMethods].sort()).toEqual(['google', 'password']);
    expect(details.files).toEqual({ active: 1, archived: 1, folders: 1, lastEdited: now - 5000 });
    expect(details.activity).toEqual({ savesLast30Days: 12, savesLast365Days: 42, activeDaysLast30: 1 });
    expect(details.storage).toMatchObject({
      bytes: 6400,
      objects: 3,
      current: { bytes: 1000, objects: 1 },
      oldVersions: { bytes: 400, objects: 1 },
      images: { bytes: 5000, objects: 1 },
      partial: false,
      listOperations: 2,
    });
  });
});
