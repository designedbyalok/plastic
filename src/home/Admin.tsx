/**
 * Waitlist and invites (admins only; the server checks ADMIN_EMAILS on every request).
 * People join from the landing page; inviting someone emails them a sign-up link, and only
 * invited emails can create an account. Click a person to see what their account costs to run.
 *
 * Refreshing only reloads the data: the page stays put and the list shows skeleton rows.
 */
import { Check, Copy, Mail, Megaphone, RefreshCw, Send, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { MemberPanel } from './MemberPanel.tsx';

type Filter = 'waiting' | 'invited' | 'joined' | 'all';

interface Entry {
  readonly email: string;
  readonly name: string | null;
  readonly role: string | null;
  readonly teamSize: string | null;
  readonly useCase: string | null;
  readonly source: string;
  readonly createdAt: number;
  readonly invitedAt: number | null;
  readonly joined: boolean;
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
  { id: 'invited', label: 'Invited', count: 'invited' },
  { id: 'joined', label: 'Joined', count: 'joined' },
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

async function invite(email: string, resend = false): Promise<{ emailed: boolean; already?: boolean }> {
  const response = await fetch('/api/admin/invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, resend }),
  });
  const data = (await response.json().catch(() => ({}))) as { emailed?: boolean; already?: boolean; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Couldn’t send the invite.');
  return { emailed: Boolean(data.emailed), already: data.already };
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

  const send = async (email: string, resend = false) => {
    setBusy(email);
    setNotice(null);
    setManualLink(null);
    setCopied(false);
    try {
      const result = await invite(email, resend);
      setNotice(
        result.already
          ? `${email} was already invited. Use Resend to email them again.`
          : result.emailed
            ? `Invite sent to ${email}.`
            : `${email} is invited and can sign up now. Send them this link:`,
      );
      if (!result.already && !result.emailed) setManualLink(signUpLink(email));
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

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
          <p className="admin-lede">Plastic is invite-only. Invited people get an email with a sign-up link; only invited emails can create an account.</p>
        </div>
        <button type="button" className="profile-button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
          <RefreshCw size={13} strokeWidth={1.75} className={loading ? 'admin-spin' : undefined} />
          Refresh
        </button>
      </header>

      <form className="admin-direct" onSubmit={submitDirect}>
        <Mail size={14} strokeWidth={1.75} className="admin-direct-icon" />
        <input type="email" placeholder="Invite someone by email" aria-label="Email to invite" value={direct} onChange={(e) => setDirect(e.target.value)} required />
        <button type="submit" className="profile-button is-primary" disabled={!direct.trim() || busy !== null}>
          <UserPlus size={13} strokeWidth={1.75} />
          Invite
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
            {page ? <span className="admin-count">{page.counts[f.count]}</span> : <span className="admin-count shimmer" aria-hidden="true" />}
          </button>
        ))}
      </div>

      {error && (
        <p className="home-empty" role="alert">
          {error}
        </p>
      )}
      {!error && !loading && page && page.entries.length === 0 && <p className="home-empty">{filter === 'waiting' ? 'Nobody is waiting right now.' : 'Nobody here yet.'}</p>}

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
                        {entry.joined ? (
                          <span className="admin-badge is-joined">
                            <Check size={12} strokeWidth={2} />
                            Joined
                          </span>
                        ) : entry.invitedAt ? (
                          <button type="button" className="profile-button" disabled={busy !== null} onClick={() => void send(entry.email, true)} title={`Invited ${date.format(entry.invitedAt)}`}>
                            <Send size={12} strokeWidth={1.75} />
                            {busy === entry.email ? 'Sending…' : 'Resend'}
                          </button>
                        ) : (
                          <button type="button" className="profile-button is-primary" disabled={busy !== null} onClick={() => void send(entry.email)}>
                            <UserPlus size={12} strokeWidth={1.75} />
                            {busy === entry.email ? 'Inviting…' : 'Invite'}
                          </button>
                        )}
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
    </div>
  );
}

/** Row actions (invite, resend) don't also open the details panel. */
const stop = (e: MouseEvent) => e.stopPropagation();

function SkeletonRow() {
  return (
    <tr className="admin-skeleton" aria-hidden="true">
      <td>
        <span className="shimmer" style={{ width: 150 }} />
        <span className="shimmer is-small" style={{ width: 110 }} />
      </td>
      <td>
        <span className="shimmer" style={{ width: 64 }} />
      </td>
      <td>
        <span className="shimmer" style={{ width: 36 }} />
      </td>
      <td>
        <span className="shimmer" style={{ width: 200 }} />
      </td>
      <td>
        <span className="shimmer" style={{ width: 84 }} />
        <span className="shimmer is-small" style={{ width: 70 }} />
      </td>
      <td className="admin-status">
        <span className="shimmer is-button" />
      </td>
    </tr>
  );
}
