/**
 * Where projects live. In development the dev server exposes a folder of project folders on
 * disk; on useplastic.app they're in the signed-in user's cloud storage (R2 via the Worker);
 * anywhere else (a static build) the browser's localStorage is used. Tauri will add a native
 * implementation behind the same interfaces.
 */
import { detectBackend } from '../auth/client.ts';
import { PROJECT_FILE_NAME, isPageFile, type ProjectFiles } from './index.ts';

export interface ProjectSummary {
  readonly id: string;
  /** Last modification time (ms since epoch). */
  readonly updatedAt: number;
  readonly files: ProjectFiles;
}

export interface ProjectStorage {
  readonly id: string;
  /** Human-readable location, e.g. "workspace/demo". */
  readonly location: string;
  /** URL the project folder is served from (for assets/…), or null. */
  readonly assetBase: string | null;
  /** How long autosave waits after the last edit (cloud storage waits longer to save requests). */
  readonly saveDelayMs?: number;
  load(): Promise<ProjectFiles | null>;
  save(files: ProjectFiles): Promise<void>;
  /** Called when the files change outside the editor (text editor, git, coding agent). */
  onExternalChange(listener: (files: ProjectFiles) => void): () => void;
}

export interface Workspace {
  /** disk: a folder via the dev server; cloud: the user's account; browser: localStorage. */
  readonly kind: 'disk' | 'cloud' | 'browser';
  /** Human-readable location of the workspace, e.g. "workspace". */
  readonly location: string;
  /** Projects, most recently edited first. */
  list(): Promise<ProjectSummary[]>;
  /** Create a project; returns its id. `assetsFrom` copies another project's assets/. */
  create(title: string, files: ProjectFiles, options?: { assetsFrom?: string }): Promise<string>;
  open(id: string): ProjectStorage;
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
  readonly report: {
    readonly title: string;
    readonly pages: readonly { readonly name: string; readonly file: string; readonly artboards: number }[];
    readonly layers: number;
    readonly fonts: readonly FigmaFontUse[];
    readonly images: number;
    readonly tokens: number;
    readonly warnings: readonly string[];
  };
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
      const v = p as { id?: unknown; updatedAt?: unknown; files?: unknown };
      return typeof v.id === 'string' && isFiles(v.files) ? [{ id: v.id, updatedAt: Number(v.updatedAt) || 0, files: pickFiles(v.files) }] : [];
    });
  }

  async create(title: string, files: ProjectFiles, options: { assetsFrom?: string } = {}): Promise<string> {
    const response = await fetch('/__plastic/workspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, files, assetsFrom: options.assetsFrom }),
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
    return {
      id,
      location: `${this.location}/${id}`,
      assetBase: this.assetBase(id),
      async load() {
        const response = await fetch(endpoint);
        if (!response.ok) return null;
        const data = (await response.json()) as { files?: unknown };
        return isFiles(data.files) ? pickFiles(data.files) : null;
      },
      async save(files) {
        const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(files) });
        if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      },
      onExternalChange(listener) {
        return onHot(PROJECT_CHANGED_EVENT, (data) => {
          const v = data as { id?: unknown; files?: unknown };
          if (v.id === id && isFiles(v.files)) listener(pickFiles(v.files));
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
    return Object.entries(this.read())
      .map(([id, p]) => ({ id, updatedAt: p.updatedAt, files: p.files }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async create(title: string, files: ProjectFiles): Promise<string> {
    const projects = this.read();
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
    let id = base;
    for (let n = 2; projects[id]; n++) id = `${base}-${n}`;
    this.write({ ...projects, [id]: { files, updatedAt: Date.now() } });
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
      save: async (files) => this.write({ ...this.read(), [id]: { files, updatedAt: Date.now() } }),
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
  private async text(id: string, name: string, version: string): Promise<string | null> {
    const key = `${id}/${name}@${version}`;
    const known = this.texts.get(key);
    if (known !== undefined) return known;
    const response = await fetch(`${this.endpoint(id)}/files/${encodeURIComponent(name)}?v=${encodeURIComponent(version)}`);
    if (!response.ok) return null;
    const text = await response.text();
    this.texts.set(key, text);
    return text;
  }

  private async files(id: string, versions: Versions, only?: readonly string[]): Promise<ProjectFiles> {
    const names = Object.keys(versions).filter((n) => !only || only.includes(n));
    const entries = await Promise.all(names.map(async (n) => [n, await this.text(id, n, versions[n]!)] as const));
    return Object.fromEntries(entries.filter((e): e is readonly [string, string] => e[1] !== null));
  }

  /** Upload the files that differ from `saved`, then commit the full version map. */
  async write(id: string, files: ProjectFiles, saved: { files: ProjectFiles; versions: Versions } | null, options: { client?: string; notify?: boolean } = {}): Promise<Versions> {
    const versions: Versions = {};
    const changed = Object.keys(files).filter((n) => !saved || saved.files[n] !== files[n] || !saved.versions[n]);
    for (const name of Object.keys(files)) if (!changed.includes(name)) versions[name] = saved!.versions[name]!;
    // A few uploads at a time; each is a raw body streamed into storage.
    for (let i = 0; i < changed.length; i += 6) {
      await Promise.all(
        changed.slice(i, i + 6).map(async (name) => {
          const response = await fetch(`${this.endpoint(id)}/files/${encodeURIComponent(name)}`, {
            method: 'PUT',
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            body: files[name],
          });
          if (!response.ok) throw new Error(`Save failed: ${response.status}`);
          versions[name] = ((await response.json()) as { version: string }).version;
          this.texts.set(`${id}/${name}@${versions[name]}`, files[name]!);
        }),
      );
    }
    const title = titleOf(files);
    const response = await fetch(`${this.endpoint(id)}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.client ? { 'x-plastic-client': options.client } : {}) },
      body: JSON.stringify({ files: versions, title, notify: options.notify ?? true }),
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    return versions;
  }

  async list(): Promise<ProjectSummary[]> {
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error(`Could not list files: ${response.status}`);
    const data = (await response.json()) as { projects?: { id: string; updatedAt: number; files: Versions }[] };
    const projects = await Promise.all(
      (data.projects ?? []).map(async (p) => ({ id: p.id, updatedAt: Number(p.updatedAt) || 0, files: await this.files(p.id, p.files, THUMBNAIL_FILES) })),
    );
    return projects.filter((p) => Object.keys(p.files).some(isPageFile));
  }

  async create(title: string, files: ProjectFiles, options: { assetsFrom?: string } = {}): Promise<string> {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, assetsFrom: options.assetsFrom }),
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
    /** What the server has (text and versions), so saves send only what changed. */
    let saved: { files: ProjectFiles; versions: Versions } | null = null;
    /** This editor, so live sync doesn't echo our own saves back to us. */
    const client = randomClientId();
    let socket: WebSocket | null = null;
    const workspace = this;

    const fetchVersions = async (): Promise<Versions | null> => {
      const response = await fetch(endpoint);
      if (!response.ok) return null;
      return ((await response.json()) as { files?: Versions | null }).files ?? null;
    };

    return {
      id,
      location: this.location,
      assetBase: this.assetBase(id),
      // Cloud saves wait for a pause in editing: fewer, larger saves use far fewer requests.
      saveDelayMs: 1500,
      async load() {
        const versions = await fetchVersions();
        if (!versions) return null;
        const files = await workspace.files(id, versions);
        saved = { files, versions };
        return files;
      },
      async save(files) {
        const live = socket?.readyState === WebSocket.OPEN;
        const versions = await workspace.write(id, files, saved, { client, notify: !live });
        saved = { files, versions };
        // Tell the other editors over our own connection (1/20 the cost of a server call).
        if (live) socket!.send(JSON.stringify({ type: 'changed', files: versions }));
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
          const fresh = await workspace.files(id, versions, changed);
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
            if (!caughtUp) queue = queue.then(async () => apply(await fetchVersions()));
            caughtUp = true;
            attempts = 0;
            heartbeat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 45_000);
          };
          ws.onmessage = (event) => {
            if (event.data === 'pong') return;
            let message: { type?: string; files?: Versions };
            try {
              message = JSON.parse(String(event.data));
            } catch {
              return;
            }
            if (message.type !== 'changed' || !message.files) return;
            const versions = Object.fromEntries(Object.entries(message.files).filter(([n, v]) => PROJECT_FILE_NAME.test(n) && typeof v === 'string'));
            queue = queue.then(() => apply(versions));
          };
          ws.onclose = () => {
            clearInterval(heartbeat);
            if (socket === ws) socket = null;
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
