import { describe, expect, it, vi } from 'vitest';

vi.mock('../worker/live.ts', () => ({ CLIENT_ID: /^[a-z0-9]{8,32}$/, room: () => ({ changed: vi.fn() }) }));
const modulePath = '../worker/projects.ts';
const { handleProjects } = await import(modulePath);
const owner = 'user',
  id = 'test',
  prefix = 'users/user/projects/test/';
const oldVersion = 'a'.repeat(32);
const sha256 = async (data: ArrayBuffer | string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

function harness() {
  const objects = new Map<string, { text: string; etag: string }>();
  const row = { id, title: 'Test', files: JSON.stringify({ 'index.html': oldVersion }) };
  objects.set(prefix + 'index.html', { text: 'old', etag: oldVersion });
  let race = false;
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => row,
        run: async () => {
          if (sql.startsWith('update project set files')) {
            if (race || args[5] !== row.files) return { meta: { changes: 0 } };
            row.files = String(args[0]);
          }
          return { meta: { changes: 1 } };
        },
      }),
    }),
  };
  const FILES = {
    get: async (key: string) => {
      const o = objects.get(key);
      return o ? { body: o.text, etag: o.etag, httpEtag: `"${o.etag}"` } : null;
    },
    head: async (key: string) => objects.get(key) ?? null,
    // Like R2: accepts a stream or bytes, and rejects a body that doesn't match a given sha256.
    put: async (key: string, body: ReadableStream | ArrayBuffer | null, options?: { sha256?: string }) => {
      const bytes = await new Response(body).arrayBuffer();
      if (options?.sha256 && options.sha256 !== (await sha256(bytes))) throw new Error('checksum mismatch');
      objects.set(key, { text: new TextDecoder().decode(bytes), etag: 'b'.repeat(32) });
    },
  };
  const env = { DB, FILES };
  const call = (path: string[], method = 'GET', body?: unknown, version?: string, headers: Record<string, string> = {}) =>
    handleProjects(
      new Request(`https://plastic.test/api/projects/test${version ? `?v=${version}` : ''}`, {
        method,
        ...(body !== undefined
          ? {
              body: typeof body === 'string' ? body : JSON.stringify(body),
              headers: {
                ...headers,
                'content-length': headers['content-length'] ?? String(
                  new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).length,
                ),
              },
            }
          : {}),
      }),
      env,
      owner,
      [id, ...path],
    );
  return {
    row,
    objects,
    call,
    race: () => {
      race = true;
    },
  };
}

describe('cloud project revisions', () => {
  it('streams uploads with a browser checksum and rejects a body that does not match', async () => {
    const h = harness();
    const version = await sha256('streamed');
    const ok = await h.call(['files', 'index.html'], 'PUT', 'streamed', undefined, { 'x-plastic-sha256': version });
    expect(await ok.json()).toEqual({ version });
    expect(h.objects.get(`${prefix}revisions/index.html/${version}`)?.text).toBe('streamed');
    const bad = await h.call(['files', 'index.html'], 'PUT', 'tampered', undefined, { 'x-plastic-sha256': version });
    expect(bad.status).toBe(400);
    expect(h.objects.get(`${prefix}revisions/index.html/${version}`)?.text).toBe('streamed');
  });
  it('only hashes small uploads from clients without checksums', async () => {
    const h = harness();
    const large = await h.call(['files', 'index.html'], 'PUT', 'x', undefined, { 'content-length': String(2 * 1024 * 1024) });
    expect(large.status).toBe(428);
  });
  it('uploads immutable content hashes without replacing committed legacy bytes', async () => {
    const h = harness();
    const a = await h.call(['files', 'index.html'], 'PUT', 'first');
    const { version } = await a.json();
    expect(version).toMatch(/^[a-f0-9]{64}$/);
    await h.call(['files', 'index.html'], 'PUT', 'second');
    expect(await (await h.call(['files', 'index.html'], 'GET', undefined, version)).text()).toBe('first');
    expect(await (await h.call(['files', 'index.html'])).text()).toBe('old');
  });
  it('does not serve newer legacy bytes under an old immutable URL', async () => {
    const h = harness();
    h.objects.set(prefix + 'index.html', { text: 'new', etag: 'b'.repeat(32) });
    const response = await h.call(['files', 'index.html'], 'GET', undefined, oldVersion);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects stale manifest commits before changing the project', async () => {
    const h = harness();
    const before = h.row.files;
    const response = await h.call(['commit'], 'POST', { files: { 'index.html': oldVersion }, base: {} });
    expect(response.status).toBe(409);
    expect(h.row.files).toBe(before);
  });
  it('rejects nonexistent revision references', async () => {
    const h = harness();
    const response = await h.call(['commit'], 'POST', {
      files: { 'index.html': 'c'.repeat(64) },
      base: { 'index.html': oldVersion },
    });
    expect(response.status).toBe(400);
  });
  it('commits uploaded revisions and keeps the previous revision readable', async () => {
    const h = harness();
    const { version } = await (await h.call(['files', 'index.html'], 'PUT', 'new')).json();
    const response = await h.call(['commit'], 'POST', {
      files: { 'index.html': version },
      base: { 'index.html': oldVersion },
    });
    expect(response.status).toBe(204);
    expect(await (await h.call(['files', 'index.html'])).text()).toBe('new');
    expect(await (await h.call(['files', 'index.html'], 'GET', undefined, oldVersion)).text()).toBe('old');
  });
  it('rejects a writer that races between validation and database commit', async () => {
    const h = harness();
    h.race();
    const response = await h.call(['commit'], 'POST', {
      files: { 'index.html': oldVersion },
      base: { 'index.html': oldVersion },
    });
    expect(response.status).toBe(409);
  });
  it('sandboxes directly opened project HTML and validates requested versions', async () => {
    const h = harness();
    const response = await h.call(['files', 'index.html']);
    expect(response.headers.get('content-security-policy')).toBe('sandbox allow-same-origin');
    expect((await h.call(['files', 'index.html'], 'GET', undefined, 'invalid')).status).toBe(400);
  });
});
