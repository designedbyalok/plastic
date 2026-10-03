/**
 * Comments on the open file (cloud files only): threads pinned to layers, fetched from
 * /api/projects/<id>/comments and refreshed when another tab changes them (the live room says so).
 * Writes update the list right away, then the server's answer replaces it.
 */
import { create } from 'zustand';
import { notify } from '../canvas/gestureStore.ts';
import { connectWorkspace } from '../serialization/storage.ts';
import { useEditor } from '../editor/store.ts';

export interface CommentAuthor { readonly id: string; readonly name: string; readonly image: string | null }
export interface CommentItem { readonly id: string; readonly author: CommentAuthor; readonly body: string; readonly createdAt: number; readonly editedAt: number | null }
export interface Anchor { readonly nodeId: string | null; readonly x: number; readonly y: number; readonly worldX: number; readonly worldY: number }
export interface CommentThread extends Anchor {
  readonly id: string;
  readonly page: string;
  readonly resolvedAt: number | null;
  readonly comments: readonly CommentItem[];
}
/** A pin being placed: where, and on which page. */
export interface CommentDraft extends Anchor { readonly page: string }

interface CommentsState {
  /** The comments endpoint of the open file, or null where comments aren't available. */
  readonly endpoint: string | null;
  readonly loaded: boolean;
  readonly me: CommentAuthor | null;
  /** The file's owner (can delete anyone's comments). */
  readonly owner: string | null;
  readonly threads: readonly CommentThread[];
  readonly openId: string | null;
  readonly draft: CommentDraft | null;
  /** Pins on the canvas (⇧C). */
  readonly visible: boolean;
  readonly showResolved: boolean;
  set(patch: Partial<Omit<CommentsState, 'set'>>): void;
}

const readPref = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writePref = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
};

export const useComments = create<CommentsState>((set) => ({
  endpoint: null,
  loaded: false,
  me: null,
  owner: null,
  threads: [],
  openId: null,
  draft: null,
  visible: readPref('plastic:comments-visible') !== '0',
  showResolved: readPref('plastic:comments-resolved') === '1',
  set: (patch) => set(patch),
}));

const state = () => useComments.getState();

async function request<T = unknown>(path: string, init?: RequestInit & { body?: string }): Promise<T> {
  const endpoint = state().endpoint;
  if (!endpoint) throw new Error('Comments aren’t available for this file.');
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? 'Couldn’t reach comments. Try again.');
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

let loading: Promise<void> | null = null;
let again = false;

/** Fetch the threads (coalesced: one request at a time, one more if asked meanwhile). */
export function reloadComments(): Promise<void> {
  if (loading) {
    again = true;
    return loading;
  }
  loading = (async () => {
    try {
      const data = await request<{ me: CommentAuthor; owner: string; threads: CommentThread[] }>('');
      state().set({ me: data.me, owner: data.owner, threads: data.threads, loaded: true });
      const open = state().openId;
      if (open && !data.threads.some((t) => t.id === open)) state().set({ openId: null });
    } catch (error) {
      console.error(error);
    } finally {
      loading = null;
      if (again) {
        again = false;
        void reloadComments();
      }
    }
  })();
  return loading;
}

/** Start comments for an opened file (cloud only). Returns a cleanup. */
export function startComments(projectId: string): () => void {
  let stopped = false;
  state().set({ endpoint: null, loaded: false, threads: [], openId: null, draft: null });
  const onSignal = () => void reloadComments();
  void connectWorkspace().then((workspace) => {
    if (stopped || workspace.kind !== 'cloud') return;
    // Someone else's file, opened through its shared link: comment through the link.
    const preview = new URL(location.href).searchParams.get('preview');
    const endpoint = useEditor.getState().readOnly && preview
      ? `/api/shared/${encodeURIComponent(preview)}/comments`
      : `/api/projects/${encodeURIComponent(projectId)}/comments`;
    state().set({ endpoint });
    void reloadComments().then(() => !stopped && focusLinkedComment());
    window.addEventListener('plastic:comments', onSignal);
  });
  return () => {
    stopped = true;
    window.removeEventListener('plastic:comments', onSignal);
    state().set({ endpoint: null, loaded: false, threads: [], openId: null, draft: null });
  };
}

function failed(error: unknown): void {
  notify(error instanceof Error ? error.message : 'Couldn’t save the comment.');
  void reloadComments();
}

function updateThread(id: string, change: (thread: CommentThread) => CommentThread | null): void {
  state().set({ threads: state().threads.flatMap((t) => (t.id === id ? (change(t) ?? []) : [t])) });
}

