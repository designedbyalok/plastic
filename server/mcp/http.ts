/**
 * Plastic MCP over Streamable HTTP, mounted on the dev server at /mcp (stateless: a fresh
 * server per request). Only local requests are accepted: the Host must be localhost and a
 * browser Origin, if present, must be local too — so web pages can't reach it via DNS rebinding.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ProjectStore } from '../projectStore.ts';
import { createMcpServer } from './server.ts';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function isLocalRequest(req: IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  if (!LOCAL_HOST.test(host)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return LOCAL_HOST.test(new URL(origin).host);
  } catch {
    return false;
  }
}

export async function handleMcpRequest(store: ProjectStore, req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  if (!isLocalRequest(req)) {
    res.statusCode = 403;
    res.end('Plastic MCP only accepts local requests.');
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    res.end();
    return;
  }
  const server = createMcpServer(store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
