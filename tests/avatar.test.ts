import { describe, expect, it, vi } from 'vitest';

const avatarPath = '../worker/avatar.ts';
const authPath = '../worker/auth.ts';
const { handleAvatarUpload, serveAvatar } = await import(avatarPath);
const { validUsername } = await import(authPath);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);

function harness() {
  const objects = new Map<string, Uint8Array>();
  const updates: unknown[][] = [];
  let image: string | null = null;
  const env = {
    DB: { prepare: () => ({ bind: (...args: unknown[]) => ({
      first: async () => ({ image }),
      run: async () => {
        if (args[3] !== image) return { meta: { changes: 0 } };
        image = args[0] as string | null;
        updates.push(args);
        return { meta: { changes: 1 } };
      },
    }) }) },
    FILES: {
      put: vi.fn(async (key: string, bytes: Uint8Array) => void objects.set(key, bytes)),
      get: async (key: string) => (objects.has(key) ? { body: objects.get(key) } : null),
      list: async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
      delete: vi.fn(async (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]).forEach((k) => objects.delete(k))),
    },
  };
  const upload = (bytes: Uint8Array | string, method = 'PUT') =>
    handleAvatarUpload(
      new Request('https://plastic.test/api/profile/avatar', {
        method,
        ...(method === 'PUT' ? { body: bytes, headers: { 'content-length': String(typeof bytes === 'string' ? bytes.length : bytes.byteLength) } } : {}),
      }),
      env,
      'user1',
    );
  return { env, objects, updates, upload };
}

describe('profile photos', () => {
  it('stores a real image by its hash, points the account at it, and keeps only the latest', async () => {
    const h = harness();
    const first = await (await h.upload(PNG)).json();
    expect(first.image).toMatch(/^\/api\/avatars\/user1\/[a-f0-9]{64}-[a-f0-9]{32}\.png$/);
    const second = await (await h.upload(WEBP)).json();
    expect(second.image).toMatch(/\.webp$/);
    expect([...h.objects.keys()]).toEqual([`users/user1/avatar/${second.image.split('/').pop()}`]);
    expect(h.updates.at(-1)![0]).toBe(second.image);
  });

  it('keeps the winning image through overlapping uploads of the same photo', async () => {
    const h = harness();
    await h.upload(PNG);
    let release!: () => void;
    let started!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const deleting = new Promise<void>((resolve) => { started = resolve; });
    h.env.FILES.delete.mockImplementationOnce(async (keys) => {
      started();
      await paused;
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => h.objects.delete(k));
    });
    const first = h.upload(WEBP);
    await deleting;
    const winner = await (await h.upload(PNG)).json();
    release();
    await first;
    expect(h.updates.at(-1)![0]).toBe(winner.image);
    expect([...h.objects.keys()]).toEqual([`users/user1/avatar/${winner.image.split('/').pop()}`]);
  });

  it('retries atomic updates when two uploads read the same previous photo', async () => {
    const h = harness();
    await Promise.all([h.upload(PNG), h.upload(WEBP)]);
    const image = h.updates.at(-1)![0] as string;
    expect(h.updates).toHaveLength(2);
    expect([...h.objects.keys()]).toEqual([`users/user1/avatar/${image.split('/').pop()}`]);
  });

  it('continues serving photos stored under existing hash-only URLs', async () => {
    const h = harness();
    const file = `${'a'.repeat(64)}.png`;
    h.objects.set(`users/user1/avatar/${file}`, PNG);
    const response = await serveAvatar(new Request(`https://plastic.test/api/avatars/user1/${file}`), h.env, 'user1', file);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it('does not delete a new upload while a removal is finishing', async () => {
    const h = harness();
    await h.upload(PNG);
    let release!: () => void;
    let started!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const deleting = new Promise<void>((resolve) => { started = resolve; });
    h.env.FILES.delete.mockImplementationOnce(async (keys) => {
      started();
      await paused;
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => h.objects.delete(k));
    });
    const removal = h.upload('', 'DELETE');
    await deleting;
    const winner = await (await h.upload(PNG)).json();
    release();
    await removal;
    expect(h.updates.at(-1)![0]).toBe(winner.image);
    expect(h.objects.has(`users/user1/avatar/${winner.image.split('/').pop()}`)).toBe(true);
  });

  it('refuses anything that is not a raster image, whatever it claims to be', async () => {
    const h = harness();
    const svg = await h.upload('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(svg.status).toBe(415);
    expect(h.objects.size).toBe(0);
    const big = await h.upload(new Uint8Array(400 * 1024));
    expect(big.status).toBe(413);
  });

  it('removes the photo, and serves only well-formed paths with long-lived caching', async () => {
    const h = harness();
    const { image } = await (await h.upload(PNG)).json();
    const [, , , user, file] = image.split('/');
    const served = await serveAvatar(new Request(`https://plastic.test${image}`), h.env, user, file);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toContain('immutable');
    expect((await serveAvatar(new Request('https://plastic.test/x'), h.env, user, '../../secret.png')).status).toBe(404);
    expect(await (await h.upload('', 'DELETE')).json()).toEqual({ image: null });
    expect(h.objects.size).toBe(0);
  });
});

describe('usernames', () => {
  it('allows letters, numbers, dots and underscores, but not edge or doubled dots or reserved names', () => {
    for (const name of ['ada', 'ada.lovelace', 'ada_l', 'Ada99']) expect(validUsername(name), name).toBe(true);
    for (const name of ['.ada', 'ada.', 'ada..l', 'ada lovelace', 'ada!', 'admin', 'Plastic', 'support']) expect(validUsername(name), name).toBe(false);
  });
});