export async function postThread(draft: CommentDraft, body: string): Promise<void> {
  const me = state().me;
  try {
    const { id, createdAt } = await request<{ id: string; createdAt: number }>('', { method: 'POST', body: JSON.stringify({ ...draft, body }) });
    if (me) {
      state().set({
        threads: [...state().threads, { ...draft, id, resolvedAt: null, comments: [{ id, author: me, body, createdAt, editedAt: null }] }],
      });
    }
    state().set({ draft: null, openId: id });
    void reloadComments();
  } catch (error) {
    failed(error);
    throw error;
  }
}

export async function postReply(threadId: string, body: string): Promise<void> {
  const me = state().me;
  try {
    const { id, createdAt } = await request<{ id: string; createdAt: number }>(`/${threadId}`, { method: 'POST', body: JSON.stringify({ body }) });
    if (me) updateThread(threadId, (t) => ({ ...t, resolvedAt: null, comments: [...t.comments, { id, author: me, body, createdAt, editedAt: null }] }));
    void reloadComments();
  } catch (error) {
    failed(error);
    throw error;
  }
}

export function setResolved(threadId: string, resolved: boolean): void {
  updateThread(threadId, (t) => ({ ...t, resolvedAt: resolved ? Date.now() : null }));
  if (resolved && !state().showResolved && state().openId === threadId) state().set({ openId: null });
  notify(resolved ? 'Resolved' : 'Reopened');
  request(`/${threadId}`, { method: 'PATCH', body: JSON.stringify({ resolved }) }).catch(failed);
}

export function moveThread(threadId: string, anchor: Anchor): void {
  updateThread(threadId, (t) => ({ ...t, ...anchor }));
  request(`/${threadId}`, { method: 'PATCH', body: JSON.stringify(anchor) }).catch(failed);
}

export function editComment(threadId: string, commentId: string, body: string): void {
  updateThread(threadId, (t) => ({ ...t, comments: t.comments.map((c) => (c.id === commentId ? { ...c, body, editedAt: Date.now() } : c)) }));
  request(`/${threadId}/${commentId}`, { method: 'PATCH', body: JSON.stringify({ body }) }).catch(failed);
}

export function deleteComment(threadId: string, commentId: string): void {
  if (commentId === threadId) return deleteThread(threadId);
  updateThread(threadId, (t) => ({ ...t, comments: t.comments.filter((c) => c.id !== commentId) }));
  request(`/${threadId}/${commentId}`, { method: 'DELETE' }).catch(failed);
}

export function deleteThread(threadId: string): void {
  updateThread(threadId, () => null);
  if (state().openId === threadId) state().set({ openId: null });
  notify('Comment deleted');
  request(`/${threadId}`, { method: 'DELETE' }).catch(failed);
}

export function canDelete(author: string): boolean {
  const { me, owner } = state();
  return !!me && (me.id === author || me.id === owner);
}

export function setCommentsVisible(visible: boolean): void {
  state().set({ visible, ...(visible ? {} : { openId: null, draft: null }) });
  writePref('plastic:comments-visible', visible ? '1' : '0');
}

export function setShowResolved(showResolved: boolean): void {
  state().set({ showResolved });
  writePref('plastic:comments-resolved', showResolved ? '1' : '0');
}

/** Link to a comment: the file link with ?comment=<thread>. */
export function commentLink(threadId: string): string {
  const url = new URL(location.href);
  const preview = url.searchParams.get('preview');
  url.search = '';
  if (preview) url.searchParams.set('preview', preview);
  url.hash = '';
  url.searchParams.set('comment', threadId);
  return url.href;
}

/** Hook for the canvas: opening a thread from a link brings it into view (set by CommentLayer). */
export const commentFocus: { reveal: ((thread: CommentThread) => void) | null } = { reveal: null };

export function openThread(threadId: string, reveal = false): void {
  const thread = state().threads.find((t) => t.id === threadId);
  if (!thread) return;
  if (!state().visible) setCommentsVisible(true);
  if (thread.resolvedAt && !state().showResolved) setShowResolved(true);
  state().set({ openId: threadId, draft: null });
  if (reveal) commentFocus.reveal?.(thread);
}

function focusLinkedComment(): void {
  const id = new URL(location.href).searchParams.get('comment');
  if (!id) return;
  if (!state().threads.some((t) => t.id === id)) return notify('That comment was deleted.');
  // Wait for the artboards to lay out so the pin can be measured.
  setTimeout(() => openThread(id, true), 300);
}

/** "2m", "3h", "5d", or a date: compact, like Figma's comment times. */
export function timeAgo(time: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(time).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}
