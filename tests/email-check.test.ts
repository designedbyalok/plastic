import { afterEach, describe, expect, it, vi } from 'vitest';

const modulePath = '../worker/emailCheck.ts';
const { acceptsMail, checkEmail, isDisposable, suggestDomain } = await import(modulePath);

afterEach(() => vi.unstubAllGlobals());

/** A DNS-over-HTTPS answer for one domain lookup. */
const dns = (answer: unknown) => vi.fn(async () => Response.json(answer));

describe('typo suggestions', () => {
  it('corrects near misses of common providers and impossible endings', () => {
    expect(suggestDomain('gmaii.com')).toBe('gmail.com');
    expect(suggestDomain('gmial.com')).toBe('gmail.com');
    expect(suggestDomain('gamil.com')).toBe('gmail.com');
    expect(suggestDomain('gmail.con')).toBe('gmail.com');
    expect(suggestDomain('hotmial.com')).toBe('hotmail.com');
    expect(suggestDomain('yahooo.com')).toBe('yahoo.com');
    expect(suggestDomain('outlok.com')).toBe('outlook.com');
    expect(suggestDomain('icloud.co')).toBe('icloud.com');
    expect(suggestDomain('acme.con')).toBe('acme.com');
  });

  it('leaves real domains alone, including short ones close to providers', () => {
    for (const domain of ['gmail.com', 'mail.com', 'me.com', 'gmx.us', 'fold.health', 'useplastic.app', 'acme.co', 'company.io', 'live.com', 'hotmail.it', 'hotmail.nl', 'yahoo.de', 'outlook.fr', 'ab.com', 'gmail.acme.com']) {
      expect(suggestDomain(domain), domain).toBeNull();
    }
  });
});

describe('disposable inboxes', () => {
  it('blocks listed services and their subdomains only', () => {
    expect(isDisposable('mailinator.com')).toBe(true);
    expect(isDisposable('inbox.mailinator.com')).toBe(true);
    expect(isDisposable('gmail.com')).toBe(false);
    expect(isDisposable('useplastic.app')).toBe(false);
  });
});

describe('mail domains', () => {
  it('allows inconclusive DNS responses and retries without caching a refusal', async () => {
    for (const status of [2, 5, undefined]) {
      const domain = `dns-failure-${String(status)}.test`;
      const lookup = vi.fn()
        .mockResolvedValueOnce(Response.json({ Status: status }))
        .mockResolvedValueOnce(Response.json({ Status: 0, Answer: [{ type: 15, data: '10 mx.example.test.' }] }));
      vi.stubGlobal('fetch', lookup);
      expect(await checkEmail(`ada@${domain}`)).toBeNull();
      expect(await acceptsMail(domain)).toBe(true);
      expect(lookup).toHaveBeenCalledTimes(2);
    }
  });
  it('needs a real MX record and allows the address when DNS is unreachable', async () => {
    vi.stubGlobal('fetch', dns({ Status: 0, Answer: [{ type: 15, data: '10 mx.acme-one.test.' }] }));
    expect(await acceptsMail('acme-one.test')).toBe(true);
    vi.stubGlobal('fetch', dns({ Status: 3 }));
    expect(await acceptsMail('nothing-here.test')).toBe(false);
    vi.stubGlobal('fetch', dns({ Status: 0, Answer: [{ type: 15, data: '0 .' }] }));
    expect(await acceptsMail('no-mail.test')).toBe(false);
    vi.stubGlobal('fetch', dns({ Status: 0 }));
    expect(await acceptsMail('parked.test')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await acceptsMail('unreachable.test')).toBeNull();
  });

  it('caches answers, so a domain is looked up once', async () => {
    const lookup = dns({ Status: 0, Answer: [{ type: 15, data: '10 mx.cached.test.' }] });
    vi.stubGlobal('fetch', lookup);
    await acceptsMail('cached.test');
    await acceptsMail('cached.test');
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe('checkEmail', () => {
  it('explains each problem and suggests the fixed address for typos', async () => {
    expect(await checkEmail('ada@gmaii.com')).toEqual({ reason: 'typo', message: 'Check the spelling. Did you mean ada@gmail.com?', suggestion: 'ada@gmail.com' });
    expect((await checkEmail('ada@mailinator.com'))?.reason).toBe('disposable');
    vi.stubGlobal('fetch', dns({ Status: 3 }));
    expect((await checkEmail('ada@made-up-domain.test'))?.reason).toBe('no-mail');
    // Known providers never need a lookup.
    const lookup = vi.fn();
    vi.stubGlobal('fetch', lookup);
    expect(await checkEmail('ada@gmail.com')).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
});
