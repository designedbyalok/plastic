/**
 * Waitlist and invites (admins only; the server checks ADMIN_EMAILS on every request).
 * People join from the landing page and wait for a decision: Accept emails them a link that
 * signs them straight in; Reject keeps them off quietly. An accepted invite can be cancelled
 * until they sign up. Click a person to see what their account costs to run.
 *
 * Refreshing only reloads the data: the page stays put and the list shows skeleton rows.
 */
import { Ban, Check, Copy, Mail, Megaphone, RefreshCw, RotateCcw, Send, ShieldCheck, UserCheck, UserPlus, UserX, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { MemberPanel } from './MemberPanel.tsx';

type Filter = 'waiting' | 'invited' | 'joined' | 'rejected' | 'all';
type Decision = 'accept' | 'reject' | 'cancel' | 'restore';

interface Entry {
  readonly email: string;
  readonly name: string | null;
  readonly role: string | null;
  readonly teamSize: string | null;
  readonly useCase: string | null;
  readonly source: string;
  readonly createdAt: number;
  readonly invitedAt: number | null;
  readonly rejectedAt: number | null;
  readonly joined: boolean;
  /** When their suspension starts (or started), or null. */
  readonly suspendedFrom: number | null;
  readonly admin: boolean;
}

interface Page {
  readonly entries: Entry[];
  readonly next: number | null;
  readonly counts: Record<Filter | 'total', number>;
  readonly mail: boolean;
  /** The current release-notes edition and how many members haven't received it. */
  readonly releaseNotes: { readonly edition: string; readonly pending: number } | null;
}

const FILTERS: { id: Filter; label: string; count: keyof Page['counts'] }[] = [
  { id: 'waiting', label: 'Waiting', count: 'waiting' },
  { id: 'joined', label: 'Joined', count: 'joined' },
  { id: 'invited', label: 'Invited', count: 'invited' },
  { id: 'rejected', label: 'Rejected', count: 'rejected' },
  { id: 'all', label: 'All', count: 'total' },
];

const ROLE_LABELS: Record<string, string> = {
  designer: 'Designer',
  engineer: 'Engineer',
  'design-engineer': 'Design engineer',
  product: 'Product',
  founder: 'Founder',
  student: 'Student',
  other: 'Other',
};

const date = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

async function load(filter: Filter, before?: number): Promise<Page> {
  const params = new URLSearchParams({ filter });
  if (before !== undefined) params.set('before', String(before));
  const response = await fetch(`/api/admin/waitlist?${params}`);
  if (!response.ok) throw new Error(response.status === 403 ? 'Only admins can see the waitlist.' : 'Couldn’t load the waitlist.');
  return (await response.json()) as Page;
}

/** Where an invite email points: the sign-up screen with their address filled in. */
function signUpLink(email: string): string {
  const url = new URL('/', location.origin);
  url.searchParams.set('auth', 'sign-up');
  url.searchParams.set('email', email);
  return url.href;
}

interface Result {
  readonly emailed?: boolean;
  readonly already?: boolean;
  readonly removed?: boolean;
}

async function post(path: string, body: object, failure: string): Promise<Result> {
  const response = await fetch(`/api/admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Result & { error?: string };
  if (!response.ok) throw new Error(data.error ?? failure);
  return data;
}

export function AdminView() {
  const [filter, setFilter] = useState<Filter>('waiting');
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** A sign-up link to share by hand when an invite couldn't be emailed. */
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [direct, setDirect] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  /** Only the latest request may update the list (switching filters quickly can't show stale rows). */
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const next = await load(filter);
      if (id === request.current) setPage(next);
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const more = async () => {
    if (!page?.next) return;
    try {
      const next = await load(filter, page.next);
      setPage({ ...next, entries: [...page.entries, ...next.entries] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Run an action for one person, then reload the list in place. */
  const run = async (email: string, action: () => Promise<Result>, describe: (result: Result) => string) => {
    setBusy(email);
    setNotice(null);
    setManualLink(null);
    setCopied(false);
    try {
      const result = await action();
      setNotice(describe(result));
      if (!result.already && result.emailed === false && !page?.mail) setManualLink(signUpLink(email));
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const accepted = (email: string) => (result: Result) =>
    result.already
      ? `${email} was already accepted.`
      : result.emailed
        ? `Accepted ${email}. They’ve been emailed a link that signs them straight in.`
        : `Accepted ${email}. Email isn’t set up here, so send them this link:`;

  const decide = (email: string, action: Decision) =>
    run(
      email,
      () => post('decide', { email, action }, 'Couldn’t update the waitlist.'),
      action === 'accept'
        ? accepted(email)
        : action === 'reject'
          ? () => `Rejected ${email}. They weren’t emailed, and joining again won’t change it.`
          : action === 'cancel'
            ? (result) => (result.removed ? `Cancelled and removed ${email}.` : `Cancelled the invite for ${email}. They’re back in Waiting, and their link no longer works.`)
            : () => `Moved ${email} back to Waiting.`,
    );

  const send = (email: string) => run(email, () => post('invite', { email }, 'Couldn’t add them.'), accepted(email));

  /** The person whose suspension is being set up (the dialog is open). */
  const [suspending, setSuspending] = useState<string | null>(null);
  const suspend = (email: string, when: 'now' | '30d', reason: string) =>
    run(
      email,
      () => post('suspend', { email, when, reason: reason.trim() || undefined }, 'Couldn’t suspend them.'),
      () =>
        when === 'now'
          ? `Suspended ${email}. They’ve been signed out everywhere and can’t sign in.`
          : `${email} will be suspended on ${date.format(Date.now() + 30 * 86_400_000)}. Until then nothing changes for them.`,
    ).then(() => setSuspending(null));
  const unsuspend = (email: string) => run(email, () => post('unsuspend', { email }, 'Couldn’t lift the suspension.'), () => `Lifted the suspension for ${email}. They can sign in again.`);

  const sendReleaseNotes = async () => {
    setBusy('release-notes');
    setNotice(null);
    setManualLink(null);
    try {
      const response = await fetch('/api/admin/release-notes', { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as { sent?: number; remaining?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Couldn’t send the release notes.');
      setNotice(
        `Release notes sent to ${data.sent} ${data.sent === 1 ? 'member' : 'members'}.` +
          (data.remaining ? ` ${data.remaining} still to go; send again to continue (batches keep within the daily email limit).` : ''),
      );
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const submitDirect = (e: FormEvent) => {
    e.preventDefault();
    const email = direct.trim();
    if (!email) return;
    void send(email).then(() => setDirect(''));
  };

  return (
    <div className="admin">
      <header className="admin-header">
        <div>
          <h1 className="home-title">Waitlist</h1>
          <p className="admin-lede">Plastic is invite-only. Accepted people get an email with a link that signs them straight in; only accepted emails can create an account.</p>
        </div>
        <button type="button" className="profile-button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
          <RefreshCw size={13} strokeWidth={1.75} className={loading ? 'admin-spin' : undefined} />
          Refresh
        </button>
      </header>

      <form className="admin-direct" onSubmit={submitDirect}>
        <Mail size={14} strokeWidth={1.75} className="admin-direct-icon" />
        <input type="email" placeholder="Add and accept someone by email" aria-label="Email to add and accept" value={direct} onChange={(e) => setDirect(e.target.value)} required />
        <button type="submit" className="profile-button is-primary" disabled={!direct.trim() || busy !== null}>
          <UserPlus size={13} strokeWidth={1.75} />
          Accept
        </button>
      </form>

      {page?.releaseNotes && (
        <div className="admin-release">
          <Megaphone size={14} strokeWidth={1.75} />
          <span>
            Release notes ({page.releaseNotes.edition}):{' '}
            {page.releaseNotes.pending
              ? `${page.releaseNotes.pending} ${page.releaseNotes.pending === 1 ? 'member hasn’t' : 'members haven’t'} received it yet. New members get it automatically after signing up.`
              : 'every member has it. New members get it automatically after signing up.'}
          </span>
          {page.releaseNotes.pending > 0 && (
            <button type="button" className="profile-button" disabled={busy !== null} onClick={() => void sendReleaseNotes()}>
              <Send size={12} strokeWidth={1.75} />
              {busy === 'release-notes' ? 'Sending…' : 'Send release notes'}
            </button>
          )}
        </div>
      )}
      {page && !page.mail && (
        <p className="admin-note">
          This server can’t send email (no RESEND_API_KEY), so invites are saved and you share the sign-up link yourself. On useplastic.app invites are emailed automatically.
        </p>
      )}
      {notice && (
        <p className="admin-note" role="status">
          {notice}
        </p>
      )}
      {manualLink && (
        <div className="admin-link">
          <code>{manualLink}</code>
          <button
            type="button"
            className="profile-button"
            onClick={() => void navigator.clipboard.writeText(manualLink).then(() => setCopied(true))}
          >
            {copied ? <Check size={13} strokeWidth={1.75} /> : <Copy size={13} strokeWidth={1.75} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}

      <div className="admin-filters" role="tablist" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`admin-filter${filter === f.id ? ' is-active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
            {page ? <span className="admin-count">{page.counts[f.count]}</span> : <span className="admin-count chrome-skeleton shimmer" aria-hidden="true" />}
          </button>
        ))}
      </div>

      {error && (
        <p className="home-empty" role="alert">
          {error}
        </p>
      )}
      {!error && !loading && page && page.entries.length === 0 && <p className="home-empty">{EMPTY[filter]}</p>}

      {!error && (loading || (page && page.entries.length > 0)) && (
        <div className="admin-table-wrap">
          <table className="admin-table" aria-busy={loading}>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Team</th>
                <th scope="col">What they want to make</th>
                <th scope="col">Joined list</th>
                <th scope="col">
                  <span className="sr-only">Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: Math.min(Math.max(page?.entries.length ?? 5, 3), 8) }, (_, i) => <SkeletonRow key={i} />)
                : page!.entries.map((entry) => (
                    <tr key={entry.email} className={`admin-row${selected === entry.email ? ' is-selected' : ''}`} onClick={() => setSelected(entry.email)}>
                      <td>
                        <button type="button" className="admin-person-button" onClick={() => setSelected(entry.email)} aria-label={`Show details for ${entry.email}`}>
                          <div className="admin-person">{entry.name ?? entry.email}</div>
                          {entry.name && <div className="admin-sub">{entry.email}</div>}
                        </button>
                      </td>
                      <td>{entry.role ? ROLE_LABELS[entry.role] ?? entry.role : '—'}</td>
                      <td>{entry.teamSize ?? '—'}</td>
                      <td className="admin-usecase" title={entry.useCase ?? undefined}>
                        {entry.useCase ?? '—'}
                      </td>
                      <td>
                        <div>{date.format(entry.createdAt)}</div>
                        <div className="admin-sub">from {entry.source}</div>
                      </td>
                      <td className="admin-status" onClick={stop}>
                        <RowActions
                          entry={entry}
                          busy={busy}
                          onDecide={(action) => void decide(entry.email, action)}
                          onSuspend={() => setSuspending(entry.email)}
                          onUnsuspend={() => void unsuspend(entry.email)}
                        />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && page?.next && (
        <button type="button" className="profile-button admin-more" onClick={() => void more()}>
          Show more
        </button>
      )}
      {selected && <MemberPanel email={selected} onClose={() => setSelected(null)} />}
      {suspending && (
        <SuspendDialog email={suspending} busy={busy === suspending} onCancel={() => setSuspending(null)} onConfirm={(when, reason) => void suspend(suspending, when, reason)} />
      )}
    </div>
  );
}

