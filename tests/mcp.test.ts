import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Talks to the real stdio server, the way Claude/Codex/Cursor do, on a throwaway workspace. */
let client: Client;
let workspace: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'plastic-mcp-'));
  client = new Client({ name: 'plastic-test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: 'bun',
      args: [path.resolve('server/mcp/stdio.ts')],
      env: { ...(process.env as Record<string, string>), PLASTIC_WORKSPACE: workspace },
      stderr: 'ignore',
    }),
  );
}, 30000);

afterAll(async () => {
  await client?.close();
  await fs.rm(workspace, { recursive: true, force: true });
});

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = result.content[0]!.text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text) as T;
}

describe('Plastic MCP server', () => {
  it('describes the model and offers the design tools', async () => {
    expect(client.getInstructions()).toContain('data-pl-id');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['list_files', 'get_page', 'write_html', 'update_styles', 'set_tokens', 'create_page', 'get_tokens', 'rename_token']),
    );
  });

  it('lets an agent create a design, read it back accurately, and edit it', async () => {
    const created = await call<{ file: string }>('create_file', { title: 'Agent login' });
    expect(created.file).toBe('agent-login');

    await call('set_tokens', { file: 'agent-login', tokens: { 'color-primary': '#4f46e5', 'spacing-4': '16px' } });
    const file = await call<{ pages: { artboards: { id: string }[] }[] }>('get_file', { file: 'agent-login' });
    const frame = file.pages[0]!.artboards[0]!.id;

    const written = await call<{ created: string[]; outline: string }>('write_html', {
      file: 'agent-login',
      parentId: frame,
      html: '<form class="login"><h2 class="login-title">Sign in</h2><label class="field">Email<input type="email" placeholder="you@example.com" required></label><button class="cta" type="submit">Continue</button></form>',
      css: '.login { display: flex; flex-direction: column; gap: var(--spacing-4); } .cta { background: var(--color-primary); color: white; }',
    });
    expect(written.created).toHaveLength(1);
    expect(written.outline).toContain('<form.login>');
    expect(written.outline).toContain('<input type="email" placeholder="you@example.com" required>');
    expect(written.outline).toMatch(/<label\.field> data-pl-id=\S+ "Email"/);

    // Reading back returns exactly what was saved: semantics, classes, ids and CSS.
    const page = await call<{ html: string; outline: string; css: string; tokensCss: string }>('get_page', { file: 'agent-login' });
    expect(page.html).toContain('<button class="cta" type="submit"');
    expect(page.css).toContain('.cta {\n  background: var(--color-primary);');
    expect(page.tokensCss).toContain('--color-primary: #4f46e5;');

    const buttonId = /<button.cta[^\n]*data-pl-id=(\S+)/.exec(page.outline)![1]!;
    await call('set_text', { file: 'agent-login', id: buttonId, text: 'Log in' });
    await call('update_styles', { file: 'agent-login', className: 'cta', styles: { 'border-radius': '999px', color: null } });
    const node = await call<{ text: string; css: Record<string, Record<string, string>> }>('get_node', { file: 'agent-login', id: buttonId });
    expect(node.text).toBe('Log in');
    expect(node.css.cta).toEqual({ background: 'var(--color-primary)', 'border-radius': '999px' });

    // The files on disk are ordinary HTML/CSS the editor opens.
    const html = await fs.readFile(path.join(workspace, 'agent-login', 'index.html'), 'utf8');
    expect(html).toContain('<link rel="stylesheet" href="tokens.css">');
    expect(html).toContain('>Log in</button>');
  });

  it('manages pages and renames tokens with their references', async () => {
    const pageResult = await call<{ page: string }>('create_page', { file: 'agent-login', name: 'Pricing' });
    expect(pageResult.page).toBe('pricing.html');
    await call('write_html', { file: 'agent-login', page: 'Pricing', html: '<main class="pricing"><h1>Pricing</h1></main>', css: '.pricing { width: 1440px; padding: var(--spacing-4); }' });
    await call('rename_token', { file: 'agent-login', from: 'spacing-4', to: 'spacing-md' });
    const tokens = await call<{ tokens: Record<string, { kind: string }> }>('get_tokens', { file: 'agent-login' });
    expect(Object.keys(tokens.tokens)).toEqual(['color-primary', 'spacing-md']);
    expect(tokens.tokens['spacing-md']!.kind).toBe('spacing');
    const pricing = await call<{ css: string }>('get_page', { file: 'agent-login', page: 'pricing.html' });
    expect(pricing.css).toContain('padding: var(--spacing-md);');
    expect(pricing.css).not.toContain('--spacing-4');
  });

  it('returns readable errors the agent can act on', async () => {
    await expect(call('get_node', { file: 'agent-login', id: 'nope' })).rejects.toThrow(/No element with id "nope"/);
    await expect(call('get_page', { file: 'missing' })).rejects.toThrow(/No file "missing"/);
  });
});
