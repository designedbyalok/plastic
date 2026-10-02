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
 *   POST /__plastic/workspace          { title, files, assetsFrom? } → { id }
 *   GET  /__plastic/project/<id>       → { location, files | null }
 *   PUT  /__plastic/project/<id>       { "index.html": "…", "styles.css": "…", … }
 *   GET  /__plastic/files/<id>/assets/<name>   a project's images (artboards use it as <base>)
 *   POST /__plastic/import/figma?name=<file.fig>  raw .fig bytes → { id, report }
 *   GET  /__plastic/library            folders, archive, activity and profile (server/library.ts)
 *   POST /__plastic/library            { op: "createFolder" | "renameFolder" | "deleteFolder" | "place" | "profile", … }
 *   DELETE /__plastic/project/<id>     permanently delete an archived file
 *   POST /mcp                          MCP (Streamable HTTP) for agents — see server/mcp
 *   GET  /__plastic/agents             how to connect agents (command, URL, CLI status)
 *   POST /__plastic/agents/install     { agent: "claude" | "codex" } — runs the agent's CLI
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { importFigma } from './figma/import.ts';
import { LibraryStore } from './library.ts';
import { ASSET_TYPES, PROJECT_ID, ProjectStore, ProjectConflictError, isProjectFiles, sameProjectFiles, type ProjectFiles } from './projectStore.ts';
import { agentSetup, installWithCli } from './agents.ts';
import { handleMcpRequest, isLocalRequest } from './mcp/http.ts';

export const PROJECT_CHANGED_EVENT = 'plastic:project-changed';
export const WORKSPACE_CHANGED_EVENT = 'plastic:workspace-changed';

