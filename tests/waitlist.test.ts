import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Worker modules are imported by path so the browser typecheck doesn't pull in Worker types.
const waitlistPath = '../worker/waitlist.ts';
const sitePath = '../worker/site.ts';
const { handleAdmin, joinWaitlist, canCreateAccount } = await import(waitlistPath);
const { serveSite } = await import(sitePath);

const ORIGIN = 'https://plastic.test';

/** Mail lookups (DNS over HTTPS) answer "accepts mail"; everything else goes to `rest`. */
function withMailDns(rest: (url: string, init: RequestInit) => Promise<Response> = async () => Response.json({})) {
  return vi.fn(async (url: string, init: RequestInit) =>
    String(url).startsWith('https://cloudflare-dns.com/') ? Response.json({ Status: 0, Answer: [{ type: 15, data: '10 mx.example.com.' }] }) : rest(url, init),
  );
}
beforeEach(() => vi.stubGlobal('fetch', withMailDns()));

/** In-memory SQLite with D1's prepare().bind() API. */
function db() {
  const database = new DatabaseSync(':memory:');
  database.exec('create table "user" (id text primary key, email text not null unique)');
  database.exec(readFileSync('migrations/0007_waitlist.sql', 'utf8'));
  return {
    database,
    DB: {
      prepare: (sql: string) => {
        const statement = database.prepare(sql);
        const bound = (...args: never[]) => ({
          first: async () => statement.get(...args) ?? null,
          all: async () => ({ results: statement.all(...args) }),
          run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
        });
        // Like D1, a statement without parameters can be run directly.
        return { bind: bound, ...bound() };
      },
    },
  };
}

function env(extra: Record<string, unknown> = {}) {
  const { database, DB } = db();
  return { database, env: { DB, BETTER_AUTH_URL: ORIGIN, ADMIN_EMAILS: 'boss@example.com', ...extra } };
}

const join = (e: unknown, body: unknown, headers: Record<string, string> = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return joinWaitlist(
    new Request(`${ORIGIN}/api/waitlist`, {
      method: 'POST',
      body: text,
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(text).length), ...headers },
    }),
    e,
  );
};

describe('waitlist', () => {
  it('stores a normalized entry once and answers the same for repeats', async () => {
    const { env: e, database } = env();
    const first = await join(e, { email: '  Ada@Example.com ', name: 'Ada', role: 'designer', teamSize: '2-10', useCase: 'A design system', source: 'download' });
    const again = await join(e, { email: 'ada@example.com', role: 'engineer' });
    expect(await first.json()).toEqual({ ok: true });
    expect(await again.json()).toEqual({ ok: true });
    expect(database.prepare('select email, name, role, team_size, use_case, source from waitlist').all()).toEqual([
      { email: 'ada@example.com', name: 'Ada', role: 'designer', team_size: '2-10', use_case: 'A design system', source: 'download' },
    ]);
  });

  it('drops unknown choices, rejects bad emails, cross-site posts and fills from bots', async () => {
    const { env: e, database } = env();
    await join(e, { email: 'x@example.com', role: 'wizard', teamSize: '9000', source: 'elsewhere' });
    expect(database.prepare('select role, team_size, source from waitlist').get()).toEqual({ role: null, team_size: null, source: 'home' });
    expect((await join(e, { email: 'not-an-email' })).status).toBe(400);
    expect((await join(e, { email: 'y@example.com' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect(await (await join(e, { email: 'bot@example.com', website: 'spam' })).json()).toEqual({ ok: true });
    expect(database.prepare('select count(*) as n from waitlist').get()).toEqual({ n: 1 });
  });

  it('refuses typos (with the fix), temporary inboxes and domains without mail, before saving anything', async () => {
    const { env: e, database } = env();
    const typo = await join(e, { email: 'ada@gmaii.com' });
    expect(typo.status).toBe(400);
    expect(await typo.json()).toMatchObject({ reason: 'typo', suggestion: 'ada@gmail.com' });
    expect((await (await join(e, { email: 'ada@mailinator.com' })).json()).reason).toBe('disposable');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ Status: 3 })));
    expect((await (await join(e, { email: 'ada@no-such-domain.test' })).json()).reason).toBe('no-mail');
    expect(database.prepare('select count(*) as n from waitlist').get()).toEqual({ n: 0 });
  });

  it('redirects plain form posts back to their page, and only to known pages', async () => {
    const { env: e } = env();
    const form = { 'content-type': 'application/x-www-form-urlencoded' };
    const ok = await join(e, 'email=f%40example.com&redirect=%2Fdownload%23download-join-joined', form);
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe(`${ORIGIN}/download#download-join-joined`);
    const evil = await join(e, 'email=g%40example.com&redirect=https%3A%2F%2Fevil.test%23x', form);
    expect(evil.status).toBe(200);
  });
});

