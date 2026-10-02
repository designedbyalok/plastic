/**
 * Profile: who you are (name, @username) and what you've been doing — edits per day over the
 * last year, as a heat map or weekly bars, with streaks.
 */
import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '../auth/AuthGate.tsx';
import { connectWorkspace, dayKey, type Activity, type Profile as ProfileData } from '../serialization/storage.ts';
import { displayName } from './AccountMenu.tsx';
import { Avatar } from './Avatar.tsx';
import { Logo } from '../app/Logo.tsx';

const WEEKS = 53;
const DAY_MS = 86_400_000;
const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;
type Mode = 'daily' | 'weekly';

interface Day {
  readonly key: string;
  readonly date: Date;
  readonly edits: number;
  readonly future: boolean;
}

/** 53 weeks × 7 days ending this week (columns start on Sunday). */
export function calendar(days: Readonly<Record<string, number>>, today = new Date()): Day[][] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end.getTime() - (end.getDay() + (WEEKS - 1) * 7) * DAY_MS);
  const weeks: Day[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const week: Day[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const key = dayKey(date);
      week.push({ key, date, edits: days[key] ?? 0, future: date > end });
    }
    weeks.push(week);
  }
  return weeks;
}

export function streaks(days: Readonly<Record<string, number>>, today = new Date()): { current: number; longest: number; active: number; edits: number } {
  const keys = Object.keys(days).filter((k) => (days[k] ?? 0) > 0).sort();
  const active = new Set(keys);
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const key of keys) {
    const [y, m, d] = key.split('-').map(Number) as [number, number, number];
    const date = new Date(y, m - 1, d);
    run = prev && Math.round((date.getTime() - prev.getTime()) / DAY_MS) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  // Current: consecutive days up to today (or yesterday, if today has no edits yet).
  let current = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (active.has(dayKey(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const edits = keys.reduce((sum, k) => sum + (days[k] ?? 0), 0);
  return { current, longest, active: keys.length, edits };
}

const number = new Intl.NumberFormat();
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function level(edits: number, max: number): number {
  if (!edits) return 0;
  return Math.min(4, Math.ceil((edits / Math.max(1, max)) * 4));
}

export function ProfileView({ profile, onSaved }: { profile: ProfileData | null; onSaved(): void }) {
  const account = useAccount();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [mode, setMode] = useState<Mode>('daily');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void connectWorkspace()
      .then((w) => w.activity())
      .then(setActivity)
      .catch(() => setActivity({ days: {}, files: 0 }));
  }, []);

  const days = activity?.days ?? {};
  const weeks = useMemo(() => calendar(days), [days]);
  const stats = useMemo(() => streaks(days), [days]);
  const name = displayName(profile, account?.name);

  return (
    <div className="profile">
      <div className="profile-top">
        {!editing && (
          <button type="button" className="profile-edit" onClick={() => setEditing(true)}>
            <Pencil size={13} strokeWidth={1.75} />
            Edit profile
          </button>
        )}
      </div>
      <div className="profile-identity">
        {account || profile?.name ? <Avatar name={name} fallback={profile?.email ?? account?.email} size={96} /> : <Logo size={96} />}
        {editing ? (
          <ProfileForm
            profile={profile}
            fallbackName={account?.name ?? ''}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onSaved();
            }}
          />
        ) : (
          <>
            <h1 className="profile-name">{name}</h1>
            {profile?.username ? (
              <div className="profile-handle">@{profile.username}</div>
            ) : (
              <button type="button" className="profile-add-handle" onClick={() => setEditing(true)}>
                Choose a username
              </button>
            )}
          </>
        )}
      </div>

      <dl className="profile-stats">
        <Stat label="Files" value={activity ? number.format(activity.files) : '–'} />
        <Stat label="Edits this year" value={activity ? number.format(stats.edits) : '–'} />
        <Stat label="Active days" value={activity ? number.format(stats.active) : '–'} />
        <Stat label="Longest streak" value={activity ? `${stats.longest} ${stats.longest === 1 ? 'day' : 'days'}` : '–'} />
        <Stat label="Current streak" value={activity ? `${stats.current} ${stats.current === 1 ? 'day' : 'days'}` : '–'} />
      </dl>

      <section className="profile-activity" aria-label="Activity">
        <header className="profile-activity-header">
          <h2>Activity</h2>
          <div className="profile-modes" role="radiogroup" aria-label="Activity view">
            {(['daily', 'weekly'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={`profile-mode${mode === m ? ' is-active' : ''}`} onClick={() => setMode(m)}>
                {m === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
        </header>
        {mode === 'daily' ? <Heatmap weeks={weeks} /> : <WeeklyBars weeks={weeks} />}
        <Months weeks={weeks} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-stat">
      <dd>{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function Heatmap({ weeks }: { weeks: Day[][] }) {
  const max = Math.max(1, ...weeks.flat().map((d) => d.edits));
  return (
    <div className="profile-heatmap" role="img" aria-label="Edits per day over the last year">
      {weeks.map((week, w) => (
        <div key={w} className="profile-week">
          {week.map((day) => (
            <span
              key={day.key}
              className={`profile-day level-${day.future ? 'none' : level(day.edits, max)}`}
              title={day.future ? undefined : `${day.edits ? `${number.format(day.edits)} ${day.edits === 1 ? 'edit' : 'edits'}` : 'No edits'} on ${dayFormat.format(day.date)}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function WeeklyBars({ weeks }: { weeks: Day[][] }) {
  const totals = weeks.map((w) => w.reduce((sum, d) => sum + d.edits, 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="profile-bars" role="img" aria-label="Edits per week over the last year">
      {totals.map((total, i) => (
        <span key={i} className="profile-bar-slot" title={`${number.format(total)} ${total === 1 ? 'edit' : 'edits'} in the week of ${dayFormat.format(weeks[i]![0]!.date)}`}>
          <span className={`profile-bar${total ? '' : ' is-empty'}`} style={{ height: `${total ? Math.max(6, (total / max) * 100) : 6}%` }} />
        </span>
      ))}
    </div>
  );
}

function Months({ weeks }: { weeks: Day[][] }) {
  return (
    <div className="profile-months" aria-hidden="true">
      {weeks.map((week, i) => {
        const first = week.find((d) => d.date.getDate() === 1);
        return (
          <span key={i} className="profile-month">
            {first && i < weeks.length - 1 ? monthFormat.format(first.date) : ''}
          </span>
        );
      })}
    </div>
  );
}

function ProfileForm({ profile, fallbackName, onCancel, onSaved }: { profile: ProfileData | null; fallbackName: string; onCancel(): void; onSaved(): void }) {
  const [name, setName] = useState(profile?.name || fallbackName);
  const [username, setUsername] = useState(profile?.username ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const usernameValid = !username || USERNAME.test(username);

  const save = async () => {
    if (!usernameValid) return;
    setSaving(true);
    setError(null);
    try {
      const workspace = await connectWorkspace();
      await workspace.updateProfile({ name: name.trim(), username: username.trim() || null });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="profile-field">
        <span>Name</span>
        <input value={name} autoFocus maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
      </label>
      <label className="profile-field">
        <span>Username</span>
        <span className={`profile-username${usernameValid ? '' : ' is-invalid'}`}>
          <span className="profile-at">@</span>
          <input value={username} maxLength={30} spellCheck={false} autoCapitalize="off" onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))} placeholder="username" />
        </span>
        <span className="profile-hint">{usernameValid ? '3–30 letters, numbers, dots or underscores.' : 'Use 3–30 letters, numbers, dots or underscores.'}</span>
      </label>
      {error && (
        <p className="profile-error" role="alert">
          {error}
        </p>
      )}
      <div className="profile-form-actions">
        <button type="button" className="profile-button" onClick={onCancel}>
          <X size={13} strokeWidth={1.75} />
          Cancel
        </button>
        <button type="submit" className="profile-button is-primary" disabled={saving || !usernameValid}>
          <Check size={13} strokeWidth={2} />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