export function plasticWorkspace(): Plugin {
  const root = path.resolve(process.env.PLASTIC_WORKSPACE ?? 'workspace');
  const location = path.relative(process.cwd(), root) || '.';
  /** Last content written or announced per project, so our own saves are not echoed back. */
  const known = new Map<string, ProjectFiles>();

  const store = new ProjectStore(root);
  const library = new LibraryStore(root);
  const readFiles = (id: string) => store.read(id);
  const listProjects = () => store.list();
  const uniqueId = (title: string) => store.uniqueId(title);
  /** Editor saves: remembered so the watcher doesn't echo them back as external edits. */
  async function writeFiles(id: string, files: ProjectFiles, expected?: ProjectFiles): Promise<void> {
    await store.write(id, files, expected);
    known.set(id, files);
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
          if (!files || (prev && sameProjectFiles(files, prev))) return;
          known.set(id, files);
          server.ws.send({ type: 'custom', event: PROJECT_CHANGED_EVENT, data: { id, files } });
        }, 120),
      );
    });
    server.httpServer?.on('close', () => watcher.close());
  }

  const json = (res: ServerResponse, status: number, body?: unknown): void => {
    res.statusCode = status;
    // Workspace state changes all the time; never let the browser reuse an old answer.
    res.setHeader('cache-control', 'no-store');
    if (body !== undefined) res.setHeader('content-type', 'application/json');
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === '/mcp') {
      const raw = req.method === 'POST' ? await readBody(req) : '';
      return handleMcpRequest(store, req, res, raw ? (JSON.parse(raw) as unknown) : undefined);
    }
    if (url.pathname.startsWith('/__plastic/agents')) {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'Local requests only.' });
      const origin = `http://${req.headers.host}`;
      if (url.pathname === '/__plastic/agents' && req.method === 'GET') return json(res, 200, await agentSetup(origin));
      if (url.pathname === '/__plastic/agents/install' && req.method === 'POST') {
        // A JSON body forces a CORS preflight, so other sites can't trigger installs.
        if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' });
        const body = JSON.parse(await readBody(req)) as { agent?: unknown };
        if (body.agent !== 'claude' && body.agent !== 'codex') return json(res, 400, { error: 'agent must be "claude" or "codex"' });
        return json(res, 200, await installWithCli(body.agent));
      }
      return json(res, 404);
    }
    const asset = /^\/__plastic\/files\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
    if (asset) {
      const [, assetProject, assetName] = asset.map((p) => decodeURIComponent(p));
      if (!PROJECT_ID.test(assetProject!) || req.method !== 'GET') return json(res, 404);
      const bytes = await store.readAsset(assetProject!, assetName!);
      if (!bytes) return json(res, 404);
      res.statusCode = 200;
      res.setHeader('content-type', ASSET_TYPES[assetName!.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('cache-control', 'no-cache');
      return void res.end(bytes);
    }
    if (url.pathname === '/__plastic/import/figma') {
      if (req.method !== 'POST') return json(res, 405);
      if (!isLocalRequest(req)) return json(res, 403, { error: 'Local requests only.' });
      // A non-form content type forces a CORS preflight, so other sites can't post files here.
      if (!String(req.headers['content-type']).startsWith('application/octet-stream')) return json(res, 415, { error: 'Expected the .fig file as application/octet-stream.' });
      const bytes = await readBytes(req);
      try {
        const result = await importFigma(store, bytes, url.searchParams.get('name') ?? 'Imported from Figma');
        return json(res, 201, result);
      } catch (error) {
        return json(res, 422, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (url.pathname === '/__plastic/library') {
      if (req.method === 'GET') return json(res, 200, await library.read());
      if (req.method === 'POST') {
        if (!isLocalRequest(req)) return json(res, 403, { error: 'Local requests only.' });
        if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' });
        try {
          return json(res, 200, await library.apply(JSON.parse(await readBody(req)) as Record<string, unknown>));
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      return json(res, 405);
    }
    if (url.pathname === '/__plastic/workspace') {
      if (req.method === 'GET') {
        const [projects, data] = await Promise.all([listProjects(), library.read()]);
        const placed = projects.map((p) => ({ ...p, folderId: data.places[p.id]?.folderId ?? null, archivedAt: data.places[p.id]?.archivedAt ?? null }));
        return json(res, 200, { location, projects: placed });
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { title?: unknown; files?: unknown; assetsFrom?: unknown; folderId?: unknown };
        if (!isProjectFiles(body.files)) return json(res, 400, { error: 'Expected files { "index.html": "…", … }' });
        const id = await uniqueId(typeof body.title === 'string' ? body.title : 'untitled');
        if (typeof body.assetsFrom === 'string' && PROJECT_ID.test(body.assetsFrom)) await store.copyAssets(body.assetsFrom, id);
        await writeFiles(id, body.files);
        if (typeof body.folderId === 'string') await library.apply({ op: 'place', id, folderId: body.folderId }).catch(() => {});
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
      if (!isLocalRequest(req)) return json(res, 403, { error: 'Local requests only.' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' });
      const body = JSON.parse(await readBody(req)) as { files?: unknown; expected?: unknown };
      const files = body.files ?? body;
      if (!isProjectFiles(files) || (body.expected !== undefined && !isProjectFiles(body.expected))) return json(res, 400, { error: 'Expected project files.' });
      try { await writeFiles(id, files, body.expected as ProjectFiles | undefined); }
      catch (error) {
        if (error instanceof ProjectConflictError) return json(res, 409, { files: error.files });
        throw error;
      }
      await library.recordEdit();
      return json(res, 204);
    }
    if (req.method === 'DELETE') {
      if (!isLocalRequest(req)) return json(res, 403, { error: 'Local requests only.' });
      const data = await library.read();
      if (!data.places[id]?.archivedAt) return json(res, 409, { error: 'Archive a file before deleting it.' });
      await store.remove(id);
      known.delete(id);
      await library.apply({ op: 'forget', id });
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
        if (!req.url?.startsWith('/__plastic/') && !/^\/mcp(\?|$)/.test(req.url ?? '')) return next();
        handle(req, res).catch((error: unknown) => json(res, 500, { error: String(error) }));
      });
    },
  };
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

function readBytes(req: NodeJS.ReadableStream): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
