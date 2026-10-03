/**
 * Profile photos. The browser crops, rotates and scales the photo and uploads a small square
 * image; the Worker stores it under the person's prefix and points their account at it.
 *
 *   PUT    /api/profile/avatar               signed in   raw image (WebP, PNG or JPEG, ≤ 300 KB) → { image }
 *   DELETE /api/profile/avatar               signed in   remove the photo → { image: null }
 *   GET    /api/avatars/<user>/<hash>.<ext>  public      the image (content-addressed: cached forever)
 *
 * Only real raster images are accepted (checked by their first bytes, never SVG), and replacing
 * a photo deletes the old one, so each person keeps at most one in R2.
 */
import type { Env } from './env.ts';

const MAX_BYTES = 300 * 1024;
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' } as const;
type Extension = keyof typeof TYPES;
const prefixOf = (user: string) => `users/${user}/avatar/`;
const FILE = /^[a-f0-9]{64}\.(webp|png|jpg)$/;
const USER = /^[A-Za-z0-9_-]{1,64}$/;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** The format from the file's first bytes (the declared type is not trusted). */
function sniff(bytes: Uint8Array): Extension | null {
  const at = (offset: number, ...values: number[]) => values.every((v, i) => bytes[offset + i] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return null;
}

async function removeOthers(env: Env, user: string, keep: string | null): Promise<void> {
  const listed = await env.FILES.list({ prefix: prefixOf(user) });
  const stale = listed.objects.map((o) => o.key).filter((key) => key !== keep);
  if (stale.length) await env.FILES.delete(stale);
}

export async function handleAvatarUpload(request: Request, env: Env, user: string): Promise<Response> {
  if (request.method === 'DELETE') {
    await env.DB.prepare('update "user" set image = null, updatedAt = ? where id = ?').bind(new Date().toISOString(), user).run();
    await removeOthers(env, user, null);
    return json({ image: null });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
  const size = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isFinite(size)) return json({ error: 'Content-Length is required.' }, 411);
  if (size > MAX_BYTES) return json({ error: 'That photo is too large. Try a smaller one.' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return json({ error: 'That photo is too large. Try a smaller one.' }, 413);
  const extension = sniff(bytes);
  if (!extension) return json({ error: 'Use a JPEG, PNG or WebP image.' }, 415);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const key = `${prefixOf(user)}${hash}.${extension}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: TYPES[extension] } });
  const image = `/api/avatars/${user}/${hash}.${extension}`;
  await env.DB.prepare('update "user" set image = ?, updatedAt = ? where id = ?').bind(image, new Date().toISOString(), user).run();
  await removeOthers(env, user, key);
  return json({ image });
}

export async function serveAvatar(request: Request, env: Env, user: string, file: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  if (!USER.test(user) || !FILE.test(file)) return new Response(null, { status: 404 });
  const object = await env.FILES.get(`${prefixOf(user)}${file}`);
  if (!object) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': TYPES[file.split('.').pop() as Extension],
      // The name is the content's hash: the bytes behind a URL never change.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
