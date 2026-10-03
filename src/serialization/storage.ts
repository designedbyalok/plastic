/**
 * Where projects live. In development the dev server exposes a folder of project folders on
 * disk; on useplastic.app they're in the signed-in user's cloud storage (R2 via the Worker);
 * anywhere else (a static build) the browser's localStorage is used. Tauri will add a native
 * implementation behind the same interfaces.
 */
import type { ImportReport } from '../figma/convert.ts';
import { readProjectJson } from './project.ts';
import { StorageConflictError } from './conflict.ts';
import { authClient, detectBackend } from '../auth/client.ts';
import { PROJECT_FILE_NAME, isPageFile, type ProjectFiles } from './index.ts';
import type { PresenceMessage } from '../editor/presenceProtocol.ts';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ProjectSummary {
  readonly id: string;
  /** Last modification time (ms since epoch). */
  readonly updatedAt: number;
  readonly files: ProjectFiles;
  /** The folder it's filed in (null: top level of Files). */
  readonly folderId?: string | null;
  /** When it was archived (null: not archived). */
  readonly archivedAt?: number | null;
}

export interface Folder {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

export interface PlaceChange {
  readonly folderId?: string | null;
  readonly archived?: boolean;
}

/** Edits per day ("YYYY-MM-DD") over the last year, and how many files there are. */
export interface Activity {
  readonly days: Readonly<Record<string, number>>;
  readonly files: number;
}

export interface Profile {
  readonly name: string;
  readonly username: string | null;
  /** Account email (cloud only). */
  readonly email?: string;
  /** Can manage the waitlist and invites (cloud only; ADMIN_EMAILS on the server). */
  readonly admin?: boolean;
  /** Profile photo URL (cloud only), or null for initials. */
  readonly image?: string | null;
}

export interface ProjectStorage {
  readonly id: string;
  /** Human-readable location, e.g. "workspace/demo". */
  readonly location: string;
  /** URL the project folder is served from (for assets/…), or null. */
  readonly assetBase: string | null;
  /** How long autosave waits after the last edit (cloud storage waits longer to save requests). */
  readonly saveDelayMs?: number;
  shareLink?(): Promise<string>;
  load(): Promise<ProjectFiles | null>;
  save(files: ProjectFiles): Promise<void>;
  /** Called when the files change outside the editor (text editor, git, coding agent). */
  onExternalChange(listener: (files: ProjectFiles) => void): () => void;
  /** Opened through its shared link by someone else: it is never edited or saved. */
  readonly readOnly?: boolean;
  /** Who the file belongs to, when it is someone else's. */
  readonly ownerName?: string;
  /** Presence and cursor chat with everyone else in the file (cloud files, while live). */
  readonly presence?: PresenceLink;
}

/** The file's live room (see src/editor/presenceProtocol.ts). */
export interface PresenceLink {
  /** Sent only while connected; dropped otherwise. */
  send(message: PresenceMessage): void;
  /** Room messages, unvalidated, and { t: 'closed' } when the connection drops. */
  subscribe(listener: (message: unknown) => void): () => void;
}

export interface Workspace {
  /** disk: a folder via the dev server; cloud: the user's account; browser: localStorage. */
  readonly kind: 'disk' | 'cloud' | 'browser';
  /** Human-readable location of the workspace, e.g. "workspace". */
  readonly location: string;
  /** Projects, most recently edited first. */
  list(): Promise<ProjectSummary[]>;
  /** Create a project; returns its id. `assetsFrom` copies another project's assets/. */
  create(title: string, files: ProjectFiles, options?: { assetsFrom?: string; folderId?: string | null }): Promise<string>;
  folders(): Promise<Folder[]>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<void>;
  /** Delete a folder; its files move back to the top of Files. */
  deleteFolder(id: string): Promise<void>;
  /** Move a file into a folder (null: top level) and/or archive or restore it. */
  place(id: string, change: PlaceChange): Promise<void>;
  /** Permanently delete an archived file. */
  deleteProject(id: string): Promise<void>;
  activity(): Promise<Activity>;
  profile(): Promise<Profile>;
  /** Throws with a readable message (e.g. a username that's taken). */
  updateProfile(profile: { name: string; username: string | null }): Promise<void>;
  open(id: string): ProjectStorage;
  /**
   * A file opened through its shared link: the owner's own storage when it's yours, read-only
   * storage otherwise, or null when the link doesn't open this file.
   */
  openShared?(id: string, previewId: string): Promise<ProjectStorage | null>;
  /** URL a project's folder is served from, for its assets/ (null when assets aren't served). */
  assetBase(id: string): string | null;
  /** Convert a Figma .fig file into a new project. Null when this workspace can't import. */
  readonly importFigma: ((file: File, onProgress?: (message: string) => void) => Promise<FigmaImportResult>) | null;
  /** Called when projects are added, removed or edited anywhere. */
  onChange(listener: () => void): () => void;
}

export interface FigmaFontUse {
  readonly family: string;
  readonly token: string;
  readonly weights: readonly number[];
  readonly italic: boolean;
  readonly layers: number;
}

export interface FigmaImportResult {
  readonly id: string;
  readonly report: ImportReport;
}

const PROJECT_CHANGED_EVENT = 'plastic:project-changed';
const WORKSPACE_CHANGED_EVENT = 'plastic:workspace-changed';

/** A project: file name → text, with at least one page. Unknown or unsafe names are dropped. */
function isFiles(value: unknown): value is ProjectFiles {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.some(([name]) => isPageFile(name)) && entries.every(([, text]) => typeof text === 'string');
}

function pickFiles(v: ProjectFiles): ProjectFiles {
  return Object.fromEntries(Object.entries(v).filter(([name]) => PROJECT_FILE_NAME.test(name)));
}

function onHot(event: string, handler: (data: unknown) => void): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => {};
  hot.on(event, handler);
  return () => hot.off(event, handler);
}

