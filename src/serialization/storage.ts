/**
 * Where project files live. The dev server exposes a folder on disk; when it is not available
 * (a static build) the browser's localStorage is used. Tauri will add a native implementation.
 */
import type { ProjectFiles } from './index';

export interface ProjectStorage {
  /** Human-readable location, e.g. "workspace/demo". */
  readonly location: string;
  load(): Promise<ProjectFiles | null>;
  save(files: ProjectFiles): Promise<void>;
  /** Called when files change outside the editor (text editor, git, coding agent). */
  onExternalChange(listener: (files: ProjectFiles) => void): () => void;
}

const ENDPOINT = '/__plastic/project';
const FILES_CHANGED_EVENT = 'plastic:files-changed';

function isFiles(value: unknown): value is ProjectFiles {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.html === 'string' && typeof v.css === 'string' && typeof v.project === 'string';
}

class DevServerStorage implements ProjectStorage {
  constructor(public readonly location: string, private readonly initial: ProjectFiles | null) {}

  async load(): Promise<ProjectFiles | null> {
    return this.initial;
  }

  async save(files: ProjectFiles): Promise<void> {
    const response = await fetch(ENDPOINT, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(files) });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
  }

  onExternalChange(listener: (files: ProjectFiles) => void): () => void {
    const hot = import.meta.hot;
    if (!hot) return () => {};
    const handler = (data: unknown) => {
      if (isFiles(data)) listener({ html: data.html, css: data.css, project: data.project });
    };
    hot.on(FILES_CHANGED_EVENT, handler);
    return () => hot.off(FILES_CHANGED_EVENT, handler);
  }
}

const LOCAL_KEY = 'plastic:project';

class LocalStorageStorage implements ProjectStorage {
  readonly location = 'this browser';

  async load(): Promise<ProjectFiles | null> {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return isFiles(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(files: ProjectFiles): Promise<void> {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(files));
  }

  onExternalChange(): () => void {
    return () => {};
  }
}

export async function connectStorage(): Promise<ProjectStorage> {
  if (import.meta.env.DEV) {
    try {
      const response = await fetch(ENDPOINT);
      if (response.ok) {
        const data = (await response.json()) as { files: unknown; location?: unknown };
        const location = typeof data.location === 'string' ? data.location : 'workspace';
        const files = isFiles(data.files) ? { html: data.files.html, css: data.files.css, project: data.files.project } : null;
        return new DevServerStorage(location, files);
      }
    } catch {
      // fall through to browser storage
    }
  }
  return new LocalStorageStorage();
}
