import { describe, expect, it, vi } from 'vitest';

vi.mock('../worker/live.ts', () => ({ CLIENT_ID: /^[a-z0-9]{8,32}$/, room: () => ({ changed: vi.fn() }) }));
const modulePath = '../worker/cleanup.ts';
const { GRACE_MS, WEEKLY_CRON, scheduledSweep, sweepRevisions } = await import(modulePath);

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 3, 12);
const prefix = 'users/u/projects/p/';
const current = 'c'.repeat(64);

function harness(updatedAt: number, files: Record<string, string> | string = { 'index.html': current }) {
  const objects = new Map<string, { uploaded: Date; etag: string }>();
  const add = (key: string, ageMs: number, etag = 'e'.repeat(32)) => objects.set(key, { uploaded: new Date(now - ageMs), etag });
  const queries: unknown[][] = [];
  const DB = {
    prepare: () => ({
      bind: (...args: unknown[]) => ({
        all: async () => {
          queries.push(args);
          const [from, to] = args as [number, number];
          const row = { owner_id: 'u', id: 'p', files: typeof files === 'string' ? files : JSON.stringify(files) };
          return { results: updatedAt >= from && updatedAt < to ? [row] : [] };
        },
      }),
    }),
  };
  const FILES = {
    // Small pages, so the cursor path is exercised.
    list: async ({ prefix: p, cursor, delimiter }: { prefix: string; cursor?: string; delimiter?: string }) => {
      const keys = [...objects.keys()].filter((k) => k.startsWith(p) && (!delimiter || !k.slice(p.length).includes(delimiter))).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + 2);
      return {
        objects: page.map((key) => ({ key, ...objects.get(key)! })),
        truncated: start + 2 < keys.length,
        cursor: String(start + 2),
      };
    },
    delete: async (keys: string[]) => keys.forEach((k) => objects.delete(k)),
  };
  return { env: { DB, FILES } as never, objects, add, queries };
}

describe('revision sweep', () => {
  it('deletes unreferenced revisions older than the grace period, and nothing else', async () => {
    const h = harness(now - 2 * HOUR);
    h.add(`${prefix}revisions/index.html/${current}`, 5 * HOUR); // referenced, however old
    h.add(`${prefix}revisions/index.html/${'a'.repeat(64)}`, 3 * HOUR); // superseded
    h.add(`${prefix}revisions/index.html/${'b'.repeat(64)}`, 2 * HOUR); // orphaned upload
    h.add(`${prefix}revisions/styles.css/${'d'.repeat(64)}`, 10 * 60 * 1000); // fresh: commit may be on its way
    h.add(`${prefix}assets/logo.png`, 9 * HOUR); // images are never swept
    h.add(`${prefix}index.html`, 9 * HOUR); // legacy copy: only the weekly run looks at these
    const result = await sweepRevisions(h.env, now, { lookbackMs: 3 * HOUR });
    expect(result).toEqual({ projects: 1, deleted: 2 });
    expect([...h.objects.keys()].sort()).toEqual(
      [
        `${prefix}assets/logo.png`,
        `${prefix}index.html`,
        `${prefix}revisions/index.html/${current}`,
        `${prefix}revisions/styles.css/${'d'.repeat(64)}`,
      ].sort(),
    );
  });

  it('only sweeps projects that have been idle for the grace period', async () => {
    const h = harness(now - 10 * 60 * 1000);
    h.add(`${prefix}revisions/index.html/${'a'.repeat(64)}`, 3 * HOUR);
    expect(await sweepRevisions(h.env, now, { lookbackMs: 3 * HOUR })).toEqual({ projects: 0, deleted: 0 });
    expect(h.queries[0]!.slice(0, 2)).toEqual([now - GRACE_MS - 3 * HOUR, now - GRACE_MS]);
  });

  it('never deletes from a project whose manifest cannot be read', async () => {
    const h = harness(now - 2 * HOUR, 'not json');
    h.add(`${prefix}revisions/index.html/${'a'.repeat(64)}`, 3 * HOUR);
    expect((await sweepRevisions(h.env, now, { lookbackMs: 3 * HOUR })).deleted).toBe(0);
  });

  it('weekly run also removes legacy copies the manifest no longer points at', async () => {
    const legacyEtag = 'f'.repeat(32);
    const h = harness(now - 3 * 24 * HOUR, { 'index.html': current, 'styles.css': legacyEtag });
    h.add(`${prefix}index.html`, 9 * HOUR); // superseded by a revision
    h.add(`${prefix}styles.css`, 9 * HOUR, legacyEtag); // still the committed version
    expect(await scheduledSweep(h.env, '17 * * * *', now)).toEqual({ projects: 0, deleted: 0 });
    expect(await scheduledSweep(h.env, WEEKLY_CRON, now)).toEqual({ projects: 1, deleted: 1 });
    expect(h.objects.has(`${prefix}index.html`)).toBe(false);
    expect(h.objects.has(`${prefix}styles.css`)).toBe(true);
  });
});