// --- dev server (files on disk) ----------------------------------------------------------------

class DevServerWorkspace implements Workspace {
  readonly kind = 'disk';
  constructor(public readonly location: string) {}

  async list(): Promise<ProjectSummary[]> {
    const response = await fetch('/__plastic/workspace');
    const data = (await response.json()) as { projects?: unknown[] };
    return (data.projects ?? []).flatMap((p) => {
      const v = p as { id?: unknown; updatedAt?: unknown; files?: unknown; folderId?: unknown; archivedAt?: unknown };
      if (typeof v.id !== 'string' || !isFiles(v.files)) return [];
      return [{ id: v.id, updatedAt: Number(v.updatedAt) || 0, files: pickFiles(v.files), folderId: typeof v.folderId === 'string' ? v.folderId : null, archivedAt: typeof v.archivedAt === 'number' ? v.archivedAt : null }];
    });
  }

  private async libraryData(): Promise<{ folders: Folder[]; activity: Record<string, number>; profile: { name: string; username: string | null } }> {
    const response = await fetch('/__plastic/library');
    if (!response.ok) throw new Error(`Could not read the library: ${response.status}`);
    return response.json() as never;
  }

  private async libraryOp(op: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch('/__plastic/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`);
    return data;
  }

  async folders(): Promise<Folder[]> {
    return [...(await this.libraryData()).folders].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createFolder(name: string): Promise<Folder> {
    return (await this.libraryOp({ op: 'createFolder', name })).folder as Folder;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.libraryOp({ op: 'renameFolder', id, name });
  }

  async deleteFolder(id: string): Promise<void> {
    await this.libraryOp({ op: 'deleteFolder', id });
  }

  async place(id: string, change: PlaceChange): Promise<void> {
    await this.libraryOp({ op: 'place', id, ...change });
  }

  async deleteProject(id: string): Promise<void> {
    const response = await fetch(`/__plastic/project/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Couldn’t delete the file (${response.status}).`);
  }

  async activity(): Promise<Activity> {
    const [data, projects] = await Promise.all([this.libraryData(), this.list()]);
    return { days: data.activity ?? {}, files: projects.filter((p) => !p.archivedAt).length };
  }

  async profile(): Promise<Profile> {
    return (await this.libraryData()).profile ?? { name: '', username: null };
  }

  async updateProfile(profile: { name: string; username: string | null }): Promise<void> {
    await this.libraryOp({ op: 'profile', ...profile });
  }

  async create(title: string, files: ProjectFiles, options: { assetsFrom?: string; folderId?: string | null } = {}): Promise<string> {
    const response = await fetch('/__plastic/workspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, files, assetsFrom: options.assetsFrom, folderId: options.folderId ?? undefined }),
    });
    if (!response.ok) throw new Error(`Could not create project: ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  }

  assetBase(id: string): string {
    return `/__plastic/files/${encodeURIComponent(id)}/`;
  }

  readonly importFigma = async (file: File): Promise<FigmaImportResult> => {
    const response = await fetch(`/__plastic/import/figma?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string } & Partial<FigmaImportResult>;
    if (!response.ok || !data.id || !data.report) throw new Error(data.error ?? `Import failed (${response.status}).`);
    return data as FigmaImportResult;
  };

  open(id: string): ProjectStorage {
    const endpoint = `/__plastic/project/${encodeURIComponent(id)}`;
    let saved: ProjectFiles | null = null;
    return {
      id,
      location: `${this.location}/${id}`,
      assetBase: this.assetBase(id),
      async load() {
        const response = await fetch(endpoint);
        if (!response.ok) return null;
        const data = (await response.json()) as { files?: unknown };
        saved = isFiles(data.files) ? pickFiles(data.files) : null;
        return saved;
      },
      async save(files) {
        const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files, expected: saved }) });
        if (response.status === 409) {
          const incoming = (await response.json()) as { files: ProjectFiles };
          saved = incoming.files; throw new StorageConflictError(incoming.files);
        }
        if (!response.ok) throw new Error(`Save failed: ${response.status}`);
        saved = files;
      },
      onExternalChange(listener) {
        return onHot(PROJECT_CHANGED_EVENT, (data) => {
          const v = data as { id?: unknown; files?: unknown };
          if (v.id === id && isFiles(v.files)) { saved = pickFiles(v.files); listener(saved); }
        });
      },
    };
  }

  onChange(listener: () => void): () => void {
    return onHot(WORKSPACE_CHANGED_EVENT, () => listener());
  }
}

