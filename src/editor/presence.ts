/**
 * Who else is in the open file, where their cursors are, and cursor chat (Figma's "/"). Editor
 * state only: never part of the design or its history. Messages go over the file's live room
 * (see presenceProtocol.ts); cursors are sent at most every CURSOR_INTERVAL_MS, only while the
 * pointer moves and only when someone else is here to see them.
 */
import { create } from 'zustand';
import type { Point } from '../document/types.ts';
import type { PresenceLink } from '../serialization/storage.ts';
import {
  CHAT_DEBOUNCE_MS, CHAT_FADE_MS, CURSOR_INTERVAL_MS, cleanChat, parseParticipant,
  type Participant, type PresenceMessage,
} from './presenceProtocol.ts';

export interface PeerCursor {
  readonly page: string;
  readonly x: number;
  readonly y: number;
}

export interface PeerChat {
  readonly text: string;
  /** Finished (Enter or Escape): it fades out. */
  readonly done: boolean;
}

export interface Peer extends Participant {
  readonly cursor: PeerCursor | null;
  readonly chat: PeerChat | null;
}

/** This person's own chat bubble. */
export interface OwnChat {
  readonly text: string;
  readonly done: boolean;
}

interface PresenceState {
  /** This tab in the room, as others see it (null until connected). */
  readonly me: Participant | null;
  readonly peers: Readonly<Record<string, Peer>>;
  readonly chat: OwnChat | null;
  /** Where this person's pointer is on the canvas (world space), for their own bubble. */
  readonly pointer: (Point & { page: string }) | null;
}

export const usePresence = create<PresenceState>()(() => ({ me: null, peers: {}, chat: null, pointer: null }));

let link: PresenceLink | null = null;
const fades = new Map<string, ReturnType<typeof setTimeout>>();

function updatePeer(id: string, change: (peer: Peer) => Peer): void {
  const peer = usePresence.getState().peers[id];
  if (peer) usePresence.setState((s) => ({ peers: { ...s.peers, [id]: change(peer) } }));
}