const EMPTY: Record<Filter, string> = {
  waiting: 'Nobody is waiting right now.',
  invited: 'No open invites. Everyone you invited has signed up.',
  joined: 'Nobody has joined yet.',
  rejected: 'Nobody has been rejected.',
  all: 'Nobody here yet.',
};

/** What can be done next for a person, given where they are on the list. */
function RowActions({
  entry,
  busy,
  onDecide,
  onSuspend,
  onUnsuspend,
}: {
  entry: Entry;
  busy: string | null;
  onDecide(action: Decision): void;
  onSuspend(): void;
  onUnsuspend(): void;
}) {
  const working = busy === entry.email;
  const disabled = busy !== null;
  if (entry.joined) {
    if (entry.admin)
      return (
        <span className="admin-badge is-joined">
          <ShieldCheck size={12} strokeWidth={2} />
          Admin
        </span>
      );
    if (entry.suspendedFrom !== null) {
      const started = entry.suspendedFrom <= Date.now();
      return (
        <span className="admin-actions">
          <span className={`admin-badge${started ? ' is-suspended' : ''}`}>
            <UserX size={12} strokeWidth={2} />
            {started ? 'Suspended' : `Suspends ${date.format(entry.suspendedFrom)}`}
          </span>
          <button type="button" className="profile-button" disabled={disabled} onClick={onUnsuspend}>
            <RotateCcw size={12} strokeWidth={1.75} />
            {working ? 'Lifting…' : started ? 'Unsuspend' : 'Cancel suspension'}
          </button>
        </span>
      );
    }
    return (
      <span className="admin-actions">
        <span className="admin-badge is-joined">
          <Check size={12} strokeWidth={2} />
          Joined
        </span>
        <button type="button" className="profile-button" disabled={disabled} onClick={onSuspend}>
          <UserX size={12} strokeWidth={1.75} />
          Suspend
        </button>
      </span>
    );
  }
  if (entry.invitedAt)
    return (
      <span className="admin-actions">
        <span className="admin-sub" title={`${entry.source === 'admin' ? 'Invited' : 'Accepted'} ${date.format(entry.invitedAt)}`}>
          {entry.source === 'admin' ? `Invited ${date.format(entry.invitedAt)}` : 'Accepted, not signed in yet'}
        </span>
        <button type="button" className="profile-button" disabled={disabled} onClick={() => onDecide('cancel')}>
          <X size={12} strokeWidth={1.75} />
          {working ? 'Cancelling…' : 'Cancel invite'}
        </button>
      </span>
    );
  if (entry.rejectedAt)
    return (
      <span className="admin-actions">
        <span className="admin-sub">Rejected {date.format(entry.rejectedAt)}</span>
        <button type="button" className="profile-button" disabled={disabled} onClick={() => onDecide('restore')}>
          <RotateCcw size={12} strokeWidth={1.75} />
          {working ? 'Restoring…' : 'Restore'}
        </button>
      </span>
    );
  return (
    <span className="admin-actions">
      <button type="button" className="profile-button" disabled={disabled} onClick={() => onDecide('reject')}>
        <Ban size={12} strokeWidth={1.75} />
        Reject
      </button>
      <button type="button" className="profile-button is-primary" disabled={disabled} onClick={() => onDecide('accept')}>
        <UserCheck size={12} strokeWidth={1.75} />
        {working ? 'Accepting…' : 'Accept'}
      </button>
    </span>
  );
}

