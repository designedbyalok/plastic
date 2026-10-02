import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibraryStore } from '../server/library.ts';

describe('local library', () => {
  it('keeps folders, placement, archive state, activity and the profile', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plastic-library-'));
    try {
      const library = new LibraryStore(root);
      const { folder } = (await library.apply({ op: 'createFolder', name: '  Client work ' })) as { folder: { id: string; name: string } };
      expect(folder.name).toBe('Client work');
      await library.apply({ op: 'place', id: 'demo', folderId: folder.id });
      await library.apply({ op: 'place', id: 'old', archived: true });
      await expect(library.apply({ op: 'place', id: 'demo', folderId: 'missing0000' })).rejects.toThrow(/No such folder/);
      await expect(library.apply({ op: 'profile', name: 'A', username: 'no spaces!' })).rejects.toThrow(/Usernames/);
      await library.apply({ op: 'profile', name: 'Test Designer', username: 'test.designer' });
      await Promise.all([library.recordEdit(), library.recordEdit()]);
      await library.apply({ op: 'deleteFolder', id: folder.id });

      const data = await library.read();
      expect(data.folders).toEqual([]);
      expect(data.places.demo).toEqual({ folderId: null, archivedAt: null });
      expect(data.places.old!.archivedAt).toBeGreaterThan(0);
      expect(data.profile).toEqual({ name: 'Test Designer', username: 'test.designer' });
      expect(Object.values(data.activity)).toEqual([2]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
