import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CHAT_LENGTH, MAX_PRESENCE_MESSAGE, PEER_COLORS, RateLimit, parseParticipant, parsePresenceMessage, participantFor, safeImage,
} from '../src/editor/presenceProtocol';
import { closeCursorChat, connectPresence, moveCursor, openCursorChat, receivePresence, setCursorChat, usePresence } from '../src/editor/presence';
import type { PresenceLink } from '../src/serialization/storage';

// The room (worker/live.ts) extends Cloudflare's DurableObject; a stand-in is enough to drive it.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
(globalThis as Record<string, unknown>).WebSocketRequestResponsePair ??= class { constructor(public request: string, public response: string) {} };

const peer = (id: string, role: 'owner' | 'viewer' = 'viewer') => participantFor(id, { id: `user-${id}`, name: `Person ${id}` }, role);

describe('presence messages', () => {
  it('accepts cursors and chat, keeping only validated fields', () => {
    expect(parsePresenceMessage(JSON.stringify({ t: 'c', p: 'index.html', x: 10.123, y: -4, extra: 'x'.repeat(50) }))).toEqual({ t: 'c', p: 'index.html', x: 10.1, y: -4 });
    expect(parsePresenceMessage('{"t":"c"}')).toEqual({ t: 'c' });
    expect(parsePresenceMessage(JSON.stringify({ t: 'm', m: 'hi', d: true }))).toEqual({ t: 'm', m: 'hi', d: true });
    expect(parsePresenceMessage(JSON.stringify({ t: 'm', m: '' }))).toEqual({ t: 'm', m: '', d: false });
  });

  it('rejects malformed, oversized or mistyped messages', () => {
    const bad = [
      undefined, 42, new ArrayBuffer(4), '', 'not json', '[]', 'null', '"c"',
      '{"t":"x"}', '{"type":"changed","files":{}}',
      JSON.stringify({ t: 'c', p: 'index.html', x: '1', y: 2 }),
      JSON.stringify({ t: 'c', p: 'index.html', x: 1 }),
      JSON.stringify({ t: 'c', p: 'index.html', x: 1e9, y: 0 }),
      JSON.stringify({ t: 'c', p: '../secret.html', x: 1, y: 2 }),
      JSON.stringify({ t: 'c', p: 'styles.css', x: 1, y: 2 }),
      '{"t":"c","p":"index.html","x":NaN,"y":0}',
      JSON.stringify({ t: 'm', m: 5 }),
      JSON.stringify({ t: 'm', m: 'hi', d: 'yes' }),
      JSON.stringify({ t: 'm', m: 'x'.repeat(MAX_CHAT_LENGTH + 1) }),
      JSON.stringify({ t: 'c', pad: 'x'.repeat(MAX_PRESENCE_MESSAGE) }),
    ];
    for (const data of bad) expect(parsePresenceMessage(data), String(data)).toBeNull();
  });

  it('counts chat length in characters and strips control and direction-override characters', () => {
    const emoji = '😀'.repeat(MAX_CHAT_LENGTH);
    expect(parsePresenceMessage(JSON.stringify({ t: 'm', m: emoji }))).toEqual({ t: 'm', m: emoji, d: false });
    expect(parsePresenceMessage(JSON.stringify({ t: 'm', m: 'a‮b\nc\u0000' }))).toEqual({ t: 'm', m: 'a b c ', d: false });
  });

  it('builds participants from the account, with safe names, photos and colors', () => {
    const a = participantFor('tab12345', { id: 'u1', name: '  Ada‮  ', image: 'javascript:alert(1)' }, 'viewer');
    expect(a).toMatchObject({ id: 'tab12345', name: 'Ada', image: null, role: 'viewer' });
    expect(PEER_COLORS).toContain(a.color);
    expect(participantFor('tab99999', { id: 'u1' }, 'owner')).toMatchObject({ key: a.key, color: a.color, name: 'Someone' });
    expect(safeImage('/api/avatars/u1/abc.webp')).toBe('/api/avatars/u1/abc.webp');
    expect(safeImage('https://avatars.example.com/u/1')).toBe('https://avatars.example.com/u/1');
    expect(safeImage('http://example.com/a.png')).toBeNull();
    expect(parseParticipant({ ...a, color: 'red' })).toBeNull();
    expect(parseParticipant({ ...a, role: 'admin' })).toBeNull();
    expect(parseParticipant(a)).toEqual(a);
  });

  it('limits each connection to a burst, then a steady rate', () => {
    const limit = new RateLimit(10, 5, 0);
    expect(Array.from({ length: 8 }, () => limit.take(0)).filter(Boolean)).toHaveLength(5);
    expect(limit.take(50)).toBe(false);
    expect(limit.take(100)).toBe(true);
  });
});

