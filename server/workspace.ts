/**
 * Dev-server bridge between the editor and design files on disk.
 *
 * A workspace is a plain folder of projects: workspace/<id>/index.html, styles.css,
 * project.json. Anything else that edits those files — a text editor, git, a coding agent —
 * is picked up by the watcher and pushed to the open editor and the home screen. Tauri will
 * replace this with native file access later; the HTTP shape is intentionally tiny so that
 * swap stays local.
 *
 *   GET  /__plastic/workspace          → { location, projects: [{ id, updatedAt, files }] }
 *   POST /__plastic/workspace          { title, files } → { id }
 *   GET  /__plastic/project/<id>       → { location, files | null }
 *   PUT  /__plastic/project/<id>       { html, css, project }
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

const FILES = { html: 'index.html', css: 'styles.css', project: 'project.json' } as const;
type FileKey = keyof typeof FILES;
type ProjectFiles = Record<FileKey, string>;

export const PROJECT_CHANGED_EVENT = 'plastic:project-changed';
export const WORKSPACE_CHANGED_EVENT = 'plastic:workspace-changed';

/** Project ids are folder names. Restricting them keeps every path inside the workspace. */
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'untitled';
}

export function plasticWorkspace(): Plugin {
  const root = path.resolve(process.env.PLASTIC_WORKSPACE ?? 'workspace');
  const location = path.relative(process.cwd(), root) || '.';
  /** Last content written or announced per project, so our own saves are not echoed back. */
  const known = new Map<string, ProjectFiles>();

  const dirOf = (id: string) => path.join(root, id);

  async function readFiles(id: string): Promise<ProjectFiles | null> {
    const entries = await Promise.all(
      (Object.keys(FILES) as FileKey[]).map(async (key) => [key, await fsp.readFile(path.join(dirOf(id), FILES[key]), 'utf8').catch(() => '')] as const),
    );
    const files = Object.fromEntries(entries) as ProjectFiles;
    return files.html ? files : null;
  }

  async function updatedAt(id: string): Promise<number> {
    const times = await Promise.all(
      Object.values(FILES).map((f) => fsp.stat(path.join(dirOf(id), f)).then((s) => s.mtimeMs, () => 0)),
    );
    return Math.max(...times);
  }

  async function writeFiles(id: string, files: ProjectFiles): Promise<void> {
    await fsp.mkdir(dirOf(id), { recursive: true });
    known.set(id, files);
    for (const key of Object.keys(FILES) as FileKey[]) {
      const target = path.join(dirOf(id), FILES[key]);
      const current = await fsp.readFile(target, 'utf8').catch(() => null);
      if (current !== files[key]) await fsp.writeFile(target, files[key], 'utf8');
    }
  }

  async function listProjects() {
    const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
    const projects = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && PROJECT_ID.test(e.name))
        .map(async (e) => {
          const files = await readFiles(e.name);
          return files ? { id: e.name, updatedAt: await updatedAt(e.name), files } : null;
        }),
    );
    return projects.filter((p) => p !== null).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function uniqueId(title: string): Promise<string> {
    const base = slugify(title);
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const exists = await fsp.stat(dirOf(id)).then(() => true, () => false);
      if (!exists) return id;
    }
  }

  function watch(server: ViteDevServer): void {
    fs.mkdirSync(root, { recursive: true });
    const timers = new Map<string, NodeJS.Timeout>();
    let workspaceTimer: NodeJS.Timeout | undefined;
    const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      const id = filename?.toString().split(path.sep)[0];
      clearTimeout(workspaceTimer);
      workspaceTimer = setTimeout(() => server.ws.send({ type: 'custom', event: WORKSPACE_CHANGED_EVENT, data: {} }), 150);
      if (!id || !PROJECT_ID.test(id)) return;
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(async () => {
          const files = await readFiles(id);
          const prev = known.get(id);
          if (!files || (prev && sameFiles(files, prev))) return;
          known.set(id, files);
          server.ws.send({ type: 'custom', event: PROJECT_CHANGED_EVENT, data: { id, files } });
        }, 120),
      );
    });
    server.httpServer?.on('close', () => watcher.close());
  }

  const json = (res: ServerResponse, status: number, body?: unknown): void => {
    res.statusCode = status;
    if (body !== undefined) res.setHeader('content-type', 'application/json');
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === '/__plastic/workspace') {
      if (req.method === 'GET') return json(res, 200, { location, projects: await listProjects() });
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { title?: unknown; files?: unknown };
        if (!isFiles(body.files)) return json(res, 400, { error: 'Expected files { html, css, project }' });
        const id = await uniqueId(typeof body.title === 'string' ? body.title : 'untitled');
        await writeFiles(id, body.files);
        return json(res, 201, { id });
      }
      return json(res, 405);
    }
    const match = /^\/__plastic\/project\/([^/]+)$/.exec(url.pathname);
    const id = match ? decodeURIComponent(match[1]!) : '';
    if (!match || !PROJECT_ID.test(id)) return json(res, 404);
    if (req.method === 'GET') {
      const files = await readFiles(id);
      if (files) known.set(id, files);
      return json(res, 200, { location: path.join(location, id), files });
    }
    if (req.method === 'PUT') {
      const files = JSON.parse(await readBody(req)) as unknown;
      if (!isFiles(files)) return json(res, 400, { error: 'Expected { html, css, project } strings' });
      await writeFiles(id, files);
      return json(res, 204);
    }
    return json(res, 405);
  }

  return {
    name: 'plastic-workspace',
    apply: 'serve',
    configureServer(server) {
      watch(server);
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/__plastic/')) return next();
        handle(req, res).catch((error: unknown) => json(res, 500, { error: String(error) }));
      });
    },
  };
}

function isFiles(value: unknown): value is ProjectFiles {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.html === 'string' && typeof v.css === 'string' && typeof v.project === 'string';
}

function sameFiles(a: ProjectFiles, b: ProjectFiles): boolean {
  return a.html === b.html && a.css === b.css && a.project === b.project;
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
