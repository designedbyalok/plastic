/**
 * Is this an address worth emailing? Checked before an address is saved or sent anything, so
 * typos, temporary inboxes and dead domains never cost an email (Resend's free plan allows 100
 * a day) or a bounce (which hurts delivery for everyone).
 *
 * 1. Typos of common providers ("gmaii.com", "hotmial.com", "gmail.con") are refused with a
 *    suggestion the forms can apply in one click.
 * 2. Disposable-inbox services are refused (a maintained CC0 list of ~9k domains, and their
 *    subdomains).
 * 3. The domain must accept mail: an MX record, looked up with DNS over HTTPS on Cloudflare's
 *    resolver and cached for a day. If DNS can't be reached the address is allowed: a lookup
 *    problem must never block a real person.
 */
import blocklist from 'disposable-email-domains-js/dist/dict/disposable_email_blocklist.json';

export type EmailProblem =
  | { reason: 'typo'; message: string; suggestion: string }
  | { reason: 'disposable'; message: string }
  | { reason: 'no-mail'; message: string };

/** Popular mailbox providers: exact matches are fine; near misses are typos. */
const PROVIDERS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.fr', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru',
  'zoho.com', 'fastmail.com', 'hey.com', 'tutanota.com', 'rediffmail.com', 'qq.com', '163.com', '126.com', 'web.de',
  't-online.de', 'orange.fr', 'free.fr', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'btinternet.com',
  'mail.ru', 'naver.com', 'hanmail.net', 'email.com', 'inbox.com', 'hotmail.it', 'hotmail.de', 'hotmail.es', 'libero.it',
];
const PROVIDER_SET = new Set(PROVIDERS);

/** Endings that are never real and almost always mean ".com". */
const TLD_TYPOS = new Set(['con', 'cmo', 'cpm', 'vom', 'xom', 'ocm', 'comm', 'coom', 'clm', 'cim', 'dom', 'om']);

let disposable: Set<string> | null = null;

/** Edit distance with adjacent swaps ("gmial" → "gmail" is one edit). */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = d;
    }
  }
  return rows[a.length]![b.length]!;
}

/** The provider this domain was probably meant to be, or null. */
export function suggestDomain(domain: string): string | null {
  if (PROVIDER_SET.has(domain)) return null;
  const parts = domain.split('.');
  // "something.con" → "something.com"
  const fixed = TLD_TYPOS.has(parts.at(-1)!) ? [...parts.slice(0, -1), 'com'].join('.') : domain;
  if (PROVIDER_SET.has(fixed)) return fixed;
  // Compare the name and the ending separately: "hotmail.it" is a real address (right name,
  // different country), "gmaii.com" is a typo (right ending, name one key off).
  const [name, ...rest] = fixed.split('.');
  const ending = rest.join('.');
  let best: { provider: string; d: number } | null = null;
  for (const provider of PROVIDERS) {
    const [providerName, ...providerRest] = provider.split('.');
    const providerEnding = providerRest.join('.');
    let d = Infinity;
    if (name === providerName) {
      if (distance(ending, providerEnding) <= 1) d = 1; // "gmail.co", "gmail.cm"
    } else if (ending === providerEnding && providerName!.length >= 4) {
      const edits = distance(name!, providerName!);
      if (edits <= (providerName!.length <= 5 ? 1 : 2)) d = edits; // "gmaii", "hotmial"
    }
    if (d < Infinity && (!best || d < best.d)) best = { provider, d };
  }
  if (best) return best.provider;
  return fixed === domain ? null : fixed;
}

export function isDisposable(domain: string): boolean {
  disposable ??= new Set(blocklist as string[]);
  // A listed domain's subdomains are disposable too (x.mailinator.com).
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) if (disposable.has(parts.slice(i).join('.'))) return true;
  return false;
}

const mxCache = new Map<string, { ok: boolean; until: number }>();
const DAY = 86_400;

/** Does the domain accept mail? null when DNS couldn't answer (callers then allow the address). */
export async function acceptsMail(domain: string): Promise<boolean | null> {
  const now = Date.now();
  const memo = mxCache.get(domain);
  if (memo && memo.until > now) return memo.ok;
  const cacheKey = new Request(`https://plastic-mx-check.invalid/${encodeURIComponent(domain)}`);
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) {
    const ok = (await cached.text()) === '1';
    mxCache.set(domain, { ok, until: now + DAY * 1000 });
    return ok;
  }
  let ok: boolean;
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const answer = (await response.json()) as { Status: number; Answer?: { type: number; data: string }[] };
    // SERVFAIL, REFUSED and malformed answers are inconclusive, not proof of a dead domain.
    // Do not cache them: the next attempt must be able to recover immediately.
    if (answer.Status !== 0 && answer.Status !== 3) return null;
    // NXDOMAIN, or no MX records, or a "null MX" (RFC 7505: this domain takes no mail).
    const exchanges = (answer.Answer ?? []).filter((record) => record.type === 15).map((record) => record.data.trim());
    ok = answer.Status === 0 && exchanges.some((data) => !/^0\s+\.?$/.test(data));
  } catch {
    return null;
  }
  mxCache.set(domain, { ok, until: now + DAY * 1000 });
  await cache?.put(cacheKey, new Response(ok ? '1' : '0', { headers: { 'cache-control': `max-age=${DAY}` } })).catch(() => {});
  return ok;
}

/** Why this (already syntax-checked, lowercase) address shouldn't be used, or null if it's fine. */
export async function checkEmail(email: string): Promise<EmailProblem | null> {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const suggestion = suggestDomain(domain);
  if (suggestion) {
    const fixed = `${local}@${suggestion}`;
    return { reason: 'typo', message: `Check the spelling. Did you mean ${fixed}?`, suggestion: fixed };
  }
  if (isDisposable(domain)) {
    return { reason: 'disposable', message: 'Please use a permanent email address. Temporary inboxes stop working before invites go out.' };
  }
  if (PROVIDER_SET.has(domain)) return null; // known providers always accept mail
  if ((await acceptsMail(domain)) === false) {
    return { reason: 'no-mail', message: `${domain} can’t receive email. Check the address and try again.` };
  }
  return null;
}
