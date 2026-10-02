/**
 * Live sync: one Durable Object per (user, project) holds a WebSocket per open editor. After a
 * save, the editor announces the new file versions over its socket and the room relays them to
 * every other editor; they fetch just the changed files (cached by version) and apply them as an
 * "External change" (undoable), the same path local file-watching uses.
 *
 * Cost: sockets use the hibernation API (an idle room uses no duration), heartbeats are answered
 * by the runtime without waking the room, and an incoming WebSocket message is billed at 1/20 of
 * a request — far cheaper than the Worker calling the room on every save. Saves made without a
 * socket (API, agents) are relayed by the Worker via `changed()`.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';

export interface ChangeNotice {
  /** Every file the project now has, with its version. */
  readonly files: Readonly<Record<string, string>>;
  /** The editor that saved; it already has the change. */
  readonly from: string;
}

const FILE_NAME = /^[a-z0-9][a-z0-9_.-]*\.(html|css|json)$/i;
const MAX_MESSAGE = 64 * 1024;

function isVersionMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 500 && entries.every(([n, v]) => FILE_NAME.test(n) && typeof v === 'string' && v.length <= 64);
}

/** Client ids identify an editor tab (random, opaque). */
export const CLIENT_ID = /^[a-z0-9]{8,32}$/;

export class ProjectRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** Called by the Worker (already authenticated) with a WebSocket upgrade request. */
  override async fetch(request: Request): Promise<Response> {
    const client = new URL(request.url).searchParams.get('client') ?? '';
    if (!CLIENT_ID.test(client) || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    const { 0: browser, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [client]);
    return new Response(null, { status: 101, webSocket: browser });
  }

  changed(notice: ChangeNotice): number {
    const message = JSON.stringify({ type: 'changed', files: notice.files });
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (this.ctx.getTags(ws).includes(notice.from)) continue;
      try {
        ws.send(message);
        sent++;
      } catch {
        // closing; the runtime cleans it up
      }
    }
    return sent;
  }

  /** An editor announcing its own save: relay the new versions to the others. */
  override webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    let message: { type?: unknown; files?: unknown };
    try {
      message = JSON.parse(data) as typeof message;
    } catch {
      return;
    }
    if (message.type !== 'changed' || !isVersionMap(message.files)) return;
    this.changed({ files: message.files, from: this.ctx.getTags(ws)[0] ?? '' });
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    ws.close(code, reason);
  }
}

export function room(env: Env, owner: string, project: string): DurableObjectStub<ProjectRoom> {
  return env.ROOMS.get(env.ROOMS.idFromName(`${owner}/${project}`));
}
