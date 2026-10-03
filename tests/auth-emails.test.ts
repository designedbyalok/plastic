import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuth, providers } from '../worker/auth.ts';
import { emailContext, renderEmail, sendEmail } from '../worker/emails.ts';
import type { Env } from '../worker/env.ts';

afterEach(() => vi.unstubAllGlobals());

/**
 * node:sqlite for Better Auth, plus D1's prepare().bind() API for Plastic's own queries (the
 * waitlist and invite checks), so one in-memory database serves both like D1 does in production.
 */
function d1(database: DatabaseSync) {
  return new Proxy(database, {
    get(target, key) {
      if (key !== 'prepare') return Reflect.get(target, key).bind?.(target) ?? Reflect.get(target, key);
      return (sql: string) => {
        const statement = target.prepare(sql);
        return Object.assign(statement, {
          bind: (...args: never[]) => ({
            first: async () => statement.get(...args) ?? null,
            all: async () => ({ results: statement.all(...args) }),
            run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
          }),
        });
      };
    },
  });
}

function harness(invited: readonly string[] = ['user@example.com', 'magic@example.com']) {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync('migrations/0001_better_auth.sql', 'utf8'));
  database.exec(readFileSync('migrations/0004_username.sql', 'utf8'));
  database.exec(readFileSync('migrations/0007_waitlist.sql', 'utf8'));
  // Plastic is invite-only: the accounts these tests create were invited first.
  for (const email of invited) database.prepare('insert into waitlist (email, created_at, invited_at) values (?, 0, 1)').run(email);
  const env = {
    DB: d1(database),
    BETTER_AUTH_URL: 'https://plastic.test',
    BETTER_AUTH_SECRET: 'test-only-secret-with-at-least-32-characters',
    RESEND_API_KEY: 'test-key',
    ADMIN_EMAILS: 'admin@example.com',
  } as unknown as Env;
  const outbox: {
    to: string[];
    subject: string;
    html: string;
    text: string;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      outbox.push(JSON.parse(init.body));
      return Response.json({ id: crypto.randomUUID() });
    }),
  );
  const auth = createAuth(env);
  const request = async (path: string, body?: object) => {
    const pending: Promise<unknown>[] = [];
    const context = {
      waitUntil: (task: Promise<unknown>) => pending.push(task),
    } as unknown as ExecutionContext;
    const response = await emailContext.run(context, () =>
      auth.handler(
        new Request(`https://plastic.test/api/auth${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            origin: 'https://plastic.test',
            'content-type': 'application/json',
            'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/130.0',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      ),
    );
    for (let index = 0; index < pending.length; index++) await pending[index];
    return response;
  };
  const link = (subject: string) => {
    const mail = outbox.findLast((email) => email.subject === subject)!;
    return new URL(mail.html.match(/href="(https:\/\/plastic\.test\/api\/auth\/[^\"]+)"/)![1]!.replaceAll('&amp;', '&'));
  };
  return { auth, env, outbox, request, link, database };
}

describe('approved email delivery', () => {
  it('escapes recipient data and prevents foreign auth links or incomplete release notes', () => {
    const email = renderEmail('welcome', 'https://plastic.test', {
      name: '<img onerror="bad">',
      actionUrl: 'https://plastic.test/',
    });
    expect(email.html).toContain('&lt;img onerror=&quot;bad&quot;&gt;');
    expect(email.html).not.toContain('{{');
    expect(email.html).toContain('/emails/arrow-up-right-light-v2.png');
    expect(email.html).toContain('/emails/arrow-up-right-dark-v2.png');
    expect(email.html).not.toContain('<svg');
    expect(() =>
      renderEmail('magic-link', 'https://plastic.test', {
        actionUrl: 'https://evil.test/',
      }),
    ).toThrow('Invalid email link');
    expect(() =>
      renderEmail('release-notes', 'https://plastic.test', {
        actionUrl: 'https://plastic.test/',
      }),
    ).toThrow('unsubscribe');
  });

  it('sends verified signup, welcome, sign-in and reset emails through the real auth endpoints', async () => {
    const h = harness();
    const signup = await h.request('/sign-up/email', {
      name: 'Alok',
      email: 'user@example.com',
      password: 'test-password-123',
      callbackURL: '/',
    });
    expect(signup.status).toBe(200);
    expect(((await signup.json()) as { token: string | null }).token).toBeNull();
    expect(h.outbox).toHaveLength(1);
    const verification = h.link('Verify your email • Plastic');
    const verified = await h.request(verification.pathname.replace('/api/auth', '') + verification.search);
    expect(verified.status).toBe(302);
    expect(h.outbox.map((m) => m.subject)).toContain('Welcome to Plastic');
    const login = await h.request('/sign-in/email', {
      email: 'user@example.com',
      password: 'test-password-123',
    });
    expect(login.status).toBe(200);
    const oldCookie = login.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const sessionBefore = await h.auth.api.getSession({ headers: new Headers({ cookie: oldCookie }) });
    expect(sessionBefore?.user.email).toBe('user@example.com');
    const signIn = h.outbox.find((m) => m.subject === 'New sign-in to Plastic')!;
    expect(signIn.html).toContain('Chrome on macOS');
    expect(signIn.html).not.toContain('alok@example.com');
    await h.request('/request-password-reset', {
      email: 'missing@example.com',
      redirectTo: 'https://plastic.test/?auth=reset-password',
    });
    const beforeReset = h.outbox.length;
    await h.request('/request-password-reset', {
      email: 'user@example.com',
      redirectTo: 'https://plastic.test/?auth=reset-password',
    });
    expect(h.outbox).toHaveLength(beforeReset + 1);
    const reset = h.link('Reset your password • Plastic');
    const token = reset.pathname.split('/').pop();
    expect(
      (
        await h.request('/reset-password', {
          token,
          newPassword: 'new-test-password-123',
        })
      ).status,
    ).toBe(200);
    expect(h.outbox.at(-1)!.subject).toBe('Your Plastic password was changed');
    expect(databaseCount(h.database, 'session')).toBe(0);
    expect(await h.auth.api.getSession({ headers: new Headers({ cookie: oldCookie }) })).toBeNull();
    expect(
      (
        await h.request('/reset-password', {
          token,
          newPassword: 'another-password-123',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request('/sign-in/email', {
          email: 'user@example.com',
          password: 'test-password-123',
        })
      ).status,
    ).toBe(401);
    h.database.close();
  });

  it('stores magic-link tokens hashed, creates a verified account, and consumes the link once', async () => {
    const h = harness();
    expect(
      (
        await h.request('/sign-in/magic-link', {
          email: 'magic@example.com',
          callbackURL: '/',
        })
      ).status,
    ).toBe(200);
    const url = h.link('Your sign-in link • Plastic');
    const token = url.searchParams.get('token')!;
    const records = h.database.prepare('select identifier from verification').all();
    expect(JSON.stringify(records)).not.toContain(token);
    const first = await h.request(url.pathname.replace('/api/auth', '') + url.search);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).not.toContain('error=');
    expect(h.outbox.filter((m) => m.subject === 'Welcome to Plastic')).toHaveLength(1);
    expect(h.outbox.filter((m) => m.subject === 'New sign-in to Plastic')).toHaveLength(1);
    const again = await h.request(url.pathname.replace('/api/auth', '') + url.search);
    expect(again.headers.get('location')).toContain('INVALID_TOKEN');
    expect(databaseCount(h.database, 'session')).toBe(1);
    h.database.close();
  });

  it('refuses accounts without an invite, for every sign-up method, without sending email', async () => {
    const h = harness([]);
    const signup = await h.request('/sign-up/email', { email: 'stranger@example.com', password: 'correct-horse-battery', name: 'Stranger' });
    // The answer doesn't reveal invite status, but no account exists and no email was sent.
    expect([200, 403]).toContain(signup.status);
    const magic = await h.request('/sign-in/magic-link', { email: 'stranger@example.com', callbackURL: '/' });
    expect(magic.status).toBe(200);
    expect(h.database.prepare('select count(*) as n from "user"').get()).toEqual({ n: 0 });
    expect(h.outbox).toHaveLength(0);
  });

  it('lets admins and invited emails create accounts', async () => {
    const h = harness(['invited@example.com']);
    for (const email of ['admin@example.com', 'invited@example.com']) {
      const response = await h.request('/sign-up/email', { email, password: 'correct-horse-battery', name: 'Someone' });
      expect(response.status).toBe(200);
    }
    expect(h.database.prepare('select email from "user" order by email').all()).toEqual([{ email: 'admin@example.com' }, { email: 'invited@example.com' }]);
    expect(h.outbox.map((m) => m.to[0])).toEqual(['admin@example.com', 'invited@example.com']);
  });

  it('advertises mail features only when configured and does not retry permanent Resend failures', async () => {
    expect(providers({} as Env)).toEqual(['email']);
    expect(providers({ RESEND_API_KEY: 'test-key' } as Env)).toContain('magic-link');
    const fetcher = vi.fn(async () => new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      sendEmail(
        {
          RESEND_API_KEY: 'test-key',
          BETTER_AUTH_URL: 'https://plastic.test',
        } as Env,
        'welcome',
        'user@example.com',
        { actionUrl: 'https://plastic.test/' },
        'user-id',
      ),
    ).rejects.toThrow('403');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function databaseCount(database: DatabaseSync, table: string) {
  return database.prepare(`select count(*) as count from ${table}`).get()!.count;
}
