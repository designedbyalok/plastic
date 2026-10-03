/**
 * Profile photos. The browser crops, rotates and scales the photo and uploads a small square
 * image; the Worker stores it under the person's prefix and points their account at it.
 *
 *   PUT    /api/profile/avatar               signed in   raw image (WebP, PNG or JPEG, ≤ 300 KB) → { image }
 *   DELETE /api/profile/avatar               signed in   remove the photo → { image: null }
 *   GET    /api/avatars/<user>/<hash>-<upload>.<ext>  public  immutable image (cached forever)
 *
 * Only real raster images are accepted (checked by their first bytes, never SVG). Each upload
 * has a unique immutable key; an atomic account update retires only the photo it replaced.
 */
import type { Env } from './env.ts';

const MAX_BYTES = 300 * 1024;
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' } as const;
type Extension = keyof typeof TYPES;
const prefixOf = (user: string) => `users/${user}/avatar/`;
// Existing hash-only URLs remain readable.
const FILE = /^[a-f0-9]{64}(?:-[a-f0-9]{32})?\.(webp|png|jpg)$/;
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

/** Compare-and-swap protects uploads/removals made from different tabs or Worker isolates. */
async function replacePhoto(env: Env, user: string, image: string | null): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await env.DB.prepare('select image from "user" where id = ?').bind(user).first<{ image: string | null }>();
    if (!previous) return false;
    const updated = await env.DB.prepare('update "user" set image = ?, updatedAt = ? where id = ? and image is ?')
      .bind(image, new Date().toISOString(), user, previous.image).run();
    if (updated.meta.changes !== 1) continue;
    const prefix = `/api/avatars/${user}/`;
    const oldFile = previous.image?.startsWith(prefix) ? previous.image.slice(prefix.length) : null;
    // Never enumerate/delete other uploads. Unique keys cannot become active again after
    // replacement, even if the same photo is uploaded while this deletion is in flight.
    if (oldFile && FILE.test(oldFile)) {
      try { await env.FILES.delete(`${prefixOf(user)}${oldFile}`); }
      catch { console.error('Could not remove a retired profile photo.'); }
    }
    return true;
  }
  return false;
}

export async function handleAvatarUpload(request: Request, env: Env, user: string): Promise<Response> {
  if (request.method === 'DELETE') {
    if (!await replacePhoto(env, user, null)) return json({ error: 'Your photo changed elsewhere. Try again.' }, 409);
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
  const file = `${hash}-${crypto.randomUUID().replace(/-/g, '')}.${extension}`;
  const key = `${prefixOf(user)}${file}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: TYPES[extension] } });
  const image = `/api/avatars/${user}/${file}`;
  const published = await replacePhoto(env, user, image);
  if (!published) {
    await env.FILES.delete(key);
    return json({ error: 'Your photo changed elsewhere. Try again.' }, 409);
  }
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
