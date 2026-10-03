import { describe, expect, it, vi } from 'vitest';
import { emptyDocument } from '../src/document/factory';
import { setTitle } from '../src/document/ops';
import { useEditor } from '../src/editor/store';

const rooms: { owner: string; project: string; request: Request }[] = [];
vi.mock('../worker/live.ts', () => ({
  CLIENT_ID: /^[a-z0-9]{8,32}$/,
  withPeer: (request: Request, peer: unknown) => {
    const headers = new Headers(request.headers);
    headers.set('x-plastic-peer', JSON.stringify(peer));
    return new Request(request, { headers });
  },
  room: (_env: unknown, owner: string, project: string) => ({
    changed: vi.fn(),
    fetch: async (request: Request) => {
      rooms.push({ owner, project, request });
      return new Response('room');
    },
  }),
}));
const commentCalls: { owner: string; project: string; actor: string; path: string[]; method: string }[] = [];
vi.mock('../worker/comments.ts', () => ({
  handleComments: async (request: Request, _env: unknown, owner: string, project: string, actor: string, path: string[]) => {
    commentCalls.push({ owner, project, actor, path, method: request.method });
    return new Response(null, { status: 201 });
  },
}));
// Loosely typed: the Worker is checked with its own types (tsconfig.worker.json).
const sharedPath = '../worker/shared.ts';
const { handleShared } = (await import(/* @vite-ignore */ sharedPath)) as {
  handleShared(request: Request, env: unknown, user: { id: string; name?: string; image?: string | null }, path: string[]): Promise<Response>;
};

const PREVIEW = 'f'.repeat(32);
const current = 'a'.repeat(64);
const older = 'b'.repeat(64);
const prefix = 'users/owner/projects/demo/';

function harness(options: { archived?: boolean } = {}) {
  const objects = new Map<string, string>([
    [`${prefix}revisions/index.html/${current}`, '<p>now</p>'],
    [`${prefix}revisions/index.html/${older}`, '<p>secret draft</p>'],
    [`${prefix}assets/logo.png`, 'png-bytes'],
  ]);
  const writes: string[] = [];
  const row = { owner_id: 'owner', id: 'demo', title: 'Demo', updated_at: 1, files: JSON.stringify({ 'index.html': current }), owner_name: 'Olive' };
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => (sql.includes('preview_id = ?') && args[0] === PREVIEW && !options.archived ? row : null),
          run: async () => {
            writes.push(sql);
            return { meta: { changes: 1 } };
          },
        }),
      }),
    },
    FILES: {
      get: async (key: string) => (objects.has(key) ? { body: objects.get(key), etag: 'e', httpEtag: '"e"' } : null),
      head: async (key: string) => objects.get(key) ?? null,
      put: async (key: string) => void writes.push(`put ${key}`),
      delete: async (key: string) => void writes.push(`delete ${key}`),
      list: async () => ({ objects: [], truncated: false }),
    },
  };
  const call = (path: string[], init: RequestInit & { query?: string } = {}, user = { id: 'viewer', name: 'Vic' }) =>
    handleShared(new Request(`https://plastic.test/api/shared/${path.join('/')}${init.query ?? ''}`, init), env, user, path);
  return { call, writes, objects };
}

