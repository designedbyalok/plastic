/**
 * Where projects live. In development the dev server exposes a folder of project folders on
 * disk; on useplastic.app they're in the signed-in user's cloud storage (R2 via the Worker);
 * anywhere else (a static build) the browser's localStorage is used. Tauri will add a native
 * implementation behind the same interfaces.
 */
import { detectBackend } from '../auth/client';
import { PROJECT_FILE_NAME, isPageFile, type ProjectFiles } from './index';

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
  readonly importFigma: ((file: File) => Promise<FigmaImportResult>) | null;
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

class CloudWorkspace implements Workspace {
  readonly kind = 'cloud';
  readonly location = 'Your account';
  private readonly listeners = new Set<() => void>();

  async list(): Promise<ProjectSummary[]> {
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error(`Could not list files: ${response.status}`);
    const data = (await response.json()) as { projects?: unknown[] };
    return (data.projects ?? []).flatMap((p) => {
      const v = p as { id?: unknown; updatedAt?: unknown; files?: unknown };
      return typeof v.id === 'string' && isFiles(v.files) ? [{ id: v.id, updatedAt: Number(v.updatedAt) || 0, files: pickFiles(v.files) }] : [];
    });
  }

  async create(title: string, files: ProjectFiles, options: { assetsFrom?: string } = {}): Promise<string> {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, files, assetsFrom: options.assetsFrom }),
    });
    if (!response.ok) throw new Error(`Could not create file: ${response.status}`);
    this.listeners.forEach((fn) => fn());
    return ((await response.json()) as { id: string }).id;
  }

  assetBase(id: string): string {
    return `/api/projects/${encodeURIComponent(id)}/`;
  }

  // Figma import in the cloud converts on Cloudflare (next step); until then it's local only.
  readonly importFigma = null;

  open(id: string): ProjectStorage {
    const endpoint = `/api/projects/${encodeURIComponent(id)}`;
    /** What the server has, so saves send only the files that changed. */
    let saved: ProjectFiles | null = null;
    return {
      id,
      location: this.location,
      assetBase: this.assetBase(id),
      async load() {
        const response = await fetch(endpoint);
        if (!response.ok) return null;
        const data = (await response.json()) as { files?: unknown };
        saved = isFiles(data.files) ? pickFiles(data.files) : null;
        return saved;
      },
      async save(files) {
        const changed = Object.fromEntries(Object.entries(files).filter(([name, text]) => saved?.[name] !== text));
        const response = await fetch(endpoint, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ files: changed, names: Object.keys(files) }),
        });
        if (!response.ok) throw new Error(`Save failed: ${response.status}`);
        saved = files;
      },
      // Live updates from other tabs and agents come with realtime sync (Durable Objects).
      onExternalChange: () => () => {},
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
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
