import { withAiActivity } from '../aiActivity.ts';
/**
 * Plastic's MCP server: lets coding agents (Claude, Codex, Cursor, Copilot, …) read and write
 * designs and tokens. Tools are thin wrappers over DesignApi, which uses the editor's own
 * document operations, so agent edits produce the same files the editor would.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectStore } from '../projectStore.ts';
import { DesignApi, DesignError } from './designApi.ts';
import { importFigma } from '../figma/import.ts';

const INSTRUCTIONS = `Plastic is a visual editor whose designs are real HTML and CSS.

Model:
- A "file" is a folder in the workspace (its id is used as \`file\`). It has pages; each page is one HTML file (index.html, pricing.html…).
- Each top-level element of a page's <body> is an artboard on the canvas (usually a div with a fixed width, e.g. 480px or 1440px).
- Every element has a stable id (the data-pl-id attribute). Use these ids to target elements.
- Styles live in styles.css as one rule per class. Give every element you create a meaningful class and style it through CSS — no inline styles.
- Design tokens are CSS custom properties in tokens.css, named with Tailwind-v4 style prefixes: color-, spacing-, radius-, font-, text-, font-weight-, leading-, tracking-, opacity-, shadow-. Use them in CSS as var(--color-primary).

Working well:
- Start with list_files, then get_page to read the current design (its outline shows tags, classes, ids and text).
- When given a Plastic frame URL (/file/<file>?frame=<id>), call get_frame with that link. It returns every descendant, original HTML, ordered CSS, tokens and the local assets directory. Reuse that source and compare the rendered implementation; do not infer exact styling from a screenshot alone.
- Use semantic HTML: real <button>, <input>, <label>, <form>, <nav>, <table>, headings — not divs that look like them.
- Prefer flexbox/grid inside artboards; use position:absolute only for deliberate free placement.
- Build in pieces: add an artboard (add_frame or write_html without parentId), then write_html into it with parentId.
- Changes appear live in the open editor, and the user can undo each of them.`;

function ok(result: unknown) {
  return { content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
}

function fail(error: unknown) {
  const message = error instanceof DesignError ? error.message : error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/** Wrap a handler so errors become tool errors the agent can read and correct. */
function toolResult<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (error) {
      return fail(error);
    }
  };
}

const file = z.string().describe('File id from list_files (the folder name, e.g. "demo").');
const page = z.string().optional().describe('Page file (e.g. "index.html") or page name. Defaults to the first page.');
const nodeId = z.string().describe('Element id (its data-pl-id).');
const styles = z.record(z.string(), z.string().nullable()).describe('CSS declarations, e.g. { "padding": "24px", "gap": "var(--spacing-3)" }. null removes a declaration.');