describe('opening a file through its shared link', () => {
  it('describes the file to any signed-in person, without exposing account ids', async () => {
    const h = harness();
    const response = await h.call([PREVIEW]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'demo', title: 'Demo', owner: { name: 'Olive' }, owned: false, files: { 'index.html': current } });
    expect(await (await h.call([PREVIEW], {}, { id: 'owner', name: 'Olive' })).json()).toMatchObject({ owned: true });
  });

  it('serves the current files and images', async () => {
    const h = harness();
    const file = await h.call([PREVIEW, 'files', 'index.html'], { query: `?v=${current}` });
    expect(await file.text()).toBe('<p>now</p>');
    expect(file.headers.get('content-security-policy')).toBe('sandbox allow-same-origin');
    expect(await (await h.call([PREVIEW, 'assets', 'logo.png'])).text()).toBe('png-bytes');
  });

  it('never serves earlier revisions or files the project does not have', async () => {
    const h = harness();
    expect((await h.call([PREVIEW, 'files', 'index.html'], { query: `?v=${older}` })).status).toBe(404);
    expect((await h.call([PREVIEW, 'files', 'styles.css'])).status).toBe(404);
    expect((await h.call([PREVIEW, 'files', 'index.html'], { query: '?v=../../x' })).status).toBe(400);
    expect((await h.call([PREVIEW, 'assets', '..%2Fsecret.png'])).status).toBe(404);
  });

  it('refuses every write', async () => {
    const h = harness();
    for (const [path, method] of [
      [[PREVIEW, 'files', 'index.html'], 'PUT'],
      [[PREVIEW, 'assets', 'logo.png'], 'PUT'],
      [[PREVIEW, 'commit'], 'POST'],
      [[PREVIEW], 'DELETE'],
      [[PREVIEW, 'place'], 'PATCH'],
    ] as const) {
      const response = await h.call([...path], { method, body: method === 'DELETE' ? undefined : '{"files":{}}' });
      expect(response.status, `${method} ${path.join('/')}`).toBe(405);
    }
    expect(h.writes).toEqual([]);
    expect(h.objects.get(`${prefix}revisions/index.html/${current}`)).toBe('<p>now</p>');
  });

  it('does not open archived files or unknown links', async () => {
    expect((await harness({ archived: true }).call([PREVIEW])).status).toBe(404);
    expect((await harness().call(['0'.repeat(32)])).status).toBe(404);
    expect((await harness().call(['not-a-preview'])).status).toBe(404);
  });

  it('joins the owner’s room as a viewer, with an identity from the session', async () => {
    rooms.length = 0;
    const h = harness();
    const ok = await h.call([PREVIEW, 'live'], { query: '?client=abcdef12', headers: { upgrade: 'websocket', 'x-plastic-peer': '{"role":"owner"}' } });
    expect(await ok.text()).toBe('room');
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ owner: 'owner', project: 'demo' });
    expect(JSON.parse(rooms[0]!.request.headers.get('x-plastic-peer')!)).toMatchObject({ id: 'abcdef12', name: 'Vic', role: 'viewer' });
    expect((await h.call([PREVIEW, 'live'], { query: '?client=abcdef12' })).status).toBe(426);
    expect((await h.call([PREVIEW, 'live'], { query: '?client=NO', headers: { upgrade: 'websocket' } })).status).toBe(400);
  });
});

describe('read-only editor', () => {
  it('ignores edits, undo and editing tools, but shows the owner’s saved changes', () => {
    const store = useEditor.getState();
    store.load(setTitle(emptyDocument(), 'Before'));
    store.setReadOnly(true);
    try {
      store.apply('Edit', (d) => setTitle(d, 'Edited'));
      expect(useEditor.getState().doc.title).toBe('Before');
      store.begin();
      expect(useEditor.getState().tx).toBeNull();
      store.setTool({ kind: 'frame' });
      expect(useEditor.getState().tool.kind).toBe('select');
      store.setTool({ kind: 'hand' });
      expect(useEditor.getState().tool.kind).toBe('hand');
      store.apply('External change', (d) => setTitle(d, 'Saved by owner'), { remote: true });
      expect(useEditor.getState().doc.title).toBe('Saved by owner');
      store.undo();
      expect(useEditor.getState().doc.title).toBe('Saved by owner');
      expect(useEditor.getState().history.past).toHaveLength(0);
    } finally {
      store.setReadOnly(false);
    }
  });
});

describe('commenting through a shared link', () => {
  it('lets a viewer comment on the owner’s file as themselves, while files stay read-only', async () => {
    const h = harness();
    commentCalls.length = 0;
    const posted = await h.call([PREVIEW, 'comments'], { method: 'POST', body: JSON.stringify({ body: 'Nice' }) });
    expect(posted.status).toBe(201);
    expect(commentCalls).toEqual([{ owner: 'owner', project: 'demo', actor: 'viewer', path: [], method: 'POST' }]);
    expect((await h.call([PREVIEW, 'files', 'index.html'], { method: 'PUT', body: 'x' })).status).toBe(405);
    expect((await h.call(['0'.repeat(32), 'comments'], { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
