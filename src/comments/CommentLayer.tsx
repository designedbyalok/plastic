/**
 * Comments on the canvas: a pin per thread (the author's photo in a speech-bubble shape, like
 * Figma and Paper), the open thread beside its pin, and the composer for a new one. Pins follow
 * the layer they were left on; drag a pin to move it, click it to open the thread.
 */
import { ArrowUp, Check, Link2, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { screenToWorld } from '../canvas/coords.ts';
import { getViewportElement, nodeIdAt, screenRectOf, toScreen } from '../canvas/dom.ts';
import { notify } from '../canvas/gestureStore.ts';
import { animateViewport } from '../editor/commands.ts';
import { useEditor } from '../editor/store.ts';
import { Avatar } from '../home/Avatar.tsx';
import { Menu, MenuContent } from '../panels/ui/Menu.tsx';
import {
  canDelete, commentFocus, commentLink, deleteComment, deleteThread, editComment, moveThread, postReply, postThread, setResolved,
  timeAgo, useComments, type Anchor, type CommentAuthor, type CommentItem, type CommentThread,
} from './store.ts';

const PIN = 32;
const CARD_WIDTH = 288;

/** Where an anchor is on screen (canvas pixels), following its layer when it's still there. */
function anchorPoint(anchor: Anchor): { x: number; y: number } {
  const { viewport } = useEditor.getState();
  const rect = anchor.nodeId ? screenRectOf(anchor.nodeId) : null;
  if (rect) return { x: rect.x + anchor.x * viewport.zoom, y: rect.y + anchor.y * viewport.zoom };
  return { x: viewport.x + anchor.worldX * viewport.zoom, y: viewport.y + anchor.worldY * viewport.zoom };
}

/** The anchor for a client point: the deepest layer under it, and the canvas position. */
export function anchorAt(clientX: number, clientY: number): Anchor {
  const { viewport } = useEditor.getState();
  const screen = toScreen(clientX, clientY);
  const world = screenToWorld(screen, viewport);
  const nodeId = nodeIdAt(clientX, clientY);
  const rect = nodeId ? screenRectOf(nodeId) : null;
  const round = (n: number) => Math.round(n * 100) / 100;
  if (!nodeId || !rect) return { nodeId: null, x: 0, y: 0, worldX: round(world.x), worldY: round(world.y) };
  return { nodeId, x: round((screen.x - rect.x) / viewport.zoom), y: round((screen.y - rect.y) / viewport.zoom), worldX: round(world.x), worldY: round(world.y) };
}

/** Center a pin in view when it's off screen (opening from the list or a link). */
commentFocus.reveal = (thread) => {
  const canvas = getViewportElement();
  if (!canvas) return;
  const p = anchorPoint(thread);
  const margin = 80;
  if (p.x > margin && p.x < canvas.clientWidth - CARD_WIDTH - margin && p.y > margin && p.y < canvas.clientHeight - margin) return;
  const v = useEditor.getState().viewport;
  animateViewport({ ...v, x: v.x + canvas.clientWidth / 2 - CARD_WIDTH / 2 - p.x, y: v.y + canvas.clientHeight / 2 - p.y });
};

interface Placed { readonly id: string; readonly x: number; readonly y: number }

export function CommentLayer() {
  const threads = useComments((s) => s.threads);
  const visible = useComments((s) => s.visible);
  const showResolved = useComments((s) => s.showResolved);
  const openId = useComments((s) => s.openId);
  const draft = useComments((s) => s.draft);
  const page = useEditor((s) => s.activePage);
  const commenting = useEditor((s) => s.tool.kind === 'comment');
  const shown = visible || commenting ? threads.filter((t) => t.page === page && (showResolved || !t.resolvedAt || t.id === openId)) : [];
  const [placed, setPlaced] = useState<readonly Placed[]>([]);
  const [draftAt, setDraftAt] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Leaving the comment tool drops an unsent new comment.
  useEffect(() => {
    if (!commenting && useComments.getState().draft) useComments.getState().set({ draft: null });
  }, [commenting]);

  // Pins are measured from the live layout every frame (like the selection overlay).
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const canvas = getViewportElement();
      const next = shownRef.current.map((t) => ({ id: t.id, ...anchorPoint(t) }));
      const d = useComments.getState().draft;
      const dp = d ? anchorPoint(d) : null;
      const box = { width: canvas?.clientWidth ?? 0, height: canvas?.clientHeight ?? 0 };
      const key = JSON.stringify([next, dp, box]);
      if (key !== last) {
        last = key;
        setPlaced(next);
        setDraftAt(dp);
        setSize(box);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const byId = new Map(shown.map((t) => [t.id, t]));
  const open = openId ? byId.get(openId) : undefined;
  const openAt = open ? placed.find((p) => p.id === open.id) : undefined;

  return (
    // React events from inside (including menus portaled out of it) stop here, so they never
    // reach the canvas's own pointer handlers.
    <div className="comment-layer" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      {placed.map((p) => {
        const thread = byId.get(p.id);
        return thread ? <Pin key={p.id} thread={thread} x={p.x} y={p.y} open={p.id === openId} /> : null;
      })}
      {open && openAt && (
        <Card x={openAt.x} y={openAt.y} size={size}>
          <ThreadView thread={open} />
        </Card>
      )}
      {draft && draftAt && (
        <>
          <span className="comment-pin is-draft" style={{ left: draftAt.x, top: draftAt.y }}>
            <PinFace author={useComments.getState().me} />
          </span>
          <Card x={draftAt.x} y={draftAt.y} size={size}>
            <Composer
              autoFocus
              placeholder="Add a comment"
              onCancel={() => useComments.getState().set({ draft: null })}
              onSubmit={(body) => postThread(draft, body)}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function PinFace({ author, count = 1 }: { author: CommentAuthor | null; count?: number }) {
  return (
    <span className="comment-pin-face">
      <Avatar name={author?.name ?? ''} image={author?.image ?? null} size={24} />
      {count > 1 && <span className="comment-pin-count">{count}</span>}
    </span>
  );
}

function Pin({ thread, x, y, open }: { thread: CommentThread; x: number; y: number; open: boolean }) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const first = thread.comments[0]!;
  const movable = canDelete(first.author.id);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!movable) return;
      moved = true;
      setDrag({ dx, dy });
    };
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setDrag(null);
      if (moved) {
        // The pin's point (its bottom-left tip) moved by the same amount as the pointer.
        const canvas = getViewportElement()!.getBoundingClientRect();
        moveThread(thread.id, anchorAt(canvas.left + x + ev.clientX - start.x, canvas.top + y + ev.clientY - start.y));
        return;
      }
      const comments = useComments.getState();
      comments.set({ openId: open ? null : thread.id, draft: null });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const people = new Set(thread.comments.map((c) => c.author.id)).size;
  return (
    <button
      type="button"
      className={`comment-pin${open ? ' is-open' : ''}${thread.resolvedAt ? ' is-resolved' : ''}${drag ? ' is-dragging' : ''}`}
      style={{ left: x + (drag?.dx ?? 0), top: y + (drag?.dy ?? 0) }}
      aria-label={`Comment by ${first.author.name}: ${first.body.slice(0, 80)}`}
      aria-expanded={open}
      onPointerDown={onPointerDown}
    >
      <PinFace author={first.author} count={people} />
      {!open && !drag && (
        <span className="comment-peek" aria-hidden="true">
          <span className="comment-peek-head">
            <b>{first.author.name}</b>
            <span>{timeAgo(first.createdAt)}</span>
          </span>
          <span className="comment-peek-body">{first.body}</span>
          {thread.comments.length > 1 && <span className="comment-peek-meta">{thread.comments.length - 1} {thread.comments.length === 2 ? 'reply' : 'replies'}</span>}
        </span>
      )}
    </button>
  );
}

/** A card beside a pin, kept inside the canvas. */
function Card({ x, y, size, children }: { x: number; y: number; size: { width: number; height: number }; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    setHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);
  const gap = 12;
  const right = x + PIN + gap;
  const left = right + CARD_WIDTH > size.width - 8 ? Math.max(8, x - CARD_WIDTH - gap) : right;
  const top = Math.max(8, Math.min(y - PIN, size.height - height - 8));
  return (
    <div ref={ref} className="comment-card" style={{ left, top, width: CARD_WIDTH }} role="dialog" aria-label="Comment">
      {children}
    </div>
  );
}

function ThreadView({ thread }: { thread: CommentThread }) {
  const listRef = useRef<HTMLDivElement>(null);
  const count = thread.comments.length;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [count]);
  const close = () => useComments.getState().set({ openId: null });
  const resolved = !!thread.resolvedAt;
  return (
    <>
      <header className="comment-card-head">
        <span className="comment-card-title">{resolved ? 'Resolved' : 'Comment'}</span>
        <button type="button" className={`icon-button comment-resolve${resolved ? ' is-on' : ''}`} title={resolved ? 'Reopen' : 'Resolve'} aria-label={resolved ? 'Reopen' : 'Resolve'} onClick={() => setResolved(thread.id, !resolved)}>
          <Check size={14} strokeWidth={2} />
        </button>
        <ThreadMenu thread={thread} />
        <button type="button" className="icon-button" title="Close" aria-label="Close" onClick={close}>
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>
      <div className="comment-list" ref={listRef}>
        {thread.comments.map((c) => (
          <CommentRow key={c.id} threadId={thread.id} comment={c} />
        ))}
      </div>
      <Composer key={thread.id} autoFocus placeholder="Reply" onCancel={close} onSubmit={(body) => postReply(thread.id, body)} />
    </>
  );
}

function ThreadMenu({ thread }: { thread: CommentThread }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className="icon-button" title="More" aria-label="More actions">
          <MoreHorizontal size={14} strokeWidth={1.75} />
        </button>
      </Menu.Trigger>
      {open && (
        <MenuContent align="end" className="comment-menu" aria-label="Comment actions">
          <Menu.Item
            className="insp-menu-item"
            onSelect={() => {
              void navigator.clipboard.writeText(commentLink(thread.id)).then(() => notify('Comment link copied'), () => notify('Couldn’t reach the clipboard.'));
            }}
          >
            <span>Copy link</span>
            <Link2 size={12} strokeWidth={1.75} />
          </Menu.Item>
          <Menu.Item className="insp-menu-item" onSelect={() => setResolved(thread.id, !thread.resolvedAt)}>
            <span>{thread.resolvedAt ? 'Mark as unresolved' : 'Mark as resolved'}</span>
          </Menu.Item>
          {canDelete(thread.comments[0]!.author.id) && (
            <>
              <Menu.Separator className="insp-menu-divider" />
              <Menu.Item className="insp-menu-item is-danger" onSelect={() => deleteThread(thread.id)}>
                <span>Delete thread</span>
              </Menu.Item>
            </>
          )}
        </MenuContent>
      )}
    </Menu.Root>
  );
}

function CommentRow({ threadId, comment }: { threadId: string; comment: CommentItem }) {
  const me = useComments((s) => s.me);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const mine = me?.id === comment.author.id;
  const removable = canDelete(comment.author.id);
  return (
    <article className="comment-row">
      <Avatar name={comment.author.name} image={comment.author.image} size={24} />
      <div className="comment-row-main">
        <div className="comment-row-head">
          <b>{comment.author.name}</b>
          <time dateTime={new Date(comment.createdAt).toISOString()} title={new Date(comment.createdAt).toLocaleString()}>
            {timeAgo(comment.createdAt)}
          </time>
          {(mine || removable) && !editing && (
            <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
              <Menu.Trigger asChild>
                <button type="button" className="icon-button comment-row-more" aria-label="Comment actions">
                  <MoreHorizontal size={13} strokeWidth={1.75} />
                </button>
              </Menu.Trigger>
              {open && (
                <MenuContent align="end" className="comment-menu" aria-label="Comment actions">
                  {mine && (
                    <Menu.Item className="insp-menu-item" onSelect={() => setEditing(true)}>
                      <span>Edit</span>
                    </Menu.Item>
                  )}
                  {removable && (
                    <Menu.Item className="insp-menu-item is-danger" onSelect={() => deleteComment(threadId, comment.id)}>
                      <span>{comment.id === threadId ? 'Delete thread' : 'Delete'}</span>
                    </Menu.Item>
                  )}
                </MenuContent>
              )}
            </Menu.Root>
          )}
        </div>
        {editing ? (
          <Composer
            autoFocus
            initial={comment.body}
            placeholder="Edit comment"
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              if (body !== comment.body) editComment(threadId, comment.id, body);
              setEditing(false);
            }}
          />
        ) : (
          <p className="comment-body">
            {comment.body}
            {comment.editedAt && <span className="comment-edited"> (edited)</span>}
          </p>
        )}
      </div>
    </article>
  );
}

function Composer({
  placeholder, onSubmit, onCancel, autoFocus, initial = '', submitLabel,
}: {
  placeholder: string;
  onSubmit(body: string): Promise<void>;
  onCancel(): void;
  autoFocus?: boolean;
  initial?: string;
  submitLabel?: string;
}) {
  const [text, setText] = useState(initial);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const me = useComments((s) => s.me);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSubmit(body);
      setText('');
    } catch {
      // the store already said what went wrong; keep the text
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className={`comment-composer${submitLabel ? ' is-inline' : ''}`}>
      {!submitLabel && <Avatar name={me?.name ?? ''} image={me?.image ?? null} size={24} />}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        maxLength={4000}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {submitLabel ? (
        <span className="comment-inline-actions">
          <button type="button" className="comment-text-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="comment-text-button is-primary" disabled={!text.trim() || sending} onClick={() => void submit()}>{submitLabel}</button>
        </span>
      ) : (
        <button type="button" className="comment-send" aria-label="Send" title="Send  ↵" disabled={!text.trim() || sending} onClick={() => void submit()}>
          <ArrowUp size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
