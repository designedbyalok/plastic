import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readAiActivity, withAiActivity } from '../server/aiActivity';
it('announces targeted reads across processes, keeps overlapping work separate and expires completed calls', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plastic-ai-'));
  try {
    let resolve!: () => void;
    const work = withAiActivity(root, 'get_frame', { link: '/file/demo?frame=frame-1' }, () => new Promise<void>(r => { resolve = r; }));
    let activity = [] as Awaited<ReturnType<typeof readAiActivity>>;
    await new Promise<void>((done, reject) => {
      const timer = setInterval(async () => { activity = await readAiActivity(root, 'demo'); if (activity.length) { clearInterval(timer); done(); } }, 5);
      setTimeout(() => { clearInterval(timer); reject(new Error('Missing presence')); }, 1000).unref();
    });
    expect(activity[0]).toMatchObject({ mode: 'read', file: 'demo', nodeIds: ['frame-1'], operation: 'get_frame' });
    expect(await readAiActivity(root, 'other-file')).toEqual([]);
    await withAiActivity(root, 'set_text', { file: 'demo', id: 'text' }, async () => {});
    expect(await readAiActivity(root, 'demo')).toHaveLength(2);
    resolve(); await work;
    const finished = await readAiActivity(root, 'demo'); expect(finished[0]!.expiresAt - Date.now()).toBeLessThanOrEqual(2500);
    const directory = path.join(root, '.plastic-ai-activity');
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name); const value = JSON.parse(await fs.readFile(file, 'utf8')); value.expiresAt = 0; await fs.writeFile(file, JSON.stringify(value));
    }
    expect(await readAiActivity(root, 'demo')).toEqual([]); expect(await fs.readdir(directory)).toEqual([]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it('never blocks a design operation when presence cannot be persisted', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plastic-ai-'));
  try {
    await fs.writeFile(path.join(root, '.plastic-ai-activity'), 'unavailable');
    expect(await withAiActivity(root, 'get_node', { file: 'demo', id: 'node' }, async () => 'design')).toBe('design');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