// --- browser fallback ------------------------------------------------------------------------

const LOCAL_KEY = 'plastic:projects';
const LEGACY_KEY = 'plastic:project';

type LocalProjects = Record<string, { files: ProjectFiles; updatedAt: number }>;

class LocalStorageWorkspace implements Workspace {
  readonly kind = 'browser';
  readonly location = 'this browser';
  private readonly listeners = new Set<() => void>();

  private read(): LocalProjects {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as LocalProjects;
      // Earlier builds stored { html, css, project } under one key.
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null') as { html?: unknown; css?: unknown; project?: unknown } | null;
      if (legacy && typeof legacy.html === 'string' && !parsed.untitled) {
        parsed.untitled = { files: { 'index.html': legacy.html, 'styles.css': String(legacy.css ?? ''), 'project.json': String(legacy.project ?? '') }, updatedAt: Date.now() };
      }
      for (const [id, p] of Object.entries(parsed)) {
        const old = p.files as unknown as { html?: unknown; css?: unknown; project?: unknown };
        if (typeof old.html === 'string') parsed[id] = { ...p, files: { 'index.html': old.html, 'styles.css': String(old.css ?? ''), 'project.json': String(old.project ?? '') } };
      }
      return parsed;
    } catch {
      return {};
    }
  }

  private write(projects: LocalProjects): void {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(projects));
    this.listeners.forEach((fn) => fn());
  }

  async list(): Promise<ProjectSummary[]> {
    const places = readLibrary().places;
    return Object.entries(this.read())
      .map(([id, p]) => ({ id, updatedAt: p.updatedAt, files: p.files, folderId: places[id]?.folderId ?? null, archivedAt: places[id]?.archivedAt ?? null }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async folders(): Promise<Folder[]> {
    return [...readLibrary().folders].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createFolder(name: string): Promise<Folder> {
    const folder = { id: randomClientId().slice(0, 10), name: name.trim().slice(0, 120) || 'Untitled folder', createdAt: Date.now() };
    updateLibrary((l) => l.folders.push(folder));
    this.listeners.forEach((fn) => fn());
    return folder;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    updateLibrary((l) => (l.folders = l.folders.map((f) => (f.id === id ? { ...f, name: name.trim().slice(0, 120) || f.name } : f))));
    this.listeners.forEach((fn) => fn());
  }

  async deleteFolder(id: string): Promise<void> {
    updateLibrary((l) => {
      l.folders = l.folders.filter((f) => f.id !== id);
      for (const place of Object.values(l.places)) if (place.folderId === id) place.folderId = null;
    });
    this.listeners.forEach((fn) => fn());
  }

  async place(id: string, change: PlaceChange): Promise<void> {
    updateLibrary((l) => {
      const place = l.places[id] ?? { folderId: null, archivedAt: null };
      if (change.folderId !== undefined) place.folderId = change.folderId;
      if (change.archived !== undefined) place.archivedAt = change.archived ? Date.now() : null;
      l.places[id] = place;
    });
    this.listeners.forEach((fn) => fn());
  }

  async deleteProject(id: string): Promise<void> {
    if (!readLibrary().places[id]?.archivedAt) throw new Error('Archive a file before deleting it.');
    this.remove(id);
    updateLibrary((l) => delete l.places[id]);
  }

  async activity(): Promise<Activity> {
    const projects = await this.list();
    return { days: readLibrary().activity, files: projects.filter((p) => !p.archivedAt).length };
  }

  async profile(): Promise<Profile> {
    return readLibrary().profile;
  }

  async updateProfile(profile: { name: string; username: string | null }): Promise<void> {
    if (profile.username && !/^[a-zA-Z0-9_.]{3,30}$/.test(profile.username)) throw new Error('Usernames are 3–30 letters, numbers, dots or underscores.');
    updateLibrary((l) => (l.profile = { name: profile.name.trim().slice(0, 120), username: profile.username || null }));
  }

  async create(title: string, files: ProjectFiles, options: { folderId?: string | null } = {}): Promise<string> {
    const projects = this.read();
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
    let id = base;
    for (let n = 2; projects[id]; n++) id = `${base}-${n}`;
    this.write({ ...projects, [id]: { files, updatedAt: Date.now() } });
    if (options.folderId) await this.place(id, { folderId: options.folderId });
    return id;
  }

  assetBase(): null {
    return null;
  }

  readonly importFigma = null;

  open(id: string): ProjectStorage {
    return {
      id,
      location: 'this browser',
      assetBase: null,
      load: async () => this.read()[id]?.files ?? null,
      save: async (files) => {
        this.write({ ...this.read(), [id]: { files, updatedAt: Date.now() } });
        recordLocalEdit();
      },
      onExternalChange: () => () => {},
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  remove(id: string): void {
    const projects = this.read();
    delete projects[id];
    this.write(projects);
  }
}

// Folders, archive, activity and profile for browser-only storage.
const LIBRARY_KEY = 'plastic:library';

interface LocalLibrary {
  folders: Folder[];
  places: Record<string, { folderId: string | null; archivedAt: number | null }>;
  activity: Record<string, number>;
  profile: { name: string; username: string | null };
}

function readLibrary(): LocalLibrary {
  const blank: LocalLibrary = { folders: [], places: {}, activity: {}, profile: { name: '', username: null } };
  try {
    return { ...blank, ...(JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '{}') as Partial<LocalLibrary>) };
  } catch {
    return blank;
  }
}

function updateLibrary(fn: (library: LocalLibrary) => unknown): void {
  const library = readLibrary();
  fn(library);
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch {
    // storage full or unavailable; the change lasts for this page only
  }
}

/** Local day, "YYYY-MM-DD". */
export function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function recordLocalEdit(): void {
  updateLibrary((l) => (l.activity[dayKey()] = (l.activity[dayKey()] ?? 0) + 1));
}

/**
 * Files made in this browser before signing in. On the cloud workspace, Home offers to move
 * them into the account; each is removed here once it's been copied.
 */
export const browserFiles = {
  list: (): Promise<ProjectSummary[]> => new LocalStorageWorkspace().list(),
  remove: (id: string): void => new LocalStorageWorkspace().remove(id),
};

// --- cloud (useplastic.app) --------------------------------------------------------------------
//
// Built to stay inside Cloudflare's free allowances (see worker/projects.ts): listing and opening
// read one D1 row of file versions; file contents are fetched by version, so the browser caches
// them for good and only changed files ever download again; saves upload only changed files and
// then commit; live-sync announcements go over the editor's own WebSocket.

type Versions = Record<string, string>;

/** Files the home screen's thumbnails need. */
const THUMBNAIL_FILES = ['index.html', 'project.json', 'styles.css', 'tokens.css'];
/** How long a hidden tab keeps its live connection before closing it (reopened on return). */
const HIDDEN_DISCONNECT_MS = 5 * 60_000;
/** Home re-checks the file list at most this often when you come back to the tab. */
const LIST_REFRESH_MS = 30_000;

class CloudWorkspace implements Workspace {
  readonly kind = 'cloud';
  readonly location = 'Your account';
  private readonly listeners = new Set<() => void>();
  /** File text by project/name@version (also cached by the browser, by URL). */
  private readonly texts = new Map<string, string>();

  private endpoint(id: string): string {
    return `/api/projects/${encodeURIComponent(id)}`;
  }

  /** One file at a version: from memory, then the browser cache, then the network. */
  private async text(base: string, name: string, version: string): Promise<string | null> {
    const key = `${base}/${name}@${version}`;
    const known = this.texts.get(key);
    if (known !== undefined) return known;
    const response = await fetch(`${base}/files/${encodeURIComponent(name)}?v=${encodeURIComponent(version)}`);
    if (!response.ok) throw new Error(`Could not load ${name}: ${response.status}`);
    const text = await response.text();
    this.texts.set(key, text);
    return text;
  }

  /** Files of the project served at `base` (its API endpoint). */
  private async files(base: string, versions: Versions, only?: readonly string[]): Promise<ProjectFiles> {
    let selected = only;
    if (only === THUMBNAIL_FILES && versions['project.json']) {
      const metadata = await this.text(base, 'project.json', versions['project.json']);
      const page = readProjectJson(metadata ?? '').thumbnail?.page;
      if (page) selected = [...only, page];
    }
    const names = Object.keys(versions).filter((n) => !selected || selected.includes(n));
    const entries = await Promise.all(names.map(async (n) => [n, await this.text(base, n, versions[n]!)] as const));
    return Object.fromEntries(entries.filter((e): e is readonly [string, string] => e[1] !== null));
  }

  /** Upload the files that differ from `saved`, then commit the full version map. */
  async write(id: string, files: ProjectFiles, saved: { files: ProjectFiles; versions: Versions } | null, options: { client?: string; notify?: boolean | (() => boolean) } = {}): Promise<Versions> {
    const versions: Versions = {};
    const changed = Object.keys(files).filter((n) => !saved || saved.files[n] !== files[n] || !saved.versions[n]);
    for (const name of Object.keys(files)) if (!changed.includes(name)) versions[name] = saved!.versions[name]!;
    // A few uploads at a time; each is a raw body streamed into storage.
    for (let i = 0; i < changed.length; i += 6) {
      await Promise.all(
        changed.slice(i, i + 6).map(async (name) => {
          // Hashed here so the server can stream the body into storage (R2 verifies the hash).
          const bytes = new TextEncoder().encode(files[name]);
          const response = await fetch(`${this.endpoint(id)}/files/${encodeURIComponent(name)}`, {
            method: 'PUT',
            headers: { 'content-type': 'text/plain; charset=utf-8', 'x-plastic-sha256': await sha256(bytes) },
            body: bytes,
          });
          if (!response.ok) throw new Error(`Save failed: ${response.status}`);
          versions[name] = ((await response.json()) as { version: string }).version;
          this.texts.set(`${this.endpoint(id)}/${name}@${versions[name]}`, files[name]!);
        }),
      );
    }
    const title = titleOf(files);
    const response = await fetch(`${this.endpoint(id)}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.client ? { 'x-plastic-client': options.client } : {}) },
      body: JSON.stringify({ files: versions, title, notify: typeof options.notify === 'function' ? options.notify() : options.notify ?? true, base: saved?.versions ?? {} }),
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    return versions;
  }

  async list(): Promise<ProjectSummary[]> {
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error(`Could not list files: ${response.status}`);
    const data = (await response.json()) as { projects?: { id: string; updatedAt: number; files: Versions; folderId?: string | null; archivedAt?: number | null }[] };
    const projects = await Promise.all(
      (data.projects ?? []).map(async (p) => ({
        id: p.id,
        updatedAt: Number(p.updatedAt) || 0,
        files: await this.files(this.endpoint(p.id), p.files, THUMBNAIL_FILES),
        folderId: p.folderId ?? null,
        archivedAt: p.archivedAt ?? null,
      })),
    );
    return projects.filter((p) => Object.keys(p.files).some(isPageFile));
  }

  private async call(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await fetch(url, { ...init, headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers });
    const data = response.status === 204 ? {} : ((await response.json().catch(() => ({}))) as Record<string, unknown>);
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`);
    this.listeners.forEach((fn) => fn());
    return data;
  }

  async folders(): Promise<Folder[]> {
    const response = await fetch('/api/folders');
    if (!response.ok) throw new Error(`Could not list folders: ${response.status}`);
    return ((await response.json()) as { folders: Folder[] }).folders;
  }

  async createFolder(name: string): Promise<Folder> {
    return (await this.call('/api/folders', { method: 'POST', body: JSON.stringify({ name }) })).folder as Folder;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.call(`/api/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  }

  async deleteFolder(id: string): Promise<void> {
    await this.call(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async place(id: string, change: PlaceChange): Promise<void> {
    await this.call(`${this.endpoint(id)}/place`, { method: 'PATCH', body: JSON.stringify(change) });
  }

  async deleteProject(id: string): Promise<void> {
    await this.call(this.endpoint(id), { method: 'DELETE' });
  }

  async activity(): Promise<Activity> {
    const response = await fetch('/api/activity');
    if (!response.ok) throw new Error(`Could not load activity: ${response.status}`);
    return (await response.json()) as Activity;
  }

  async profile(): Promise<Profile> {
    const { data } = await authClient.getSession();
    const user = data?.user as { name?: string; email?: string; username?: string | null; displayUsername?: string | null; admin?: boolean; image?: string | null } | undefined;
    return { name: user?.name ?? '', username: user?.displayUsername ?? user?.username ?? null, email: user?.email, admin: user?.admin === true, image: user?.image ?? null };
  }

  async updateProfile(profile: { name: string; username: string | null }): Promise<void> {
    // Usernames are unique case-insensitively; displayUsername keeps the casing as typed.
    const result = await authClient.updateUser({ name: profile.name.trim(), ...(profile.username ? { username: profile.username, displayUsername: profile.username } : {}) });
    if (result.error) throw new Error(result.error.message ?? 'Couldn’t save your profile.');
  }

  async create(title: string, files: ProjectFiles, options: { assetsFrom?: string; folderId?: string | null } = {}): Promise<string> {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, assetsFrom: options.assetsFrom, folderId: options.folderId ?? undefined }),
    });
    if (!response.ok) throw new Error(`Could not create file: ${response.status}`);
    const { id } = (await response.json()) as { id: string };
    await this.write(id, files, null, { notify: false });
    this.listeners.forEach((fn) => fn());
    return id;
  }

  assetBase(id: string): string {
    return `${this.endpoint(id)}/`;
  }

  /**
   * Figma import in the cloud: the file is converted here in the browser (OpenPencil parses it in
   * a Web Worker), then saved to the account like any new file, followed by its images.
   */
  readonly importFigma = async (file: File, onProgress?: (message: string) => void): Promise<FigmaImportResult> => {
    onProgress?.('Reading the Figma file…');
    const { convertFigFile, titleFromFileName } = await import('../figma/convert.ts');
    const bytes = new Uint8Array(await file.arrayBuffer());
    onProgress?.('Converting pages, auto layout, text and images…');
    // Let the progress message paint before the conversion takes the main thread.
    await new Promise((r) => setTimeout(r, 30));
    const conversion = await convertFigFile(bytes, titleFromFileName(file.name));
    onProgress?.('Saving to your account…');
    const id = await this.create(conversion.title, conversion.files);
    const assets = Object.entries(conversion.assets);
    let done = 0;
    let failed = 0;
    const upload = async ([path, data]: [string, Uint8Array]) => {
      const url = `${this.assetBase(id)}${path.split('/').map(encodeURIComponent).join('/')}`;
      // Retry briefly; one image that won't upload shouldn't lose the whole import.
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(url, { method: 'PUT', body: data as BodyInit }).catch(() => null);
        if (response?.ok) break;
        if (attempt === 2) failed++;
        else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      onProgress?.(`Uploading images… ${++done} of ${assets.length}`);
    };
    for (let i = 0; i < assets.length; i += 6) await Promise.all(assets.slice(i, i + 6).map(upload));
    const report = failed
      ? { ...conversion.report, warnings: [...conversion.report.warnings, `${failed} of ${assets.length} images couldn’t be uploaded; they appear empty. Try importing again.`] }
      : conversion.report;
    return { id, report };
  };

  open(id: string): ProjectStorage {
    const endpoint = this.endpoint(id);
    return this.storage({
      id,
      endpoint,
      assetBase: this.assetBase(id),
      async shareLink() {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error('Could not load the file link.');
        const data = await response.json() as { previewId?: string };
        const url = new URL(`/file/${encodeURIComponent(id)}`, location.origin);
        if (data.previewId) url.searchParams.set('preview', data.previewId);
        return url.href;
      },
    });
  }

  async openShared(id: string, previewId: string): Promise<ProjectStorage | null> {
    if (!/^[a-f0-9]{32}$/.test(previewId)) return null;
    const endpoint = `/api/shared/${previewId}`;
    const response = await fetch(endpoint);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Could not open the shared file: ${response.status}`);
    const data = (await response.json()) as { id?: string; owned?: boolean; owner?: { name?: string } };
    if (data.id !== id) return null;
    if (data.owned) return this.open(id);
    const link = new URL(`/file/${encodeURIComponent(id)}`, location.origin);
    link.searchParams.set('preview', previewId);
    return this.storage({ id, endpoint, assetBase: `${endpoint}/`, readOnly: true, ownerName: data.owner?.name || undefined, shareLink: async () => link.href });
  }

  /**
   * A project served at `endpoint`: GET it for { files: versions }, …/files/<name>?v= for a file,
   * …/live for its room. Read-only storage never writes; the room still delivers the owner's saves.
   */
  private storage(options: { id: string; endpoint: string; assetBase: string; readOnly?: boolean; ownerName?: string; shareLink(): Promise<string> }): ProjectStorage {
    const { id, endpoint, readOnly = false } = options;
    /** What the server has (text and versions), so saves send only what changed. */
    let saved: { files: ProjectFiles; versions: Versions } | null = null;
    /** This editor, so live sync doesn't echo our own saves back to us. */
    const client = randomClientId();
    let socket: WebSocket | null = null;
    const workspace = this;
    const presenceListeners = new Set<(message: unknown) => void>();
    const presence: PresenceLink = {
      send(message) {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
      subscribe(listener) {
        presenceListeners.add(listener);
        return () => presenceListeners.delete(listener);
      },
    };
    const emit = (message: unknown) => presenceListeners.forEach((fn) => fn(message));

    const fetchVersions = async (): Promise<Versions | null> => {
      const response = await fetch(endpoint);
      if (!response.ok) return null;
      const data = (await response.json()) as { files?: Versions | null };
      return data.files ?? null;
    };

    return {
      id,
      location: readOnly ? (options.ownerName ? `${options.ownerName}’s file` : 'Shared with you') : this.location,
      assetBase: options.assetBase,
      readOnly,
      ownerName: options.ownerName,
      presence,
      shareLink: options.shareLink,
      // Cloud saves wait for a pause in editing: fewer, larger saves use far fewer requests.
      saveDelayMs: 1500,
      async load() {
        const versions = await fetchVersions();
        if (!versions) return null;
        const files = await workspace.files(endpoint, versions);
        saved = { files, versions };
        return files;
      },
      async save(files) {
        if (readOnly) throw new Error('This file is view-only.');
        let versions: Versions;
        try { versions = await workspace.write(id, files, saved, { client, notify: () => socket?.readyState !== WebSocket.OPEN }); }
        catch (error) {
          if (error instanceof Error && error.message === 'Save failed: 409') {
            const latest = await fetchVersions();
            if (latest) {
              const incoming = await workspace.files(endpoint, latest);
              saved = { files: incoming, versions: latest };
              throw new StorageConflictError(incoming);
            }
          }
          throw error;
        }
        saved = { files, versions };
        // Tell the other editors over our own connection (1/20 the cost of a server call).
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'changed', files: versions }));
      },
      /** Edits saved elsewhere (another tab or device) arrive over a WebSocket to the file's room. */
      onExternalChange(listener) {
        let stopped = false;
        let attempts = 0;
        let caughtUp = true;
        let retry: ReturnType<typeof setTimeout> | undefined;
        let idle: ReturnType<typeof setTimeout> | undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let queue = Promise.resolve();

        const apply = async (versions: Versions | null) => {
          if (!versions || !Object.keys(versions).some(isPageFile)) return;
          const current = saved?.versions ?? {};
          const changed = Object.keys(versions).filter((n) => current[n] !== versions[n]);
          const removed = Object.keys(current).filter((n) => !(n in versions));
          if (!changed.length && !removed.length) return;
          const fresh = await workspace.files(endpoint, versions, changed);
          const files: Record<string, string> = {};
          for (const name of Object.keys(versions)) {
            const text = fresh[name] ?? saved?.files[name];
            if (text !== undefined) files[name] = text;
          }
          saved = { files, versions };
          listener(files);
        };

        const connect = () => {
          if (stopped || socket) return;
          const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${endpoint}/live?client=${client}`);
          socket = ws;
          ws.onopen = () => {
            // After a disconnect, catch up on anything saved meanwhile (one small request).
            if (!caughtUp) queue = queue.then(async () => apply(await fetchVersions())).catch((error) => { caughtUp = false; console.error(error); });
            caughtUp = true;
            attempts = 0;
            heartbeat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 45_000);
          };
          ws.onmessage = (event) => {
            if (event.data === 'pong') return;
            let message: { type?: string; files?: Versions; t?: unknown };
            try {
              message = JSON.parse(String(event.data));
            } catch {
              return;
            }
            // Comments live beside the files; the comments store fetches them again.
            if (message?.type === 'comments') return void window.dispatchEvent(new Event('plastic:comments'));
            if (message && typeof message.t === 'string') return emit(message);
            if (message?.type !== 'changed' || !message.files) return;
            const versions = Object.fromEntries(Object.entries(message.files).filter(([n, v]) => PROJECT_FILE_NAME.test(n) && typeof v === 'string'));
            queue = queue.then(() => apply(versions)).catch((error) => { caughtUp = false; console.error(error); });
          };
          ws.onclose = () => {
            clearInterval(heartbeat);
            if (socket !== ws) return;
            socket = null;
            emit({ t: 'closed' });
            caughtUp = false;
            if (stopped || document.visibilityState === 'hidden') return;
            retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts++));
          };
        };

        // A tab in the background for a while lets its connection go; it catches up on return.
        const onVisibility = () => {
          clearTimeout(idle);
          if (document.visibilityState === 'hidden') {
            idle = setTimeout(() => socket?.close(), HIDDEN_DISCONNECT_MS);
          } else if (!socket) {
            clearTimeout(retry);
            connect();
          }
        };
        document.addEventListener('visibilitychange', onVisibility);
        connect();
        return () => {
          stopped = true;
          clearTimeout(retry);
          clearTimeout(idle);
          clearInterval(heartbeat);
          document.removeEventListener('visibilitychange', onVisibility);
          socket?.close();
          socket = null;
        };
      },
    };
  }

  /** Local creates, and coming back to the tab (throttled: files may have changed elsewhere). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < LIST_REFRESH_MS) return;
      last = Date.now();
      listener();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      this.listeners.delete(listener);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }
}

/** The document title (from the first page), recorded for listings. */
function titleOf(files: ProjectFiles): string | undefined {
  const html = files['index.html'] ?? Object.entries(files).find(([n]) => isPageFile(n))?.[1];
  const match = html ? /<title>([^<]*)<\/title>/i.exec(html) : null;
  return match ? match[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() : undefined;
}

function randomClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

let workspace: Promise<Workspace> | null = null;

export function connectWorkspace(): Promise<Workspace> {
  workspace ??= (async () => {
    if (import.meta.env.DEV) {
      try {
        const response = await fetch('/__plastic/workspace');
        if (response.ok) {
          const data = (await response.json()) as { location?: unknown };
          return new DevServerWorkspace(typeof data.location === 'string' ? data.location : 'workspace');
        }
      } catch {
        // fall through
      }
    }
    if ((await detectBackend()).auth) return new CloudWorkspace();
    return new LocalStorageWorkspace();
  })();
  return workspace;
}