export function createMcpServer(store: ProjectStore): McpServer {
  const api = new DesignApi(store);
  const run = <A,>(operation: string, fn: (args: A) => Promise<unknown>) => toolResult((args: A) => withAiActivity(store.root, operation, args, () => fn(args)));
  const server = new McpServer({ name: 'plastic', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

  // --- reading ---------------------------------------------------------------------------------

  server.registerTool(
    'list_files',
    { title: 'List files', description: 'List the design files in the Plastic workspace, with their pages and token counts.', annotations: readOnly },
    run('list_files', () => api.listFiles()),
  );

  server.registerTool(
    'get_file',
    {
      title: 'Get file',
      description: 'Overview of one file: pages, artboards (id, name, canvas position), classes in styles.css and all tokens.',
      inputSchema: { file },
      annotations: readOnly,
    },
    run('get_file', ({ file }) => api.getFile(file)),
  );

  server.registerTool(
    'get_page',
    {
      title: 'Get page',
      description:
        'Read a page exactly as it is saved: an indented outline (tag.classes, data-pl-id, text), the page HTML, artboard positions, styles.css and tokens.css. Use this to understand an existing design before changing it.',
      inputSchema: { file, page },
      annotations: readOnly,
    },
    run('get_page', ({ file, page }) => api.getPage(file, page)),
  );

  server.registerTool(
    'get_node',
    {
      title: 'Get element',
      description: 'Details of one element: tag, attributes, classes with their CSS declarations, text, children ids and its HTML.',
      inputSchema: { file, id: nodeId },
      annotations: readOnly,
    },
    run('get_node', ({ file, id }) => api.getNode(file, id)),
  );

  server.registerTool(
    'get_frame',
    {
      title: 'Read frame link',
      description: 'Read a Plastic frame URL as complete design source: frame identity, every descendant including text and SVG, original HTML, ordered CSS (including global, responsive and font rules), token CSS and local asset location. Read-only; does not fetch arbitrary URLs.',
      inputSchema: { link: z.string().describe('Copied Plastic frame link, e.g. http://localhost:5173/file/demo?frame=abc123.') },
      annotations: readOnly,
    },
    run('get_frame', ({ link }) => api.getFrame(link)),
  );

  server.registerTool(
    'get_tokens',
    { title: 'Get tokens', description: 'All design tokens (CSS custom properties in tokens.css) with their kind and how to reference them.', inputSchema: { file }, annotations: readOnly },
    run('get_tokens', ({ file }) => api.getTokens(file)),
  );

  // --- writing ---------------------------------------------------------------------------------

  server.registerTool(
    'create_file',
    {
      title: 'Create file',
      description: 'Create a new design file. By default it starts with one empty 480×640 artboard.',
      inputSchema: { title: z.string().describe('File title, e.g. "Pricing page".'), withFrame: z.boolean().optional().describe('Start with an empty artboard (default true).') },
      annotations: writes,
    },
    run('create_file', ({ title, withFrame }) => api.createFile(title, withFrame ?? true)),
  );

  server.registerTool(
    'add_frame',
    {
      title: 'Add artboard',
      description: 'Add an empty artboard (a div with a fixed width and min-height) to a page. Returns its id and class.',
      inputSchema: {
        file,
        page,
        width: z.number().optional().describe('Width in px (default 480; use 1440 for desktop, 390 for mobile).'),
        height: z.number().optional().describe('Minimum height in px (default 640).'),
        x: z.number().optional(),
        y: z.number().optional(),
      },
      annotations: writes,
    },
    run('add_frame', (a) => api.addFrame(a.file, a)),
  );

  server.registerTool(
    'write_html',
    {
      title: 'Write HTML',
      description:
        'Insert HTML into an element (parentId) or onto a page as new artboards (no parentId). Put styles in `css` as class rules (".card { padding: 24px; }"); they merge into styles.css. Use semantic elements and classes. Returns the created ids and an outline.',
      inputSchema: {
        file,
        html: z.string().describe('One or more elements, e.g. <section class="hero"><h1 class="hero-title">…</h1></section>.'),
        css: z.string().optional().describe('CSS for the classes used in html. @media and other rules are kept too.'),
        parentId: z.string().optional().describe('Insert inside this element. Omit to add artboards to the page.'),
        index: z.number().optional().describe('Position among the parent’s children (default: at the end).'),
        page,
        x: z.number().optional().describe('Canvas x for new artboards.'),
        y: z.number().optional().describe('Canvas y for new artboards.'),
      },
      annotations: writes,
    },
    run('write_html', (a) => api.writeHtml(a.file, a)),
  );

  server.registerTool(
    'set_page_html',
    {
      title: 'Replace page',
      description: 'Replace everything on a page with new HTML (each top-level element becomes an artboard) and optional CSS.',
      inputSchema: { file, page, html: z.string(), css: z.string().optional() },
      annotations: destructive,
    },
    run('set_page_html', (a) => api.setPageHtml(a.file, a)),
  );

  server.registerTool(
    'update_styles',
    {
      title: 'Update styles',
      description: 'Change CSS declarations on a class (className) — affecting every element that uses it — or on the given elements’ own classes (ids).',
      inputSchema: { file, className: z.string().optional(), ids: z.array(z.string()).optional(), styles },
      annotations: writes,
    },
    run('update_styles', (a) => api.updateStyles(a.file, a)),
  );

  server.registerTool(
    'set_attributes',
    {
      title: 'Set attributes',
      description: 'Set or remove (null) HTML attributes on an element (e.g. type, placeholder, href, alt, required: ""), optionally changing its tag.',
      inputSchema: { file, id: nodeId, attributes: z.record(z.string(), z.string().nullable()), tag: z.string().optional().describe('New tag name, e.g. "section" or "h2".') },
      annotations: writes,
    },
    run('set_attributes', ({ file, id, attributes, tag }) => api.setAttributes(file, id, attributes, tag)),
  );

  server.registerTool(
    'set_text',
    { title: 'Set text', description: 'Replace the text of an element (its first text node).', inputSchema: { file, id: nodeId, text: z.string() }, annotations: writes },
    run('set_text', ({ file, id, text }) => api.setText(file, id, text)),
  );

  server.registerTool(
    'move_node',
    { title: 'Move element', description: 'Move an element into another element at an index.', inputSchema: { file, id: nodeId, parentId: nodeId, index: z.number().optional() }, annotations: writes },
    run('move_node', ({ file, id, parentId, index }) => api.moveNode(file, id, parentId, index)),
  );

  server.registerTool(
    'delete_nodes',
    { title: 'Delete elements', description: 'Delete elements and everything inside them.', inputSchema: { file, ids: z.array(z.string()) }, annotations: destructive },
    run('delete_nodes', ({ file, ids }) => api.deleteNodes(file, ids)),
  );

  server.registerTool(
    'import_figma',
    {
      title: 'Import Figma file',
      description:
        'Convert a local Figma .fig file into a new Plastic file: pages, artboards, auto layout (as flexbox/grid), text, images, vectors (inline SVG) and variables (tokens). Returns the new file id and a report, including the fonts it uses.',
      inputSchema: { path: z.string().describe('Absolute path to a .fig file (in Figma: File → Save local copy…).') },
      annotations: writes,
    },
    run('import_figma', async ({ path: figPath }) => {
      if (!/\.fig$/i.test(figPath)) throw new DesignError('Expected a path to a .fig file.');
      const bytes = await fsp.readFile(figPath).catch(() => {
        throw new DesignError(`Can't read ${figPath}.`);
      });
      return importFigma(store, new Uint8Array(bytes), path.basename(figPath));
    }),
  );

  // --- pages -----------------------------------------------------------------------------------

  server.registerTool(
    'create_page',
    { title: 'Create page', description: 'Add an empty page (a new HTML file) to a file.', inputSchema: { file, name: z.string() }, annotations: writes },
    run('create_page', ({ file, name }) => api.createPage(file, name)),
  );

  server.registerTool(
    'rename_page',
    { title: 'Rename page', description: 'Rename a page (its file name stays the same).', inputSchema: { file, page: z.string(), name: z.string() }, annotations: writes },
    run('rename_page', ({ file, page, name }) => api.renamePage(file, page, name)),
  );

  server.registerTool(
    'delete_page',
    { title: 'Delete page', description: 'Delete a page and its HTML file.', inputSchema: { file, page: z.string() }, annotations: destructive },
    run('delete_page', ({ file, page }) => api.deletePage(file, page)),
  );

  // --- tokens ----------------------------------------------------------------------------------

  server.registerTool(
    'set_tokens',
    {
      title: 'Set tokens',
      description:
        'Create, update or delete (null) design tokens. Names have no leading "--" and use prefixes: color-, spacing-, radius-, font-, text-, font-weight-, leading-, tracking-, opacity-, shadow-. Reference them in CSS as var(--name).',
      inputSchema: { file, tokens: z.record(z.string(), z.string().nullable()).describe('e.g. { "color-primary": "#4f46e5", "spacing-4": "16px" }') },
      annotations: writes,
    },
    run('set_tokens', ({ file, tokens }) => api.setTokens(file, tokens)),
  );

  server.registerTool(
    'rename_token',
    { title: 'Rename token', description: 'Rename a token and every var() that uses it.', inputSchema: { file, from: z.string(), to: z.string() }, annotations: writes },
    run('rename_token', ({ file, from, to }) => api.renameToken(file, from, to)),
  );

  return server;
}
