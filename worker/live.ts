/**
 * Live sync: one Durable Object per (user, project) holds a WebSocket per open editor. After a
 * save, the editor announces the new file versions over its socket and the room relays them to
 * every other editor; they fetch just the changed files (cached by version) and apply them as an
 * "External change" (undoable), the same path local file-watching uses.
 *
 * The same room carries presence: who is in the file (the owner's tabs and people viewing it
 * through its shared link), their cursors and cursor chat (src/editor/presenceProtocol.ts).
 * Who someone is comes from their session, attached by the Worker; viewers can only send
 * presence, never file changes. Every message is size-checked, validated field by field and
 * rebuilt before it is relayed, and each connection has a message budget.
 *
 * Cost: sockets use the hibernation API (an idle room uses no duration), heartbeats are answered
 * by the runtime without waking the room, and an incoming WebSocket message is billed at 1/20 of
 * a request — far cheaper than the Worker calling the room on every save. Saves made without a
 * socket (API, agents) are relayed by the Worker via `changed()`.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { parseParticipant, parsePresenceMessage, RateLimit, type Participant, type RoomMessage } from '../src/editor/presenceProtocol.ts';

export interface ChangeNotice {
  /** Every file the project now has, with its version. */
  readonly files: Readonly<Record<string, string>>;
  /** The editor that saved; it already has the change. */
  readonly from: string;
}

const FILE_NAME = /^[a-z0-9][a-z0-9_.-]*\.(html|css|json)$/i;
const MAX_MESSAGE = 64 * 1024;
/** Who is connecting, set by the Worker from the session (never by the browser). */
export const PEER_HEADER = 'x-plastic-peer';

function isVersionMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 500 && entries.every(([n, v]) => FILE_NAME.test(n) && typeof v === 'string' && v.length <= 64);
}

/** Client ids identify an editor tab (random, opaque). */
export const CLIENT_ID = /^[a-z0-9]{8,32}$/;

/** The upgrade request for the room, carrying who is connecting. */
export function withPeer(request: Request, peer: Participant): Request {
  const headers = new Headers(request.headers);
  headers.set(PEER_HEADER, JSON.stringify(peer));
  return new Request(request, { headers });
}

/** A file-change announcement from an editor, or null. */
export function parseChangeMessage(data: string): Record<string, string> | null {
  if (data.length > MAX_MESSAGE) return null;
  let message: { type?: unknown; files?: unknown };
  try {
    message = JSON.parse(data) as typeof message;
  } catch {
    return null;
  }
  return message?.type === 'changed' && isVersionMap(message.files) ? message.files : null;
}

export class ProjectRoom extends DurableObject<Env> {
  /** Message budgets per connection. In memory only: a room waking from hibernation starts fresh. */
  private readonly budgets = new WeakMap<WebSocket, RateLimit>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** Called by the Worker (already authenticated) with a WebSocket upgrade request. */
  override async fetch(request: Request): Promise<Response> {
    const client = new URL(request.url).searchParams.get('client') ?? '';
    if (!CLIENT_ID.test(client) || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    let peer: Participant | null = null;
    try {
      peer = parseParticipant(JSON.parse(request.headers.get(PEER_HEADER) ?? 'null'));
    } catch {
      // handled below
    }
    if (!peer || peer.id !== client) return new Response('Missing participant.', { status: 400 });
    // A tab reconnecting replaces its previous connection.
    for (const ws of this.ctx.getWebSockets(client)) ws.close(1000, 'Replaced');
    const { 0: browser, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [client]);
    server.serializeAttachment(peer);
    const others = this.participants().filter((p) => p.id !== client);
    server.send(JSON.stringify({ t: 'hello', me: peer, peers: others } satisfies RoomMessage));
    this.broadcast({ t: 'join', peer }, client);
    return new Response(null, { status: 101, webSocket: browser });
  }

  changed(notice: ChangeNotice): number {
    return this.broadcast({ type: 'changed', files: notice.files }, notice.from);
  }

  override webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    if (typeof data !== 'string') return;
    const peer = this.peerOf(ws);
    if (!peer) return;
    // An editor announcing its own save: relay the new versions to the others. Owner only.
    const files = peer.role === 'owner' ? parseChangeMessage(data) : null;
    if (files) {
      this.broadcast({ type: 'changed', files }, peer.id);
      return;
    }
    const message = parsePresenceMessage(data);
    if (!message) return;
    let budget = this.budgets.get(ws);
    if (!budget) this.budgets.set(ws, (budget = new RateLimit()));
    if (!budget.take()) return;
    this.broadcast({ ...message, id: peer.id }, peer.id);
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    this.left(ws);
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  override webSocketError(ws: WebSocket): void {
    this.left(ws);
  }

  private left(ws: WebSocket): void {
    const peer = this.peerOf(ws);
    if (!peer) return;
    // Another connection from the same tab (a reconnect) keeps it in the room.
    if (this.ctx.getWebSockets(peer.id).some((other) => other !== ws && other.readyState === WebSocket.OPEN)) return;
    this.broadcast({ t: 'leave', id: peer.id }, peer.id);
  }

  private peerOf(ws: WebSocket): Participant | null {
    try {
      return parseParticipant(ws.deserializeAttachment());
    } catch {
      return null;
    }
  }

  private participants(): Participant[] {
    const byId = new Map<string, Participant>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const peer = this.peerOf(ws);
      if (peer) byId.set(peer.id, peer);
    }
    return [...byId.values()];
  }

  private broadcast(message: RoomMessage | { type: 'changed'; files: Readonly<Record<string, string>> } | { type: 'comments' }, from: string): number {
    const text = JSON.stringify(message);
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (this.ctx.getTags(ws).includes(from) || ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(text);
        sent++;
      } catch {
        // closing; the runtime cleans it up
      }
    }
    return sent;
  }

  /** Something kept beside the files changed (comments): everyone in the room fetches it again. */
  signal(kind: 'comments'): number {
    return this.broadcast({ type: kind }, '');
  }
}

export function room(env: Env, owner: string, project: string): DurableObjectStub<ProjectRoom> {
  return env.ROOMS.get(env.ROOMS.idFromName(`${owner}/${project}`));
}
