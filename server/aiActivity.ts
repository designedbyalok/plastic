/** Short-lived per-call records work across HTTP and separate stdio MCP processes. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseFrameLink } from '../src/serialization/frame.ts';
import type { AiActivity } from '../src/editor/aiPresence.ts';
const DIRECTORY = '.plastic-ai-activity';
export async function withAiActivity<T>(root: string, operation: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const args = (input ?? {}) as Record<string, unknown>;
  let file = args.file; let frame: string | undefined;
  if (typeof args.link === 'string') { try { const parsed = parseFrameLink(args.link); file = parsed.file; frame = parsed.frame; } catch { /* Normal tool validation reports malformed links. */ } }
  if (typeof file !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(file)) return fn();
  const ids = [frame, args.id, args.parentId, ...(Array.isArray(args.ids) ? args.ids : [])].filter((id): id is string => typeof id === 'string' && /^[\w-]{1,64}$/.test(id));
  const record: AiActivity = { id: randomUUID(), file, nodeIds: [...new Set(ids)], operation, mode: operation.startsWith('get_') ? 'read' : 'write', expiresAt: Date.now() + 15000 };
  if (typeof args.page === 'string') record.page = args.page;
  const folder = path.join(root, DIRECTORY); const target = path.join(folder, `${record.id}.json`);
  const publish = async (duration: number) => {
    record.expiresAt = Date.now() + duration;
    try { await fsp.mkdir(folder, { recursive: true }); await fsp.writeFile(`${target}.tmp`, JSON.stringify(record)); await fsp.rename(`${target}.tmp`, target); } catch { /* Presence must never break a design operation. */ }
  };
  // Prune expired records even when no editor is open to poll for activity.
  await readAiActivity(root, file);
  await publish(15000);
  let pending = Promise.resolve();
  const heartbeat = setInterval(() => { pending = pending.then(() => publish(15000)); }, 5000); heartbeat.unref();
  try { return await fn(); } finally { clearInterval(heartbeat); await pending; await publish(2500); }
}
export async function readAiActivity(root: string, file: string): Promise<AiActivity[]> {
  const folder = path.join(root, DIRECTORY);
  let names: string[]; try { names = await fsp.readdir(folder); } catch { return []; }
  const records = await Promise.all(names.filter(n => /^[\w-]+\.json$/.test(n)).map(async name => {
    const target = path.join(folder, name);
    try {
      const record = JSON.parse(await fsp.readFile(target, 'utf8')) as AiActivity;
      if (!Number.isFinite(record.expiresAt) || record.expiresAt < Date.now()) { await fsp.unlink(target).catch(() => {}); return null; }
      return record.file === file && Array.isArray(record.nodeIds) ? record : null;
    } catch { return null; }
  }));
  return records.filter((record): record is AiActivity => !!record);
}
