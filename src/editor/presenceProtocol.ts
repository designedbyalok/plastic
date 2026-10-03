/**
 * Presence and cursor chat over a file's live room (worker/live.ts). Shared by the Worker, which
 * validates every message, and the editor. Messages are small JSON objects with short keys:
 * the free plan bills an incoming WebSocket message at 1/20 of a request, so the editor sends a
 * cursor at most CURSOR_INTERVAL_MS apart, only while the pointer moves and someone else is there.
 *
 * Editor → room
 *   { t: 'c', p, x, y }        cursor on page file `p`, in world coordinates
 *   { t: 'c' }                 cursor left the canvas
 *   { t: 'm', m, d? }          cursor chat text; d: finished (Enter or Escape), fades out
 *
 * Room → editor
 *   { t: 'hello', me, peers }    sent once on connect: this tab as others see it, and everyone else here
 *   { t: 'join', peer } / { t: 'leave', id }
 *   { t: 'c', id, p?, x?, y? } / { t: 'm', id, m, d }   relayed, already validated
 */

export const MAX_CHAT_LENGTH = 100;
/** A presence message from an editor is never longer than this (characters of JSON). */
export const MAX_PRESENCE_MESSAGE = 512;
export const CURSOR_INTERVAL_MS = 100;
export const CHAT_DEBOUNCE_MS = 150;
/** A finished chat bubble stays this long, then fades. */
export const CHAT_FADE_MS = 4000;
/** World coordinates beyond this are not a real cursor. */
const MAX_COORDINATE = 1_000_000;
const PAGE_FILE = /^[a-z0-9][a-z0-9_.-]{0,63}\.html$/i;
export const PEER_ID = /^[a-z0-9]{8,32}$/;

export const PEER_COLORS = ['#e5484d', '#f76b15', '#d6a100', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f'] as const;

export interface Participant {
  /** The editor tab (one person can have several). */
  readonly id: string;
  /** Same for every tab of one account; not the account id. */
  readonly key: string;
  readonly name: string;
  readonly image: string | null;
  readonly color: string;
  readonly role: 'owner' | 'viewer';
}

export type PresenceMessage =
  | { readonly t: 'c'; readonly p: string; readonly x: number; readonly y: number }
  | { readonly t: 'c' }
  | { readonly t: 'm'; readonly m: string; readonly d: boolean };

export type RoomMessage =
  | { readonly t: 'hello'; readonly me: Participant; readonly peers: readonly Participant[] }
  | { readonly t: 'join'; readonly peer: Participant }
  | { readonly t: 'leave'; readonly id: string }
  | { readonly t: 'c'; readonly id: string; readonly p?: string; readonly x?: number; readonly y?: number }
  | { readonly t: 'm'; readonly id: string; readonly m: string; readonly d: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
/** Control and bidirectional-override characters never reach other people's screens. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** Chat text as shown: safe characters only, at most MAX_CHAT_LENGTH characters. */
export function cleanChat(text: string): string {
  return Array.from(text.replace(UNSAFE_TEXT, ' ')).slice(0, MAX_CHAT_LENGTH).join('');
}

/**
 * A presence message from an editor, or null when it is not one (too large, malformed, unknown
 * fields' types). Returns a fresh object holding only the validated fields, ready to relay.
 */
export function parsePresenceMessage(data: unknown): PresenceMessage | null {
  if (typeof data !== 'string' || data.length > MAX_PRESENCE_MESSAGE) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.t === 'c') {
    if (value.p === undefined && value.x === undefined && value.y === undefined) return { t: 'c' };
    if (typeof value.p !== 'string' || !PAGE_FILE.test(value.p) || !coordinate(value.x) || !coordinate(value.y)) return null;
    // A tenth of a pixel is plenty, and keeps relayed messages short.
    return { t: 'c', p: value.p, x: Math.round(value.x * 10) / 10, y: Math.round(value.y * 10) / 10 };
  }
  if (value.t === 'm') {
    if (typeof value.m !== 'string' || Array.from(value.m).length > MAX_CHAT_LENGTH) return null;
    if (value.d !== undefined && typeof value.d !== 'boolean') return null;
    return { t: 'm', m: cleanChat(value.m), d: value.d === true };
  }
  return null;
}

/** A participant as received from the room (the editor checks what it renders). */
export function parseParticipant(value: unknown): Participant | null {
  if (!isRecord(value)) return null;
  const { id, key, name, image, color, role } = value;
  if (typeof id !== 'string' || !PEER_ID.test(id) || typeof key !== 'string' || key.length > 32) return null;
  if (typeof name !== 'string' || name.length > 64 || (image !== null && typeof image !== 'string')) return null;
  if (typeof color !== 'string' || !(PEER_COLORS as readonly string[]).includes(color) || (role !== 'owner' && role !== 'viewer')) return null;
  return { id, key, name, image: safeImage(image), color, role };
}

/** Profile photos are served by Plastic (/api/avatars/…) or come from a sign-in provider over https. */
export function safeImage(image: unknown): string | null {
  if (typeof image !== 'string' || image.length > 512) return null;
  if (/^\/api\/avatars\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(image)) return image;
  try {
    return new URL(image).protocol === 'https:' ? image : null;
  } catch {
    return null;
  }
}

/** A stable small hash (FNV-1a), for colors and per-account keys. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Who someone is in a room, from their (server-side) account. */
export function participantFor(id: string, user: { id: string; name?: string | null; image?: string | null }, role: Participant['role']): Participant {
  const hash = hashString(user.id);
  const name = cleanChat(user.name?.trim() ?? '').trim().slice(0, 48) || 'Someone';
  return { id, key: hash.toString(36), name, image: safeImage(user.image), color: PEER_COLORS[hash % PEER_COLORS.length]!, role };
}

/**
 * Per-connection budget for presence messages: bursts of up to `burst`, refilled at `rate` per
 * second. Messages beyond it are dropped, so a misbehaving tab can't flood a room.
 */
export class RateLimit {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate = 20,
    private readonly burst = 40,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.last = now;
  }

  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
