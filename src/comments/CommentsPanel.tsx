/**
 * The comments list (right panel while the Comment tool is on, as in Figma): every thread in the
 * file, newest activity first. Clicking one goes to its page and opens it beside its pin.
 */
import { PanelSkeleton } from '../app/Skeleton.tsx';
import { Check, ListFilter } from 'lucide-react';
import { useState } from 'react';
import { useEditor } from '../editor/store.ts';
import { Avatar } from '../home/Avatar.tsx';
import { Menu, MenuContent } from '../panels/ui/Menu.tsx';
import { openThread, setCommentsVisible, setShowResolved, timeAgo, useComments, type CommentThread } from './store.ts';

const lastActivity = (t: CommentThread) => t.comments.at(-1)?.createdAt ?? 0;

export function CommentsPanel() {
  const endpoint = useComments((s) => s.endpoint);
  const loaded = useComments((s) => s.loaded);
  const threads = useComments((s) => s.threads);
  const showResolved = useComments((s) => s.showResolved);
  const openId = useComments((s) => s.openId);
  const pages = useEditor((s) => s.doc.pages);
  const activePage = useEditor((s) => s.activePage);

  if (!endpoint) {
    return <p className="comments-empty">Comments are available for files saved to your account.</p>;
  }
  const list = threads.filter((t) => showResolved || !t.resolvedAt).slice().sort((a, b) => lastActivity(b) - lastActivity(a));
  const resolvedCount = threads.filter((t) => t.resolvedAt).length;
  const pageName = (file: string) => pages.find((p) => p.file === file)?.name ?? file;

  const go = (thread: CommentThread) => {
    if (thread.page !== activePage) {
      useEditor.getState().setActivePage(thread.page);
      // The page's artboards mount first, then the pin can be measured.
      setTimeout(() => openThread(thread.id, true), 120);
    } else openThread(thread.id, true);
  };

  return (
    <section className="comments-panel" aria-label="Comments">
      <header className="comments-panel-head">
        <span className="insp-title">Comments</span>
        <CommentsFilter resolvedCount={resolvedCount} />
      </header>
      {!loaded ? (
        <PanelSkeleton label="Loading Comments" />
      ) : !list.length ? (
        <p className="comments-empty">
          {threads.length ? 'All comments are resolved.' : 'No comments yet. Click anywhere on the canvas to leave one.'}
        </p>
      ) : (
        <ul className="comments-list">
          {list.map((t) => {
            const first = t.comments[0]!;
            const replies = t.comments.length - 1;
            return (
              <li key={t.id}>
                <button type="button" className={`comments-item${t.id === openId ? ' is-active' : ''}${t.resolvedAt ? ' is-resolved' : ''}`} onClick={() => go(t)}>
                  <Avatar name={first.author.name} image={first.author.image} size={24} />
                  <span className="comments-item-main">
                    <span className="comments-item-head">
                      <b>{first.author.name}</b>
                      <span>{timeAgo(first.createdAt)}</span>
                      {t.resolvedAt && <Check size={12} strokeWidth={2} aria-label="Resolved" />}
                    </span>
                    <span className="comments-item-body">{first.body}</span>
                    {(replies > 0 || t.page !== activePage) && (
                      <span className="comments-item-meta">
                        {replies > 0 && `${replies} ${replies === 1 ? 'reply' : 'replies'}`}
                        {replies > 0 && t.page !== activePage && ' · '}
                        {t.page !== activePage && pageName(t.page)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CommentsFilter({ resolvedCount }: { resolvedCount: number }) {
  const [open, setOpen] = useState(false);
  const showResolved = useComments((s) => s.showResolved);
  const visible = useComments((s) => s.visible);
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className={`icon-button${showResolved ? ' is-active' : ''}`} title="Filter comments" aria-label="Filter comments">
          <ListFilter size={14} strokeWidth={1.75} />
        </button>
      </Menu.Trigger>
      {open && (
        <MenuContent align="end" className="comment-menu" aria-label="Comment filters">
          <Menu.Item className="insp-menu-item" onSelect={() => setShowResolved(!showResolved)}>
            <span>Show resolved{resolvedCount ? ` (${resolvedCount})` : ''}</span>
            {showResolved && <Check size={13} strokeWidth={2} />}
          </Menu.Item>
          <Menu.Item className="insp-menu-item" onSelect={() => setCommentsVisible(!visible)}>
            <span>Show comments on canvas</span>
            {visible ? <Check size={13} strokeWidth={2} /> : <kbd>⇧C</kbd>}
          </Menu.Item>
        </MenuContent>
      )}
    </Menu.Root>
  );
}
