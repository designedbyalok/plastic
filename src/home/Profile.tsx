/**
 * Profile: who you are (name, @username) and what you've been doing — edits per day over the
 * last year, as a heat map or weekly bars, with streaks.
 */
import { Camera, Check, ImageUp, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AvatarEditor, prepareSource } from './AvatarEditor.tsx';
import { useAccount } from '../auth/AuthGate.tsx';
import { connectWorkspace, dayKey, type Activity, type Profile as ProfileData } from '../serialization/storage.ts';
import { displayName } from './AccountMenu.tsx';
import { Avatar } from './Avatar.tsx';
import { Logo } from '../app/Logo.tsx';

const WEEKS = 53;
const DAY_MS = 86_400_000;
/** Same rules as the server (worker/auth.ts): it re-checks everything, including reserved names. */
const USERNAME_CHARS = /[^a-zA-Z0-9_.]/g;
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
            Edit Profile
          </button>
        )}
      </div>
      <div className="profile-identity">
        {account ? (
          <ProfilePhoto name={name} fallback={profile?.email ?? account.email} image={profile?.image ?? account.image} onChanged={onSaved} />
        ) : profile?.name ? (
          <Avatar name={name} fallback={profile?.email} size={96} />
        ) : (
          <Logo size={96} />
        )}
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
                Choose a Username
              </button>
            )}
          </>
        )}
      </div>

      <dl className="profile-stats">
        <Stat label="Files" value={activity ? number.format(activity.files) : '–'} />
        <Stat label="Edits This Year" value={activity ? number.format(stats.edits) : '–'} />
        <Stat label="Active Days" value={activity ? number.format(stats.active) : '–'} />
        <Stat label="Longest Streak" value={activity ? `${stats.longest} ${stats.longest === 1 ? 'day' : 'days'}` : '–'} />
        <Stat label="Current Streak" value={activity ? `${stats.current} ${stats.current === 1 ? 'day' : 'days'}` : '–'} />
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
  const availability = useUsernameAvailability(username, profile?.username ?? null);
  const usernameValid = !username || availability.state === 'available' || availability.state === 'current';

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
        <span className={`profile-username is-${availability.state}`}>
          <span className="profile-at" aria-hidden="true">
            @
          </span>
          <input
            value={username}
            maxLength={30}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="username"
            aria-describedby="username-hint"
            // Only letters, numbers, dots and underscores can be typed or pasted.
            onChange={(e) => setUsername(e.target.value.replace(USERNAME_CHARS, ''))}
            placeholder="username"
          />
          {availability.state === 'checking' && <Loader2 size={13} strokeWidth={2} className="profile-username-spin" aria-hidden="true" />}
          {availability.state === 'available' && <Check size={13} strokeWidth={2.25} className="profile-username-ok" aria-hidden="true" />}
        </span>
        <span id="username-hint" className={`profile-hint is-${availability.state}`} aria-live="polite">
          {availability.message}
        </span>
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

type Availability = { state: 'empty' | 'invalid' | 'current' | 'checking' | 'available' | 'taken' | 'unknown'; message: string };

/**
 * Live username check: local rules first (instant), then the server's answer for whether the name
 * is free (case-insensitive, so "Ada" and "ada" can't both exist). The server re-checks on save.
 */
function useUsernameAvailability(username: string, current: string | null): Availability {
  const [remote, setRemote] = useState<{ name: string; result: Availability } | null>(null);
  const name = username.trim();
  const local: Availability | null = !name
    ? { state: 'empty', message: '3–30 letters, numbers, dots or underscores.' }
    : name.length < 3
      ? { state: 'invalid', message: 'Use at least 3 characters.' }
      : /^\.|\.$|\.\./.test(name)
        ? { state: 'invalid', message: 'Dots can’t start or end a username, or appear twice in a row.' }
        : current && name.toLowerCase() === current.toLowerCase()
          ? { state: 'current', message: 'This is your username.' }
          : null;

  useEffect(() => {
    if (local) return;
    let live = true;
    const timer = setTimeout(async () => {
      let result: Availability;
      try {
        const response = await fetch('/api/auth/is-username-available', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: name }),
        });
        if (response.status === 422) result = { state: 'invalid', message: `@${name} isn’t allowed. Try another.` };
        else if (!response.ok) throw new Error(String(response.status));
        else {
          const { available } = (await response.json()) as { available?: boolean };
          result = available ? { state: 'available', message: `@${name} is available.` } : { state: 'taken', message: `@${name} is already taken. Try another.` };
        }
      } catch {
        // Can't check right now (or no accounts here): saving still validates on the server.
        result = { state: 'unknown', message: '3–30 letters, numbers, dots or underscores.' };
      }
      if (live) setRemote({ name, result });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [name, local === null]);

  if (local) return local;
  return remote?.name === name ? remote.result : { state: 'checking', message: `Checking @${name}…` };
}

/** The profile photo, with a camera button to upload (then crop) or remove it. */
function ProfilePhoto({ name, fallback, image, onChanged }: { name: string; fallback?: string; image?: string | null; onChanged(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = () => {
    setMenu(false);
    input.current?.click();
  };

  const upload = async (photo: Blob) => {
    const response = await fetch('/api/profile/avatar', { method: 'PUT', headers: { 'content-type': photo.type }, body: photo });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Couldn’t save the photo. Try again.');
    setSource(null);
    onChanged();
  };

  const remove = async () => {
    setMenu(false);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/profile/avatar', { method: 'DELETE' });
      if (!response.ok) throw new Error('Couldn’t remove the photo. Try again.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-photo">
      <Avatar name={name} fallback={fallback} image={image} size={96} />
      {busy && (
        <span className="profile-photo-busy" aria-hidden="true">
          <Loader2 size={18} strokeWidth={2} className="profile-username-spin" />
        </span>
      )}
      <button
        type="button"
        className="profile-photo-edit"
        aria-label={image ? 'Change or remove photo' : 'Upload a photo'}
        title={image ? 'Change photo' : 'Upload a photo'}
        aria-expanded={image ? menu : undefined}
        onClick={() => (image ? setMenu(!menu) : choose())}
        disabled={busy}
      >
        <Camera size={14} strokeWidth={1.75} />
      </button>
      {menu && (
        <div className="profile-photo-menu" role="menu">
          <button type="button" role="menuitem" onClick={choose}>
            <ImageUp size={14} strokeWidth={1.75} />
            Change photo
          </button>
          <button type="button" role="menuitem" onClick={() => void remove()}>
            <Trash2 size={14} strokeWidth={1.75} />
            Remove photo
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setError(null);
          try {
            setSource(await prepareSource(file));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {error && (
        <p className="profile-error" role="alert">
          {error}
        </p>
      )}
      {source && <AvatarEditor source={source} onChooseAnother={choose} onCancel={() => setSource(null)} onSave={upload} />}
    </div>
  );
}