/** Suspend someone: now, or after a 30-day grace period, with an optional private reason. */
function SuspendDialog({ email, busy, onCancel, onConfirm }: { email: string; busy: boolean; onCancel(): void; onConfirm(when: 'now' | '30d', reason: string): void }) {
  const [when, setWhen] = useState<'now' | '30d'>('now');
  const [reason, setReason] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  const later = date.format(Date.now() + 30 * 86_400_000);
  return (
    <div className="member-backdrop is-centered" onClick={() => !busy && onCancel()}>
      <form
        className="suspend-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="suspend-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(when, reason);
        }}
      >
        <h2 id="suspend-title">Suspend {email}?</h2>
        <p className="suspend-lede">They won’t be able to sign in or use Plastic. Their files are kept, and you can lift the suspension at any time.</p>
        <fieldset className="suspend-options">
          <legend className="sr-only">When</legend>
          <label className={`suspend-option${when === 'now' ? ' is-selected' : ''}`}>
            <input type="radio" name="when" value="now" checked={when === 'now'} onChange={() => setWhen('now')} />
            <span>
              <strong>Immediately</strong>
              <span>Signs them out everywhere now and blocks every sign-in.</span>
            </span>
          </label>
          <label className={`suspend-option${when === '30d' ? ' is-selected' : ''}`}>
            <input type="radio" name="when" value="30d" checked={when === '30d'} onChange={() => setWhen('30d')} />
            <span>
              <strong>In 30 days</strong>
              <span>Nothing changes until {later}; then they’re signed out and blocked.</span>
            </span>
          </label>
        </fieldset>
        <label className="suspend-reason">
          <span>
            Reason <em>optional, only admins see it</em>
          </span>
          <textarea value={reason} maxLength={300} rows={2} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spam files, payment issue…" />
        </label>
        <div className="suspend-actions">
          <button type="button" className="profile-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="profile-button is-danger" disabled={busy}>
            <UserX size={13} strokeWidth={1.75} />
            {busy ? 'Suspending…' : when === 'now' ? 'Suspend now' : `Suspend on ${later}`}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Row actions don't also open the details panel. */
const stop = (e: MouseEvent) => e.stopPropagation();

function SkeletonRow() {
  return (
    <tr className="admin-skeleton" aria-hidden="true">
      <td>
        <span className="chrome-skeleton shimmer" style={{ width: 150 }} />
        <span className="chrome-skeleton shimmer is-small" style={{ width: 110 }} />
      </td>
      <td>
        <span className="chrome-skeleton shimmer" style={{ width: 64 }} />
      </td>
      <td>
        <span className="chrome-skeleton shimmer" style={{ width: 36 }} />
      </td>
      <td>
        <span className="chrome-skeleton shimmer" style={{ width: 200 }} />
      </td>
      <td>
        <span className="chrome-skeleton shimmer" style={{ width: 84 }} />
        <span className="chrome-skeleton shimmer is-small" style={{ width: 70 }} />
      </td>
      <td className="admin-status">
        <span className="chrome-skeleton shimmer is-button" />
      </td>
    </tr>
  );
}
