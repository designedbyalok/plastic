/**
 * One person, from the Waitlist page: their account and sign-ins, files and activity, and the
 * storage they use. Everything here maps to Cloudflare usage (R2 storage and operations, D1
 * rows and writes, Worker requests).
 */
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

interface Usage {
  readonly bytes: number;
  readonly objects: number;
}

interface Details {
  readonly email: string;
  readonly waitlist: {
    readonly joinedAt: number;
    readonly source: string;
    readonly invitedAt: number | null;
    readonly role: string | null;
    readonly teamSize: string | null;
    readonly useCase: string | null;
  } | null;
  readonly account: {
    readonly name: string;
    readonly createdAt: string;
    readonly emailVerified: boolean;
    readonly signInMethods: readonly string[];
    readonly lastSignIn: string | null;
    readonly lastActive: string | null;
    readonly activeSessions: number;
    readonly releaseNotes: { readonly edition: string; readonly received: boolean; readonly unsubscribed: boolean };
    readonly suspension: { readonly startsAt: number; readonly reason: string | null; readonly by: string } | null;
  } | null;
  readonly files: { readonly active: number; readonly archived: number; readonly folders: number; readonly lastEdited: number | null } | null;
  readonly activity: { readonly savesLast30Days: number; readonly savesLast365Days: number; readonly activeDaysLast30: number } | null;
  readonly storage: (Usage & { readonly current: Usage; readonly oldVersions: Usage; readonly images: Usage; readonly partial: boolean; readonly listOperations: number }) | null;
}

/** R2's free storage allowance, for context. */
const FREE_R2_BYTES = 10 * 1024 ** 3;
const METHOD_LABELS: Record<string, string> = { password: 'Email and password', google: 'Google', github: 'GitHub' };

