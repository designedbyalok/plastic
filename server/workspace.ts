/**
 * Dev-server bridge between the editor and design files on disk.
 *
 * The editor reads and writes a plain folder (workspace/<project>/index.html, styles.css,
 * project.json). Anything else that edits those files — a text editor, git, a coding agent —
 * is picked up by the watcher and pushed to the open editor. Tauri will replace this with
 * native file access later; the HTTP shape is intentionally tiny so that swap stays local.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

const FILES = { html: 'index.html', css: 'styles.css', project: 'project.json' } as const;
type FileKey = keyof typeof FILES;
type ProjectFiles = Record<FileKey, string>;

const ENDPOINT = '/__plastic/project';
export const FILES_CHANGED_EVENT = 'plastic:files-changed';

export function plasticWorkspace(): Plugin {
  const projectDir = path.resolve(process.env.PLASTIC_PROJECT ?? 'workspace/demo');
  /** What we last wrote or last announced, so our own saves are not echoed back as external edits. */
  let known: ProjectFiles | null = null;

  async function readFiles(): Promise<ProjectFiles | null> {
    try {
      const entries = await Promise.all(
        (Object.keys(FILES) as FileKey[]).map(async (key) => {
          const text = await fsp.readFile(path.join(projectDir, FILES[key]), 'utf8').catch(() => '');
          return [key, text] as const;
        }),
      );
      const files = Object.fromEntries(entries) as ProjectFiles;
      return files.html ? files : null;
    } catch {
      return null;
    }
  }

  async function writeFiles(files: ProjectFiles): Promise<void> {
    await fsp.mkdir(projectDir, { recursive: true });
    known = files;
    for (const key of Object.keys(FILES) as FileKey[]) {
      const target = path.join(projectDir, FILES[key]);
      const current = await fsp.readFile(target, 'utf8').catch(() => null);
      if (current !== files[key]) await fsp.writeFile(target, files[key], 'utf8');
    }
  }

  function watch(server: ViteDevServer): void {
    fs.mkdirSync(projectDir, { recursive: true });
    let timer: NodeJS.Timeout | undefined;
    const watcher = fs.watch(projectDir, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const files = await readFiles();
        if (!files || sameFiles(files, known)) return;
        known = files;
        server.ws.send({ type: 'custom', event: FILES_CHANGED_EVENT, data: files });
      }, 120);
    });
    server.httpServer?.on('close', () => watcher.close());
  }

  return {
    name: 'plastic-workspace',
    apply: 'serve',
    configureServer(server) {
      watch(server);
      server.middlewares.use(ENDPOINT, (req, res) => {
        void (async () => {
          try {
            if (req.method === 'GET') {
              const files = await readFiles();
              if (files) known = files;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ files, location: path.relative(process.cwd(), projectDir) }));
              return;
            }
            if (req.method === 'PUT') {
              const body = await readBody(req);
              const parsed = JSON.parse(body) as Partial<ProjectFiles>;
              if (typeof parsed.html !== 'string' || typeof parsed.css !== 'string' || typeof parsed.project !== 'string') {
                res.statusCode = 400;
                res.end('Expected { html, css, project } strings');
                return;
              }
              await writeFiles({ html: parsed.html, css: parsed.css, project: parsed.project });
              res.statusCode = 204;
              res.end();
              return;
            }
            res.statusCode = 405;
            res.end();
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error));
          }
        })();
      });
    },
  };
}

function sameFiles(a: ProjectFiles, b: ProjectFiles | null): boolean {
  return !!b && a.html === b.html && a.css === b.css && a.project === b.project;
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
