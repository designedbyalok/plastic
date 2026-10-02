import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectStore, ProjectConflictError } from '../server/projectStore.ts';

async function withStore(run: (store: ProjectStore) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plastic-store-'));
  try {
    await run(new ProjectStore(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('local project concurrency', () => {
  it('rejects stale editor saves and retains agent changes', async () => {
    await withStore(async (store) => {
      const base = { 'index.html': 'base' };
      await store.write('demo', base);
      await store.write('demo', { 'index.html': 'agent' });
      await expect(store.write('demo', { 'index.html': 'editor' }, base)).rejects.toBeInstanceOf(ProjectConflictError);
      expect(await store.read('demo')).toEqual({ 'index.html': 'agent' });
    });
  });
  it('serializes concurrent agent read/edit/write operations', async () => {
    await withStore(async (store) => {
      await store.write('demo', { 'index.html': '0' });
      await Promise.all(
        Array.from({ length: 20 }, () =>
          store.edit('demo', (files) => ({ 'index.html': String(Number(files['index.html']) + 1) })),
        ),
      );
      expect(await store.read('demo')).toEqual({ 'index.html': '20' });
    });
  });
  it('keeps deleted pages and imported binary assets consistent', async () => {
    await withStore(async (store) => {
      await store.write('demo', { 'index.html': 'main', 'other.html': 'other', 'styles.css': 'css' });
      await store.writeAssets('demo', { 'assets/image.png': new Uint8Array([1, 2, 3]) });
      await store.write('demo', { 'index.html': 'main', 'styles.css': 'updated' });
      expect(await store.read('demo')).toEqual({ 'index.html': 'main', 'styles.css': 'updated' });
      expect(await store.readAsset('demo', 'image.png')).toEqual(Buffer.from([1, 2, 3]));
      expect((await fs.readdir(store.dirOf('demo'))).some((n) => n.endsWith('.tmp'))).toBe(false);
    });
  });
});
