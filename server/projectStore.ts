/**
 * Projects on disk: workspace/<id>/ holds one .html per page, styles.css, tokens.css and
 * project.json. Shared by the dev server (editor saves) and the MCP server (agent edits).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Project files: one .html per page, .css files and project.json — no folders. */
export const PROJECT_FILE_NAME = /^[a-z0-9][a-z0-9_.-]*\.(html|css|json)$/i;

/** Project ids are folder names. Restricting them keeps every path inside the workspace. */
export const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Binary files a project may reference, in its assets/ folder (images from imports). */
export const ASSET_NAME = /^[a-z0-9][a-z0-9_.-]*\.(png|jpe?g|gif|webp|avif|svg)$/i;

export const ASSET_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
};

export type ProjectFiles = Record<string, string>;

export interface ProjectSummary {
  readonly id: string;
  readonly updatedAt: number;
  readonly files: ProjectFiles;
}

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'untitled';
}

export function isProjectFiles(value: unknown): value is ProjectFiles {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.some(([name]) => name.endsWith('.html')) && entries.every(([name, text]) => PROJECT_FILE_NAME.test(name) && typeof text === 'string');
}

export function sameProjectFiles(a: ProjectFiles, b: ProjectFiles): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

export class ProjectStore {
  constructor(readonly root: string) {}

  dirOf(id: string): string {
    if (!PROJECT_ID.test(id)) throw new Error(`Invalid file id "${id}"`);
    return path.join(this.root, id);
  }

  async read(id: string): Promise<ProjectFiles | null> {
    const dir = this.dirOf(id);
    const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => PROJECT_FILE_NAME.test(n));
    if (!names.some((n) => n.endsWith('.html'))) return null;
    const files: ProjectFiles = {};
    for (const name of names.sort()) files[name] = await fsp.readFile(path.join(dir, name), 'utf8').catch(() => '');
    return files;
  }

  async updatedAt(id: string): Promise<number> {
    const dir = this.dirOf(id);
    const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => PROJECT_FILE_NAME.test(n));
    const times = await Promise.all(names.map((f) => fsp.stat(path.join(dir, f)).then((s) => s.mtimeMs, () => 0)));
    return Math.max(0, ...times);
  }

  /** Write a project's files; pages that no longer exist (deleted .html files) are removed. */
  async write(id: string, files: ProjectFiles): Promise<void> {
    const dir = this.dirOf(id);
    await fsp.mkdir(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      if (!PROJECT_FILE_NAME.test(name)) continue;
      const target = path.join(dir, name);
      const current = await fsp.readFile(target, 'utf8').catch(() => null);
      if (current !== text) await fsp.writeFile(target, text, 'utf8');
    }
    for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
      if (name.endsWith('.html') && PROJECT_FILE_NAME.test(name) && !(name in files)) await fsp.rm(path.join(dir, name));
    }
  }

  /** Write binary files under assets/ (paths like "assets/abc.png"). */
  async writeAssets(id: string, assets: Record<string, Uint8Array>): Promise<void> {
    const dir = path.join(this.dirOf(id), 'assets');
    for (const [file, bytes] of Object.entries(assets)) {
      const name = file.replace(/^assets\//, '');
      if (!ASSET_NAME.test(name)) continue;
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, name), bytes);
    }
  }

  /** Copy another project's assets/ folder (duplicating a file keeps its images). */
  async copyAssets(from: string, to: string): Promise<void> {
    const source = path.join(this.dirOf(from), 'assets');
    const names = (await fsp.readdir(source).catch(() => [] as string[])).filter((n) => ASSET_NAME.test(n));
    if (!names.length) return;
    const target = path.join(this.dirOf(to), 'assets');
    await fsp.mkdir(target, { recursive: true });
    for (const name of names) await fsp.copyFile(path.join(source, name), path.join(target, name));
  }

  async readAsset(id: string, name: string): Promise<Buffer | null> {
    if (!ASSET_NAME.test(name)) return null;
    return fsp.readFile(path.join(this.dirOf(id), 'assets', name)).catch(() => null);
  }

  async list(): Promise<ProjectSummary[]> {
    const entries = await fsp.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const projects = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && PROJECT_ID.test(e.name))
        .map(async (e) => {
          const files = await this.read(e.name);
          return files ? { id: e.name, updatedAt: await this.updatedAt(e.name), files } : null;
        }),
    );
    return projects.filter((p): p is ProjectSummary => p !== null).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async uniqueId(title: string): Promise<string> {
    const base = slugify(title);
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const exists = await fsp.stat(path.join(this.root, id)).then(() => true, () => false);
      if (!exists) return id;
    }
  }
}