// --- the room ---------------------------------------------------------------------------------

class FakeSocket {
  readonly sent: string[] = [];
  readyState = 1;
  private attachment: unknown;
  constructor(public readonly tag: string) {}
  send(text: string) { this.sent.push(text); }
  close() { this.readyState = 3; }
  serializeAttachment(value: unknown) { this.attachment = value; }
  deserializeAttachment() { return this.attachment; }
  messages() { return this.sent.map((t) => JSON.parse(t)); }
}

// Typed loosely: the room is checked with the Worker's types (tsconfig.worker.json), not the DOM's.
const livePath = '../worker/live.ts';
type Live = {
  ProjectRoom: new (ctx: unknown, env: unknown) => {
    fetch(request: Request): Promise<Response>;
    webSocketMessage(ws: unknown, data: unknown): void;
    webSocketClose(ws: unknown, code: number, reason: string): void;
  };
  withPeer(request: Request, peer: unknown): Request;
};

async function makeRoom() {
  const { ProjectRoom, withPeer } = (await import(/* @vite-ignore */ livePath)) as Live;
  const sockets: FakeSocket[] = [];
  const ctx = {
    setWebSocketAutoResponse() {},
    acceptWebSocket(ws: FakeSocket, tags: string[]) { (ws as { tag: string }).tag = tags[0]!; sockets.push(ws); },
    getWebSockets: (tag?: string) => sockets.filter((s) => !tag || s.tag === tag),
    getTags: (ws: FakeSocket) => [ws.tag],
  };
  // WebSocketPair: the room keeps one end, the browser gets the other.
  (globalThis as Record<string, unknown>).WebSocketPair = class { 0 = new FakeSocket(''); 1 = new FakeSocket(''); };
  const room = new ProjectRoom(ctx, {});
  const join = async (p: ReturnType<typeof peer>, headerPeer: unknown = p) => {
    const request = new Request(`https://room/live?client=${p.id}`, { headers: { upgrade: 'websocket' } });
    const response = await room.fetch(headerPeer === p ? withPeer(request, p) : new Request(request, { headers: { upgrade: 'websocket', 'x-plastic-peer': JSON.stringify(headerPeer) } }));
    return { response, socket: sockets.at(-1)! };
  };
  return { room, join, sockets };
}

// Responses with status 101 aren't constructible in Node; the room's own logic runs before that.
const OriginalResponse = Response;
beforeEach(() => {
  globalThis.Response = class extends OriginalResponse {
    constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
      super(body, init?.status === 101 ? { ...init, status: 200 } : init);
    }
  } as typeof Response;
});
afterEach(() => {
  globalThis.Response = OriginalResponse;
});

describe('project room', () => {
  it('greets with who is here, announces joins, and relays validated presence', async () => {
    const { room, join } = await makeRoom();
    const owner = peer('owner001', 'owner');
    const viewer = peer('viewer01');
    const a = (await join(owner)).socket;
    const b = (await join(viewer)).socket;
    expect(a.messages()).toEqual([{ t: 'hello', me: owner, peers: [] }, { t: 'join', peer: viewer }]);
    expect(b.messages()).toEqual([{ t: 'hello', me: viewer, peers: [owner] }]);
    room.webSocketMessage(b as never, JSON.stringify({ t: 'c', p: 'index.html', x: 1, y: 2, id: 'owner001', name: 'spoof' }));
    expect(a.messages().at(-1)).toEqual({ t: 'c', p: 'index.html', x: 1, y: 2, id: 'viewer01' });
    expect(b.sent).toHaveLength(1); // never echoed back
  });

  it('drops invalid, oversized and binary messages', async () => {
    const { room, join } = await makeRoom();
    const a = (await join(peer('owner001', 'owner'))).socket;
    const b = (await join(peer('viewer01'))).socket;
    const before = a.sent.length;
    for (const data of ['{"t":"m","m":7}', 'x'.repeat(2000), JSON.stringify({ t: 'm', m: 'x'.repeat(500) }), new ArrayBuffer(8)]) room.webSocketMessage(b as never, data as never);
    expect(a.sent.length).toBe(before);
  });

  it('only lets the owner announce file changes', async () => {
    const { room, join } = await makeRoom();
    const owner = (await join(peer('owner001', 'owner'))).socket;
    const viewer = (await join(peer('viewer01'))).socket;
    const other = (await join(peer('viewer02'))).socket;
    const change = JSON.stringify({ type: 'changed', files: { 'index.html': 'a'.repeat(64) } });
    room.webSocketMessage(viewer as never, change);
    expect(owner.messages().some((m) => m.type === 'changed')).toBe(false);
    room.webSocketMessage(owner as never, change);
    expect(viewer.messages().at(-1)).toEqual({ type: 'changed', files: { 'index.html': 'a'.repeat(64) } });
    expect(other.messages().at(-1)).toEqual({ type: 'changed', files: { 'index.html': 'a'.repeat(64) } });
  });

  it('rate-limits a flood of presence messages', async () => {
    const { room, join } = await makeRoom();
    const a = (await join(peer('owner001', 'owner'))).socket;
    const b = (await join(peer('viewer01'))).socket;
    const before = a.sent.length;
    for (let i = 0; i < 200; i++) room.webSocketMessage(b as never, JSON.stringify({ t: 'c', p: 'index.html', x: i, y: 0 }));
    expect(a.sent.length - before).toBeLessThanOrEqual(41);
  });

  it('refuses connections without a participant from the Worker', async () => {
    const { join } = await makeRoom();
    const p = peer('viewer01');
    expect((await join(p, null)).response.status).toBe(400);
    expect((await join(p, { ...p, id: 'someone9' })).response.status).toBe(400);
  });

  it('announces when someone leaves', async () => {
    const { room, join } = await makeRoom();
    const a = (await join(peer('owner001', 'owner'))).socket;
    const b = (await join(peer('viewer01'))).socket;
    b.readyState = 3;
    room.webSocketClose(b as never, 1000, '');
    expect(a.messages().at(-1)).toEqual({ t: 'leave', id: 'viewer01' });
  });
});

