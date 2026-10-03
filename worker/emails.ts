import { AsyncLocalStorage } from 'node:async_hooks';
import { emailTemplates } from './generated/email-templates.ts';
import type { Env } from './env.ts';

export type EmailTemplate = keyof typeof emailTemplates;
export const EMAIL_FROM = 'Plastic <hello@useplastic.app>';
export const emailContext = new AsyncLocalStorage<ExecutionContext>();
export interface EmailFields {
  name?: string;
  email?: string;
  device?: string;
  time?: string;
  actionUrl: string;
  resetUrl?: string;
  unsubscribeUrl?: string;
}

const escapeHTML = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderEmail(template: EmailTemplate, origin: string, fields: EmailFields) {
  const assetOrigin = new URL(origin).origin;
  const values: Record<string, string> = {
    name: 'there',
    ...fields,
    assetOrigin,
  };
  if (!values.name) values.name = 'there';
  // Auth actions must stay on Plastic. Release-note unsubscribe links may use another HTTPS service.
  for (const key of ['actionUrl', 'resetUrl', 'unsubscribeUrl']) {
    if (!values[key]) continue;
    const url = new URL(values[key]!);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
      (key !== 'unsubscribeUrl' && url.origin !== assetOrigin) ||
      url.username ||
      url.password
    )
      throw new Error('Invalid email link');
  }
  if (template === 'release-notes' && !fields.unsubscribeUrl) throw new Error('Release notes require an unsubscribe URL');
  const source = emailTemplates[template];
  const substitute = (body: string, html: boolean) =>
    body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (values[key] === undefined) throw new Error(`Missing email field: ${key}`);
      const value = values[key]!.replace(/[\r\n]/g, ' ');
      return html ? escapeHTML(value) : value;
    });
  return {
    subject: source.subject,
    html: substitute(source.html, true),
    text: substitute(source.text, false),
  };
}

export async function sendEmail(env: Env, template: EmailTemplate, to: string, fields: EmailFields, eventId: string) {
  if (!env.RESEND_API_KEY) throw new Error('Resend is not configured');
  const message = renderEmail(template, env.BETTER_AUTH_URL, fields);
  const key = `${template}/${await digest(eventId)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [to],
          ...message,
          // One-click unsubscribe (RFC 8058): mail clients POST to the URL.
          ...(template === 'release-notes'
            ? { headers: { 'List-Unsubscribe': `<${fields.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
      if (response.status !== 429 && response.status < 500) throw new DeliveryError(response.status);
      if (attempt === 2) throw new DeliveryError(response.status);
    } catch (error) {
      if (error instanceof DeliveryError || attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

class DeliveryError extends Error {
  constructor(status: number) {
    super(`Email delivery failed (${status})`);
  }
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Keep delivery alive after the Worker response, without leaking credentials or auth URLs in logs. */
export async function deliverInBackground(task: Promise<void>): Promise<void> {
  const guarded = task.catch(() => {
    console.error('Plastic email delivery failed. Check Resend delivery logs.');
  });
  const context = emailContext.getStore();
  if (context) context.waitUntil(guarded);
  else await guarded;
}

export function signInDevice(agent: string | null | undefined): string {
  const browser = /Edg\//.test(agent ?? '')
    ? 'Edge'
    : /Firefox\//.test(agent ?? '')
      ? 'Firefox'
      : /Chrome\//.test(agent ?? '')
        ? 'Chrome'
        : /Safari\//.test(agent ?? '')
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(agent ?? '')
    ? 'Android'
    : /iPhone|iPad/.test(agent ?? '')
      ? 'iOS'
      : /Windows/.test(agent ?? '')
        ? 'Windows'
        : /Macintosh|Mac OS X/.test(agent ?? '')
          ? 'macOS'
          : /Linux/.test(agent ?? '')
            ? 'Linux'
            : 'an unknown device';
  return `${browser} on ${os}`;
}