function clearFade(id: string): void {
  clearTimeout(fades.get(id));
  fades.delete(id);
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Apply one message from the room. Exported for tests. */
export function receivePresence(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const message = raw as Record<string, unknown>;
  switch (message.t) {
    case 'hello': {
      const me = parseParticipant(message.me);
      if (!me || !Array.isArray(message.peers)) return;
      const peers: Record<string, Peer> = {};
      for (const value of message.peers) {
        const participant = parseParticipant(value);
        if (participant && participant.id !== me.id) peers[participant.id] = { ...participant, cursor: null, chat: null };
      }
      fades.forEach((timer) => clearTimeout(timer));
      fades.clear();
      usePresence.setState({ me, peers });
      return;
    }
    case 'join': {
      const participant = parseParticipant(message.peer);
      if (!participant || participant.id === usePresence.getState().me?.id) return;
      usePresence.setState((s) => ({ peers: { ...s.peers, [participant.id]: { ...participant, cursor: s.peers[participant.id]?.cursor ?? null, chat: null } } }));
      return;
    }
    case 'leave': {
      if (typeof message.id !== 'string') return;
      const id = message.id;
      clearFade(id);
      usePresence.setState((s) => {
        const { [id]: _, ...peers } = s.peers;
        return { peers };
      });
      return;
    }
    case 'c': {
      if (typeof message.id !== 'string') return;
      const cursor = typeof message.p === 'string' && isNumber(message.x) && isNumber(message.y) ? { page: message.p, x: message.x, y: message.y } : null;
      updatePeer(message.id, (peer) => ({ ...peer, cursor }));
      return;
    }
    case 'm': {
      if (typeof message.id !== 'string' || typeof message.m !== 'string') return;
      const id = message.id;
      const text = cleanChat(message.m);
      const done = message.d === true;
      clearFade(id);
      updatePeer(id, (peer) => ({ ...peer, chat: text ? { text, done } : null }));
      if (done && text) fades.set(id, setTimeout(() => { fades.delete(id); updatePeer(id, (peer) => ({ ...peer, chat: null })); }, CHAT_FADE_MS));
      return;
    }
    case 'closed':
      // Reconnecting brings a fresh "hello"; until then nobody is shown.
      fades.forEach((timer) => clearTimeout(timer));
      fades.clear();
      usePresence.setState({ me: null, peers: {} });
      return;
  }
}

/** Join the file's room for presence; returns a function that leaves it. */
export function connectPresence(next: PresenceLink): () => void {
  link = next;
  const unsubscribe = next.subscribe(receivePresence);
  return () => {
    unsubscribe();
    if (link === next) link = null;
    resetPresence();
  };
}

export function resetPresence(): void {
  clearTimeout(cursorTimer);
  clearTimeout(chatTimer);
  clearTimeout(ownFade);
  cursorTimer = chatTimer = ownFade = undefined;
  pendingCursor = undefined;
  lastCursor = '';
  fades.forEach((timer) => clearTimeout(timer));
  fades.clear();
  usePresence.setState({ me: null, peers: {}, chat: null, pointer: null });
}

function send(message: PresenceMessage): void {
  // Nobody else here: nothing to send (and nothing to pay for).
  if (!link || !Object.keys(usePresence.getState().peers).length) return;
  link.send(message);
}

// --- cursor -----------------------------------------------------------------------------------

let cursorTimer: ReturnType<typeof setTimeout> | undefined;
let lastSent = 0;
let lastCursor = '';
/** The latest position not yet sent (null: the pointer left). */
let pendingCursor: PresenceMessage | undefined;

function flushCursor(): void {
  cursorTimer = undefined;
  if (!pendingCursor) return;
  const message = pendingCursor;
  pendingCursor = undefined;
  const key = JSON.stringify(message);
  if (key === lastCursor) return;
  lastCursor = key;
  lastSent = Date.now();
  send(message);
}

/** The pointer moved on the canvas (world point and page), or left it (null). Throttled. */
export function moveCursor(at: (Point & { page: string }) | null): void {
  usePresence.setState({ pointer: at });
  pendingCursor = at ? { t: 'c', p: at.page, x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 } : { t: 'c' };
  if (cursorTimer) return;
  const wait = Math.max(0, lastSent + CURSOR_INTERVAL_MS - Date.now());
  if (wait === 0) flushCursor();
  else cursorTimer = setTimeout(flushCursor, wait);
}

// --- cursor chat ------------------------------------------------------------------------------

let chatTimer: ReturnType<typeof setTimeout> | undefined;
let chatFirstPending = 0;
let ownFade: ReturnType<typeof setTimeout> | undefined;

/** Open the chat bubble at the pointer ("/"), or at `at` (the canvas menu). */
export function openCursorChat(at?: Point & { page: string }): void {
  clearTimeout(ownFade);
  ownFade = undefined;
  usePresence.setState((s) => ({ chat: { text: '', done: false }, pointer: at ?? s.pointer }));
}

function sendChat(done: boolean): void {
  clearTimeout(chatTimer);
  chatTimer = undefined;
  chatFirstPending = 0;
  const chat = usePresence.getState().chat;
  send({ t: 'm', m: chat?.text ?? '', d: done });
}

/** Typing: shown at once here, sent to others after a short pause (debounced, with a cap). */
export function setCursorChat(text: string): void {
  const chat = usePresence.getState().chat;
  if (!chat || chat.done) return;
  usePresence.setState({ chat: { text: cleanChat(text), done: false } });
  clearTimeout(chatTimer);
  const now = Date.now();
  if (!chatFirstPending) chatFirstPending = now;
  // Long bursts of typing still stream: at most four debounce periods between sends.
  const wait = Math.max(0, Math.min(CHAT_DEBOUNCE_MS, chatFirstPending + CHAT_DEBOUNCE_MS * 4 - now));
  chatTimer = setTimeout(() => sendChat(false), wait);
}

/** Enter or Escape: the bubble stays a few seconds, then fades. An empty bubble just closes. */
export function closeCursorChat(): void {
  const chat = usePresence.getState().chat;
  if (!chat || chat.done) return;
  sendChat(true);
  if (!chat.text.trim()) {
    usePresence.setState({ chat: null });
    return;
  }
  usePresence.setState({ chat: { ...chat, done: true } });
  clearTimeout(ownFade);
  ownFade = setTimeout(() => {
    ownFade = undefined;
    if (usePresence.getState().chat?.done) usePresence.setState({ chat: null });
  }, CHAT_FADE_MS);
}
