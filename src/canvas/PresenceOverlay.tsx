/**
 * Other people's cursors on the canvas, with their name or what they're typing in cursor chat,
 * and this person's own chat bubble ("/"). Screen space, like the selection overlay: cursors
 * are stored in world coordinates and placed with this viewer's own pan and zoom.
 */
import type { CSSProperties } from 'react';
import { MAX_CHAT_LENGTH } from '../editor/presenceProtocol.ts';
import { closeCursorChat, setCursorChat, usePresence, type Peer } from '../editor/presence.ts';
import { useEditor } from '../editor/store.ts';
import { worldToScreen } from './coords.ts';
import { getViewportElement } from './dom.ts';

/** The tip of the arrow is at the pointer. */
function Arrow({ color }: { color: string }) {
  return (
    <svg className="presence-arrow" width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
      <path d="M1.5 1.5v13.2l3.6-3.4 2.6 5.6 2.4-1.1-2.6-5.5h5z" fill={color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** Near the canvas's right edge, labels and bubbles open to the left of the pointer. */
const flipped = (x: number) => x > (getViewportElement()?.clientWidth ?? Infinity) - 280;

function RemoteCursor({ peer, at }: { peer: Peer; at: { x: number; y: number } }) {
  const style = { transform: `translate(${at.x}px, ${at.y}px)`, '--peer': peer.color } as CSSProperties;
  return (
    <div className={`presence-cursor${flipped(at.x) ? ' is-flipped' : ''}`} style={style}>
      <Arrow color={peer.color} />
      {peer.chat ? (
        <div className={`presence-bubble${peer.chat.done ? ' is-fading' : ''}`} key={peer.chat.done ? 'done' : 'typing'}>
          <span className="presence-bubble-name">{peer.name}</span>
          <span className="presence-bubble-text">{peer.chat.text}</span>
        </div>
      ) : (
        <span className="presence-name">{peer.name}</span>
      )}
    </div>
  );
}

function OwnChat() {
  const chat = usePresence((s) => s.chat);
  const pointer = usePresence((s) => s.pointer);
  const color = usePresence((s) => s.me?.color) ?? 'var(--ui-accent)';
  const viewport = useEditor((s) => s.viewport);
  if (!chat) return null;
  const canvas = getViewportElement();
  const at = pointer ? worldToScreen(pointer, viewport) : { x: (canvas?.clientWidth ?? 0) / 2, y: (canvas?.clientHeight ?? 0) / 2 };
  const style = { transform: `translate(${at.x}px, ${at.y}px)`, '--peer': color } as CSSProperties;
  return (
    <div className={`presence-cursor is-own${flipped(at.x) ? ' is-flipped' : ''}`} style={style}>
      {chat.done ? (
        <div className="presence-bubble is-fading">
          <span className="presence-bubble-text">{chat.text}</span>
        </div>
      ) : (
        <div className="presence-bubble">
          <input
            className="presence-input"
            aria-label="Cursor chat"
            placeholder="Say something"
            autoFocus
            maxLength={MAX_CHAT_LENGTH}
            value={chat.text}
            size={Math.max(12, Math.min(40, chat.text.length + 1))}
            onChange={(e) => setCursorChat(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                closeCursorChat();
              }
            }}
            onBlur={closeCursorChat}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export function PresenceOverlay() {
  const peers = usePresence((s) => s.peers);
  const viewport = useEditor((s) => s.viewport);
  const page = useEditor((s) => s.activePage);
  return (
    <div className="presence-layer">
      {Object.values(peers).map((peer) =>
        peer.cursor && peer.cursor.page === page ? <RemoteCursor key={peer.id} peer={peer} at={worldToScreen(peer.cursor, viewport)} /> : null,
      )}
      <OwnChat />
    </div>
  );
}