const dateTime = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function ago(value: string | number | null): string {
  if (value === null) return 'Never';
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return 'Unknown';
  const seconds = (time - Date.now()) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [86400 * 30, 'day'],
    [86400 * 365, 'month'],
  ];
  for (const [limit, unit] of steps) {
    if (Math.abs(seconds) < limit) {
      const size = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : unit === 'day' ? 86400 : 86400 * 30;
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return relative.format(Math.round(seconds / (86400 * 365)), 'year');
}

function exact(value: string | number | null): string | undefined {
  if (value === null) return undefined;
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? dateTime.format(time) : undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Share of the free R2 allowance: precise enough to see small accounts, without "0.000%". */
function share(bytes: number): string {
  const percent = (bytes / FREE_R2_BYTES) * 100;
  if (percent === 0) return '0%';
  if (percent < 0.001) return 'under 0.001%';
  return `${percent < 1 ? percent.toPrecision(2) : percent.toFixed(1)}%`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

export function MemberPanel({ email, onClose }: { email: string; onClose(): void }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setDetails(null);
    setError(null);
    fetch(`/api/admin/members/${encodeURIComponent(email)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Couldn’t load this person’s details.');
        return (await response.json()) as Details;
      })
      .then((data) => current && setDetails(data))
      .catch((e: unknown) => current && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      current = false;
    };
  }, [email]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const account = details?.account;
  return (
    <div className="member-backdrop" onClick={onClose}>
      <aside className="member-panel" role="dialog" aria-modal="true" aria-label={`Details for ${email}`} onClick={(e) => e.stopPropagation()}>
        <header className="member-head">
          <div>
            <h2>{account?.name || email}</h2>
            {account?.name && <p>{email}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={15} strokeWidth={1.5} />
          </button>
        </header>

        {error && (
          <p className="member-error" role="alert">
            {error}
          </p>
        )}
        {!error && !details && <PanelSkeleton />}

        {details && !account && (
          <Section title="Account">
            <p className="member-empty">{details.waitlist?.invitedAt ? 'Invited, but hasn’t created an account yet.' : 'No account yet. Invite them to let them in.'}</p>
          </Section>
        )}

        {account && (
          <>
            <Section title="Sign-in">
              <Row label="Last signed in" value={ago(account.lastSignIn)} title={exact(account.lastSignIn)} />
              <Row label="Last active" value={ago(account.lastActive)} title={exact(account.lastActive)} />
              <Row
                label="Status"
                value={
                  !account.suspension
                    ? 'Active'
                    : account.suspension.startsAt <= Date.now()
                      ? `Suspended ${ago(account.suspension.startsAt)}`
                      : `Suspends ${ago(account.suspension.startsAt)}`
                }
                title={account.suspension ? `${exact(account.suspension.startsAt)} • by ${account.suspension.by}` : undefined}
              />
              {account.suspension?.reason && <p className="member-quote">“{account.suspension.reason}”</p>}
              <Row label="Active sessions" value={String(account.activeSessions)} />
              <Row label="Signs in with" value={account.signInMethods.map((m) => METHOD_LABELS[m] ?? m).join(', ') || 'Unknown'} />
              <Row label="Email" value={account.emailVerified ? 'Verified' : 'Not verified'} />
              <Row label="Account created" value={ago(account.createdAt)} title={exact(account.createdAt)} />
            </Section>

            {details.files && details.activity && (
              <Section title="Files and activity">
                <Row label="Files" value={plural(details.files.active, 'file')} />
                <Row label="Archived" value={plural(details.files.archived, 'file')} />
                <Row label="Folders" value={plural(details.files.folders, 'folder')} />
                <Row label="Last edit" value={ago(details.files.lastEdited)} title={exact(details.files.lastEdited)} />
                <Row label="Saves, last 30 days" value={details.activity.savesLast30Days.toLocaleString('en')} />
                <Row label="Saves, last year" value={details.activity.savesLast365Days.toLocaleString('en')} />
                <Row label="Active days, last 30" value={String(details.activity.activeDaysLast30)} />
                <p className="member-note">Each save writes the changed files to R2 and updates the database, so saves track R2 and D1 write operations.</p>
              </Section>
            )}

            {details.storage && (
              <Section title="Storage (R2)">
                <div className="member-storage">
                  <strong>{formatBytes(details.storage.bytes)}</strong>
                  <span>
                    {plural(details.storage.objects, 'object')} • {share(details.storage.bytes)} of the 10 GB free allowance
                  </span>
                </div>
                <StorageBar storage={details.storage} />
                <Row swatch="current" label="Current files" value={formatBytes(details.storage.current.bytes)} detail={plural(details.storage.current.objects, 'object')} />
                <Row swatch="old" label="Old versions" value={formatBytes(details.storage.oldVersions.bytes)} detail={plural(details.storage.oldVersions.objects, 'object')} />
                <Row swatch="images" label="Images" value={formatBytes(details.storage.images.bytes)} detail={plural(details.storage.images.objects, 'object')} />
                <p className="member-note">
                  Old versions are removed automatically an hour after a file goes idle. Measuring used {plural(details.storage.listOperations, 'R2 list operation')}
                  {details.storage.partial ? '; there are more objects than were counted, so these numbers are a lower bound.' : '.'}
                </p>
              </Section>
            )}

            <Section title="Email">
              <Row
                label={`Release notes (${account.releaseNotes.edition})`}
                value={account.releaseNotes.unsubscribed ? 'Unsubscribed' : account.releaseNotes.received ? 'Received' : 'Not sent yet'}
              />
            </Section>
          </>
        )}

        {details?.waitlist && (
          <Section title="Waitlist">
            <Row label="Joined the list" value={ago(details.waitlist.joinedAt)} title={exact(details.waitlist.joinedAt)} detail={`from ${details.waitlist.source}`} />
            <Row label="Invited" value={details.waitlist.invitedAt ? ago(details.waitlist.invitedAt) : 'Not yet'} title={exact(details.waitlist.invitedAt)} />
            {details.waitlist.role && <Row label="Role" value={details.waitlist.role} />}
            {details.waitlist.teamSize && <Row label="Team size" value={details.waitlist.teamSize} />}
            {details.waitlist.useCase && <p className="member-quote">“{details.waitlist.useCase}”</p>}
          </Section>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="member-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, detail, title, swatch }: { label: string; value: string; detail?: string; title?: string; swatch?: 'current' | 'old' | 'images' }) {
  return (
    <div className="member-row">
      <span className="member-label">
        {swatch && <i className={`member-swatch is-${swatch}`} aria-hidden="true" />}
        {label}
      </span>
      <span className="member-value" title={title}>
        {value}
        {detail && <em>{detail}</em>}
      </span>
    </div>
  );
}

function StorageBar({ storage }: { storage: NonNullable<Details['storage']> }) {
  const total = Math.max(1, storage.bytes);
  const part = (bytes: number) => `${(bytes / total) * 100}%`;
  return (
    <div className="member-bar" aria-hidden="true">
      <i className="member-swatch is-current" style={{ width: part(storage.current.bytes) }} />
      <i className="member-swatch is-old" style={{ width: part(storage.oldVersions.bytes) }} />
      <i className="member-swatch is-images" style={{ width: part(storage.images.bytes) }} />
    </div>
  );
}

function PanelSkeleton() {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => (
      <div className="member-row" key={i}>
        <span className="shimmer" style={{ width: 96 + ((i * 37) % 50) }} />
        <span className="shimmer" style={{ width: 64 + ((i * 23) % 40) }} />
      </div>
    ));
  return (
    <div aria-busy="true" aria-label="Loading">
      {[6, 7, 4].map((n, i) => (
        <section className="member-section" key={i}>
          <span className="shimmer is-small" style={{ width: 90, marginBottom: 14 }} />
          {rows(n)}
        </section>
      ))}
    </div>
  );
}
