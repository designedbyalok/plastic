/**
 * Connecting local agents. The setup is one stdio command (absolute paths, since GUI apps often
 * lack ~/.bun/bin on PATH) plus the HTTP URL. One-click install uses each agent's own CLI —
 * `claude mcp add`, `codex mcp add` — run with execFile (no shell) and only for local requests.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

export interface AgentSetup {
  readonly command: string;
  readonly args: readonly string[];
  readonly url: string;
  readonly cli: Record<CliAgent, { available: boolean; connected: boolean }>;
}

export type CliAgent = 'claude' | 'codex';

export const SERVER_NAME = 'plastic';
const STDIO_ENTRY = path.join(import.meta.dirname, 'mcp', 'stdio.ts');

function run(file: string, args: readonly string[], timeout = 15000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, env: process.env }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : 1) : 0;
      resolve({ code, output: `${stdout}${stderr}`.trim() });
    });
  });
}

async function which(bin: string): Promise<string | null> {
  const { code, output } = await run('/usr/bin/which', [bin], 3000);
  return code === 0 && output ? output.split('\n')[0]!.trim() : null;
}

let bunPath: string | null = null;

async function resolveBun(): Promise<string> {
  bunPath ??= process.versions.bun ? process.execPath : ((await which('bun')) ?? 'bun');
  return bunPath;
}

export async function agentSetup(origin: string): Promise<AgentSetup> {
  const command = await resolveBun();
  const cli = {} as AgentSetup['cli'];
  await Promise.all(
    (['claude', 'codex'] as const).map(async (agent) => {
      const bin = await which(agent);
      const connected = bin ? (await run(bin, ['mcp', 'get', SERVER_NAME], 8000)).code === 0 : false;
      cli[agent] = { available: !!bin, connected };
    }),
  );
  return { command, args: [STDIO_ENTRY], url: `${origin}/mcp`, cli };
}

/** Register Plastic with an agent through its CLI. */
export async function installWithCli(agent: CliAgent): Promise<{ ok: boolean; output: string }> {
  const bin = await which(agent);
  if (!bin) return { ok: false, output: `The ${agent} command was not found on PATH.` };
  const command = await resolveBun();
  if ((await run(bin, ['mcp', 'get', SERVER_NAME], 8000)).code === 0) return { ok: true, output: 'Already connected.' };
  const args = agent === 'claude' ? ['mcp', 'add', '--scope', 'user', SERVER_NAME, '--', command, STDIO_ENTRY] : ['mcp', 'add', SERVER_NAME, '--', command, STDIO_ENTRY];
  const result = await run(bin, args);
  return { ok: result.code === 0, output: result.output };
}
