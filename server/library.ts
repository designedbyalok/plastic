/**
 * The local workspace's library: folders, the archive, activity and the profile, kept in
 * workspace/.plastic/library.json (a dot folder, so it's never mistaken for a project).
 * The cloud keeps the same things in D1 (worker/library.ts).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ID } from './projectStore.ts';

export interface LibraryData {
  folders: { id: string; name: string; createdAt: number }[];
  places: Record<string, { folderId: string | null; archivedAt: number | null }>;
  /** Edits per day ("YYYY-MM-DD", local time). */
  activity: Record<string, number>;
  profile: { name: string; username: string | null };
}

const FOLDER_ID = /^[a-z0-9]{8,32}$/;
const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;

function empty(): LibraryData {
  return { folders: [], places: {}, activity: {}, profile: { name: '', username: null } };
}

function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');
}

const cleanName = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 120) : '');

export class LibraryStore {
  private readonly file: string;
  /** Serialize read-modify-write so concurrent requests don't lose updates. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.file = path.join(root, '.plastic', 'library.json');
  }

  async read(): Promise<LibraryData> {
    const text = await fsp.readFile(this.file, 'utf8').catch(() => null);
    if (!text) return empty();
    try {
      return { ...empty(), ...(JSON.parse(text) as Partial<LibraryData>) };
    } catch {
      return empty();
    }
  }

  private update<T>(fn: (data: LibraryData) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      const result = fn(data);
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      await fsp.writeFile(this.file, JSON.stringify(data, null, 2) + '\n', 'utf8');
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  recordEdit(): Promise<void> {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return this.update((d) => {
      d.activity[day] = (d.activity[day] ?? 0) + 1;
    });
  }

  /** Apply one change from the home screen. Returns a JSON-able result or throws a message. */
  async apply(op: Record<string, unknown>): Promise<unknown> {
    switch (op.op) {
      case 'createFolder': {
        const name = cleanName(op.name);
        if (!name) throw new Error('A folder needs a name.');
        const folder = { id: newId(), name, createdAt: Date.now() };
        await this.update((d) => d.folders.push(folder));
        return { folder };
      }
      case 'renameFolder': {
        const name = cleanName(op.name);
        if (!name || typeof op.id !== 'string') throw new Error('A folder needs a name.');
        await this.update((d) => d.folders.forEach((f) => f.id === op.id && (f.name = name)));
        return {};
      }
      case 'deleteFolder':
        await this.update((d) => {
          d.folders = d.folders.filter((f) => f.id !== op.id);
          for (const place of Object.values(d.places)) if (place.folderId === op.id) place.folderId = null;
        });
        return {};
      case 'place': {
        const id = String(op.id ?? '');
        if (!PROJECT_ID.test(id)) throw new Error('Unknown file.');
        await this.update((d) => {
          const place = d.places[id] ?? { folderId: null, archivedAt: null };
          if ('folderId' in op) {
            const folderId = op.folderId === null ? null : String(op.folderId);
            if (folderId && (!FOLDER_ID.test(folderId) || !d.folders.some((f) => f.id === folderId))) throw new Error('No such folder.');
            place.folderId = folderId;
          }
          if (typeof op.archived === 'boolean') place.archivedAt = op.archived ? Date.now() : null;
          d.places[id] = place;
        });
        return {};
      }
      case 'forget':
        await this.update((d) => {
          delete d.places[String(op.id ?? '')];
        });
        return {};
      case 'profile': {
        const name = cleanName(op.name);
        const username = op.username === null || op.username === '' ? null : String(op.username ?? '');
        if (username !== null && !USERNAME.test(username)) throw new Error('Usernames are 3–30 letters, numbers, dots or underscores.');
        await this.update((d) => {
          d.profile = { name, username };
        });
        return {};
      }
      default:
        throw new Error('Unknown change.');
    }
  }
}
