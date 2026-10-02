import { describe, expect, it, vi } from 'vitest';
import { mergeProjectFiles, ProjectSync, type SyncSnapshot } from '../src/editor/projectSync.ts';
import { StorageConflictError } from '../src/serialization/conflict.ts';
import type { ProjectStorage } from '../src/serialization/storage.ts';

function harness(save = vi.fn(async () => {})) {
  const base = { 'index.html': 'base', 'styles.css': 'base-css' };
  let state: SyncSnapshot = { files: base, revision: 0, busy: false };
  const status = vi.fn(),
    dirty = vi.fn();
  const storage: ProjectStorage = {
    id: 'test',
    location: 'test',
    assetBase: null,
    load: async () => base,
    save,
    onExternalChange: () => () => {},
  };
  const sync = new ProjectSync(storage, base, {
    read: () => state,
    apply: (files) => {
      state = { ...state, files, revision: state.revision + 1 };
    },
    status,
    dirty,
  });
  return {
    sync,
    save,
    status,
    dirty,
    state: () => state,
    set: (next: Partial<SyncSnapshot>) => {
      state = { ...state, ...next };
    },
  };
}

describe('project synchronization', () => {
  it('merges independent files including additions and deletions', () => {
    expect(mergeProjectFiles({ a: '1', b: '1' }, { a: '2', b: '1', c: '3' }, { a: '1' })).toEqual({
      files: { a: '2', c: '3' },
    });
  });
  it('automatically retains an actively edited file over an incoming deletion', () => {
    expect(mergeProjectFiles({ a: '1' }, { a: '2' }, {})).toEqual({ files: { a: '2' } });
  });
  it('queues external changes during gestures and applies them afterward', () => {
    const h = harness();
    h.set({ busy: true });
    h.sync.receive({ 'index.html': 'agent', 'styles.css': 'base-css' });
    expect(h.state().files['index.html']).toBe('base');
    h.set({ busy: false });
    h.sync.drain();
    expect(h.state().files['index.html']).toBe('agent');
  });
  it('automatically saves active local values without pausing for overlapping edits', async () => {
    const h = harness();
    h.set({ files: { 'index.html': 'local', 'styles.css': 'base-css' }, revision: 1 });
    h.sync.receive({ 'index.html': 'agent', 'styles.css': 'base-css' });
    await h.sync.save();
    expect(h.save).toHaveBeenCalledWith({ 'index.html': 'local', 'styles.css': 'base-css' });
    expect(h.dirty).toHaveBeenCalled();
  });
  it('serializes overlapping saves and captures the intended revision', async () => {
    let release!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      )
      .mockResolvedValue(undefined);
    const h = harness(save);
    h.set({ files: { 'index.html': 'first' }, revision: 1 });
    const first = h.sync.save();
    await Promise.resolve();
    h.set({ files: { 'index.html': 'second' }, revision: 2 });
    const second = h.sync.save();
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await first;
    await second;
    expect(save.mock.calls.map((c) => c[0]['index.html'])).toEqual(['first', 'second']);
  });
  it('keeps a failed save retryable', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const h = harness(save);
    h.set({ files: { 'index.html': 'local' }, revision: 1 });
    await expect(h.sync.save()).rejects.toThrow('offline');
    await h.sync.save();
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('merges stale-server responses and schedules an automatic retry', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new StorageConflictError({ 'index.html': 'agent', 'styles.css': 'agent-css' }))
      .mockResolvedValue(undefined);
    const h = harness(save);
    h.set({ files: { 'index.html': 'local', 'styles.css': 'base-css' }, revision: 1 });
    await h.sync.save();
    await Promise.resolve();
    expect(h.state().files).toEqual({ 'index.html': 'local', 'styles.css': 'agent-css' });
    expect(h.dirty).toHaveBeenCalled();
    await h.sync.save();
    expect(save).toHaveBeenLastCalledWith({ 'index.html': 'local', 'styles.css': 'agent-css' });
  });
  it('a closed coordinator ignores later events from another project', async () => {
    const h = harness();
    h.sync.close();
    h.sync.receive({ 'index.html': 'other' });
    h.sync.drain();
    expect(h.state().files['index.html']).toBe('base');
  });
  it('automatically merges and retries a navigation flush without reading the next project', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new StorageConflictError({ 'index.html': 'agent', 'styles.css': 'agent-css' }))
      .mockResolvedValue(undefined);
    const h = harness(save);
    h.set({ files: { 'index.html': 'local', 'styles.css': 'base-css' }, revision: 1 });
    const pending = h.sync.save();
    h.sync.close();
    h.set({ files: { 'index.html': 'next-project' }, revision: 0 });
    await pending;
    expect(save).toHaveBeenLastCalledWith({ 'index.html': 'local', 'styles.css': 'agent-css' });
  });
});