describe('thank-you email', () => {
  afterEach(() => vi.unstubAllGlobals());
  const outbox = () => {
    const sent: { to: string[]; subject: string; html: string }[] = [];
    vi.stubGlobal('fetch', withMailDns(async (_url, init) => (sent.push(JSON.parse(String(init.body))), Response.json({ id: 'x' }))));
    return sent;
  };

  it('thanks each new address once, and never bots or repeats', async () => {
    const sent = outbox();
    const { env: e } = env({ RESEND_API_KEY: 'test-key' });
    await join(e, { email: 'ada@example.com' });
    await join(e, { email: 'ADA@example.com' });
    await join(e, { email: 'bot@example.com', website: 'spam' });
    expect(sent.map((m) => [m.to[0], m.subject])).toEqual([['ada@example.com', 'You’re on the Plastic waitlist']]);
    expect(sent[0]!.html).toContain('https://plastic.test/changelog');
    expect(sent[0]!.html).not.toContain('{{');
  });

  it('stops thanking at the daily cap so account emails keep their quota', async () => {
    const sent = outbox();
    const { env: e, database } = env({ RESEND_API_KEY: 'test-key' });
    const insert = database.prepare('insert into waitlist (email, created_at) values (?, ?)');
    for (let i = 0; i < 60; i++) insert.run(`earlier${i}@example.com`, Date.now() - 1000);
    await join(e, { email: 'late@example.com' });
    expect(sent).toHaveLength(0);
    expect(database.prepare('select count(*) as n from waitlist where email = ?').get('late@example.com')).toEqual({ n: 1 });
  });

  it('sends nothing where email is not configured', async () => {
    const sent = outbox();
    const { env: e } = env();
    await join(e, { email: 'quiet@example.com' });
    expect(sent).toHaveLength(0);
  });
});

describe('invites', () => {
  const admin = (e: unknown, path: string[], init: RequestInit = {}, who = 'boss@example.com') =>
    handleAdmin(new Request(`${ORIGIN}/api/admin/${path.join('/')}`, init), e, { email: who, name: 'Boss' }, path);
  const invite = (e: unknown, body: unknown, who?: string) => {
    const text = JSON.stringify(body);
    return admin(e, ['invite'], { method: 'POST', body: text, headers: { 'content-type': 'application/json', 'content-length': String(text.length) } }, who);
  };

  it('only lets admins in', async () => {
    const { env: e } = env();
    expect((await admin(e, ['waitlist'], {}, 'someone@example.com')).status).toBe(403);
  });

  it('invites from the list or directly, and gates account creation on it', async () => {
    const { env: e, database } = env();
    await join(e, { email: 'ada@example.com' });
    expect(await canCreateAccount(e, 'ada@example.com')).toBe(false);
    expect(await canCreateAccount(e, 'Boss@Example.com')).toBe(true);

    expect(await (await invite(e, { email: 'ada@example.com' })).json()).toEqual({ ok: true, emailed: false });
    expect(await (await invite(e, { email: 'ada@example.com' })).json()).toEqual({ ok: true, emailed: false, already: true });
    expect(await (await invite(e, { email: 'direct@example.com' })).json()).toEqual({ ok: true, emailed: false });
    expect(await canCreateAccount(e, 'ada@example.com')).toBe(true);
    expect(await canCreateAccount(e, 'direct@example.com')).toBe(true);

    database.prepare('insert into "user" (id, email) values (?, ?)').run('u1', 'ada@example.com');
    const page = await (await admin(e, ['waitlist'], {}, 'boss@example.com')).json();
    expect(page.counts).toEqual({ total: 2, waiting: 0, invited: 1, joined: 1 });
    const joined = await (await handleAdmin(new Request(`${ORIGIN}/api/admin/waitlist?filter=joined`), e, { email: 'boss@example.com', name: 'Boss' }, ['waitlist'])).json();
    expect(joined.entries.map((x: { email: string }) => x.email)).toEqual(['ada@example.com']);
  });
});

describe('site routing', () => {
  const assets = { fetch: async (request: Request) => new Response(`asset:${new URL(request.url).pathname}`, { headers: { 'content-type': 'text/html' } }) };
  const e = { ASSETS: assets, BETTER_AUTH_URL: ORIGIN };
  const visit = (path: string, headers: Record<string, string> = {}) => serveSite(new Request(`${ORIGIN}${path}`, { headers }), e, new URL(`${ORIGIN}${path}`));

  it('serves the site to visitors and the app to signed-in people and auth links', async () => {
    expect(await (await visit('/'))!.text()).toBe('asset:/site/');
    expect((await visit('/'))!.headers.get('vary')).toBe('cookie');
    expect(await visit('/', { cookie: '__Secure-better-auth.session_token=abc' })).toBeNull();
    expect(await visit('/', { cookie: 'better-auth.session_token=abc' })).toBeNull();
    expect(await visit('/?auth=reset-password')).toBeNull();
    expect(await visit('/?auth=sign-up&email=a%40b.co')).toBeNull();
  });

  it('serves the other pages at canonical URLs and leaves app routes alone', async () => {
    expect(await (await visit('/changelog'))!.text()).toBe('asset:/site/changelog');
    expect(await (await visit('/download'))!.text()).toBe('asset:/site/download');
    expect(await (await visit('/sitemap.xml'))!.text()).toBe('asset:/site/sitemap.xml');
    const slash = await visit('/changelog/');
    expect(slash!.status).toBe(301);
    expect(slash!.headers.get('location')).toBe(`${ORIGIN}/changelog`);
    expect(await visit('/files')).toBeNull();
    expect(await visit('/admin')).toBeNull();
  });
});