// --- the editor's side --------------------------------------------------------------------------

describe('editor presence', () => {
  let sent: unknown[];
  let listener: (message: unknown) => void;
  let disconnect: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    const link: PresenceLink = { send: (m) => sent.push(m), subscribe: (fn) => ((listener = fn), () => {}) };
    disconnect = connectPresence(link);
  });
  afterEach(() => {
    disconnect();
    vi.useRealTimers();
  });

  const hello = (...peers: ReturnType<typeof peer>[]) => listener({ t: 'hello', me: peer('mytab001', 'owner'), peers });

  it('sends nothing while alone in the file', () => {
    hello();
    moveCursor({ x: 1, y: 2, page: 'index.html' });
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([]);
  });

  it('throttles cursor updates and always sends the latest position', () => {
    hello(peer('viewer01'));
    for (let i = 0; i < 20; i++) {
      moveCursor({ x: i, y: 0, page: 'index.html' });
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(200);
    expect(sent.length).toBeLessThanOrEqual(4);
    expect(sent.at(-1)).toEqual({ t: 'c', p: 'index.html', x: 19, y: 0 });
    moveCursor(null);
    vi.advanceTimersByTime(200);
    expect(sent.at(-1)).toEqual({ t: 'c' });
  });

  it('streams chat after a pause in typing, and fades it after Enter', () => {
    hello(peer('viewer01'));
    openCursorChat({ x: 0, y: 0, page: 'index.html' });
    setCursorChat('h');
    setCursorChat('hi');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(sent).toEqual([{ t: 'm', m: 'hi', d: false }]);
    setCursorChat('x'.repeat(MAX_CHAT_LENGTH + 20));
    expect(usePresence.getState().chat?.text).toHaveLength(MAX_CHAT_LENGTH);
    closeCursorChat();
    expect(sent.at(-1)).toEqual({ t: 'm', m: 'x'.repeat(MAX_CHAT_LENGTH), d: true });
    expect(usePresence.getState().chat?.done).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(usePresence.getState().chat).toBeNull();
  });

  it('tracks peers, their cursors and chat, and ignores malformed room messages', () => {
    hello(peer('viewer01'));
    receivePresence({ t: 'c', id: 'viewer01', p: 'index.html', x: 5, y: 6 });
    receivePresence({ t: 'm', id: 'viewer01', m: 'hello', d: true });
    receivePresence({ t: 'join', peer: { id: 'bad', name: 1 } });
    receivePresence({ t: 'c', id: 'nobody00', p: 'index.html', x: 1, y: 1 });
    const { peers } = usePresence.getState();
    expect(Object.keys(peers)).toEqual(['viewer01']);
    expect(peers.viewer01).toMatchObject({ cursor: { page: 'index.html', x: 5, y: 6 }, chat: { text: 'hello', done: true } });
    vi.advanceTimersByTime(5000);
    expect(usePresence.getState().peers.viewer01?.chat).toBeNull();
    receivePresence({ t: 'leave', id: 'viewer01' });
    expect(usePresence.getState().peers).toEqual({});
  });
});
