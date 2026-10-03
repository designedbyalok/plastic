import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const modulePath = '../worker/releaseNotes.ts';
const { RELEASE_NOTES_EDITION, handleUnsubscribe, pendingReleaseNotes, sendReleaseNotes, sendReleaseNotesBatch, unsubscribeUrl } = await import(modulePath);

afterEach(() => vi.unstubAllGlobals());

function harness(fail = false) {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync('migrations/0001_better_auth.sql', 'utf8'));
  database.exec(readFileSync('migrations/0008_release_notes.sql', 'utf8'));
  const prepare = (sql: string) => {
    const statement = database.prepare(sql);
    const bound = (...args: never[]) => ({
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
    });
    return { bind: bound, ...bound() };
  };
  const env = { DB: { prepare }, BETTER_AUTH_URL: 'https://plastic.test', BETTER_AUTH_SECRET: 'test-only-secret-with-at-least-32-characters', RESEND_API_KEY: 'test-key' };
  const sent: { to: string[]; subject: string; html: string; headers?: Record<string, string> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      if (fail) return new Response('nope', { status: 422 });
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ id: 'x' });
    }),
  );
  const member = (email: string, verified = 1) =>
    database.prepare('insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?)').run(email, 'Member', email, verified, '2026-10-01', '2026-10-01');
  return { env, database, sent, member };
}

describe('release notes', () => {
  it('sends each member the current edition once, with one-click unsubscribe', async () => {
    const h = harness();
    expect(await sendReleaseNotes(h.env, 'Ada@Example.com')).toBe(true);
    expect(await sendReleaseNotes(h.env, 'ada@example.com')).toBe(false);
    expect(h.sent).toHaveLength(1);
    const mail = h.sent[0]!;
    expect(mail.to).toEqual(['ada@example.com']);
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.headers?.['List-Unsubscribe']).toBe(`<${await unsubscribeUrl(h.env, 'ada@example.com')}>`);
    expect(mail.html).toContain('https://plastic.test/api/unsubscribe?e=ada%40example.com&amp;s=');
    expect(mail.html).not.toContain('{{');
  });

  it('unsubscribes only on confirmation, only with a valid link, and then stops sending', async () => {
    const h = harness();
    const link = await unsubscribeUrl(h.env, 'ada@example.com');
    expect(await (await handleUnsubscribe(new Request(link), h.env)).text()).toContain('Unsubscribe from release notes?');
    expect(h.database.prepare('select count(*) as n from email_preference').get()).toEqual({ n: 0 });
    const forged = link.replace(/s=[^&]+/, 's=forged');
    expect(await (await handleUnsubscribe(new Request(forged, { method: 'POST' }), h.env)).text()).toContain('Link not recognized');
    expect(await (await handleUnsubscribe(new Request(link, { method: 'POST' }), h.env)).text()).toContain('You’re unsubscribed');
    expect(await sendReleaseNotes(h.env, 'ada@example.com')).toBe(false);
    expect(h.sent).toHaveLength(0);
  });

  it('batches pending verified members and releases the claim when delivery fails', async () => {
    const h = harness();
    h.member('one@example.com');
    h.member('two@example.com');
    h.member('unverified@example.com', 0);
    expect(await pendingReleaseNotes(h.env)).toBe(2);
    expect(await sendReleaseNotesBatch(h.env)).toEqual({ sent: 2, remaining: 0 });
    expect(h.sent.map((m) => m.to[0]).sort()).toEqual(['one@example.com', 'two@example.com']);

    const failing = harness(true);
    failing.member('three@example.com');
    await sendReleaseNotes(failing.env, 'three@example.com');
    expect(failing.database.prepare('select count(*) as n from release_note_send where release = ?').get(RELEASE_NOTES_EDITION)).toEqual({ n: 0 });
    expect(await pendingReleaseNotes(failing.env)).toBe(1);
  });
});
