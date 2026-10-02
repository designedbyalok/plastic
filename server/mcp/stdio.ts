#!/usr/bin/env bun
/**
 * Plastic MCP server over stdio — the command agents launch:
 *   bun /path/to/plastic/server/mcp/stdio.ts
 * Works on the workspace folder directly, so the editor doesn't need to be open; when it is,
 * edits appear live. Set PLASTIC_WORKSPACE to use another workspace folder.
 */
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ProjectStore } from '../projectStore.ts';
import { createMcpServer } from './server.ts';

const root = path.resolve(process.env.PLASTIC_WORKSPACE ?? path.join(import.meta.dirname, '..', '..', 'workspace'));
const server = createMcpServer(new ProjectStore(root));
await server.connect(new StdioServerTransport());
// stdout carries the protocol; log to stderr only.
console.error(`Plastic MCP server ready (workspace: ${root})`);
