import { describe, expect, it } from 'vitest';
import { folderHref, parseRoute } from '../src/app/router.ts';
import { calendar, streaks } from '../src/home/Profile.tsx';
import { initials } from '../src/home/Avatar.tsx';

describe('home routes', () => {
  it('parses files, folders, archive and profile', () => {
    expect(parseRoute('/files')).toEqual({ name: 'files', folderId: null });
    expect(parseRoute('/files/abc123def0')).toEqual({ name: 'files', folderId: 'abc123def0' });
    expect(parseRoute('/archive')).toEqual({ name: 'archive' });
    expect(parseRoute('/profile/')).toEqual({ name: 'profile' });
    expect(folderHref(null)).toBe('/files');
    expect(folderHref('abc123def0')).toBe('/files/abc123def0');
  });
});

describe('profile activity', () => {
  const today = new Date(2026, 9, 2); // Fri 2 Oct 2026

  it('counts streaks, active days and edits', () => {
    const days = { '2026-09-28': 2, '2026-09-29': 1, '2026-09-30': 4, '2026-10-01': 1, '2026-10-02': 3, '2026-09-01': 5, '2026-09-02': 1 };
    expect(streaks(days, today)).toEqual({ current: 5, longest: 5, active: 7, edits: 17 });
    // No edits yet today: the streak up to yesterday still counts.
    expect(streaks({ '2026-09-30': 1, '2026-10-01': 1 }, today).current).toBe(2);
    expect(streaks({ '2026-09-29': 1 }, today).current).toBe(0);
  });

  it('lays out 53 weeks that start on Sunday and end this week', () => {
    const weeks = calendar({ '2026-10-02': 3 }, today);
    expect(weeks).toHaveLength(53);
    expect(weeks.every((w) => w.length === 7 && w[0]!.date.getDay() === 0)).toBe(true);
    const last = weeks.at(-1)!;
    expect(last.find((d) => d.key === '2026-10-02')?.edits).toBe(3);
    expect(last.find((d) => d.key === '2026-10-03')?.future).toBe(true);
  });

  it('makes initials from a name, or a fallback', () => {
    expect(initials('Alok Kumar')).toBe('AK');
    expect(initials('', 'test.designer@example.com')).toBe('TD');
    expect(initials('plastic')).toBe('PL');
  });
});
