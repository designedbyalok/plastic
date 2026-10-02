import { sameFiles, type ProjectFiles } from '../serialization/index.ts';
import { StorageConflictError } from '../serialization/conflict.ts';
import { mergeFiles } from './merge.ts';
import type { ProjectStorage } from '../serialization/storage.ts';

export interface SyncSnapshot {
  files: ProjectFiles;
  revision: number;
  busy: boolean;
}
interface Callbacks {
  read(): SyncSnapshot;
  apply(files: ProjectFiles): void;
  status(status: 'saving' | 'saved' | 'error', revision?: number): void;
  normalize?(files: ProjectFiles): ProjectFiles;
  dirty?(): void;
}

/** Merge fields automatically, retaining active local values only where edits overlap. */
export function mergeProjectFiles(base: ProjectFiles, local: ProjectFiles, incoming: ProjectFiles) {
  return { files: mergeFiles(base, local, incoming) };
}

/** One coordinator per open project, so late saves cannot update another editor session. */
export class ProjectSync {
  private queue = Promise.resolve();
  private closed = false;
  private writing = 0;
  private incoming: { base: ProjectFiles; files: ProjectFiles } | null = null;
  constructor(
    private readonly storage: ProjectStorage,
    private baseline: ProjectFiles,
    private readonly callbacks: Callbacks,
  ) {}

  receive(files: ProjectFiles): void {
    if (this.closed) return;
    if (sameFiles(files, this.baseline)) return;
    this.incoming = { base: this.incoming?.base ?? this.baseline, files };
    this.drain();
  }

  drain(): void {
    if (this.closed || !this.incoming || this.writing || this.callbacks.read().busy) return;
    const { base, files: incoming } = this.incoming;
    const local = this.callbacks.read().files;
    const merged = mergeProjectFiles(base, local, incoming);
    this.incoming = null;
    this.baseline = incoming;
    if (!sameFiles(local, merged.files)) this.callbacks.apply(merged.files);
    if (sameFiles(merged.files, incoming)) this.callbacks.status('saved', this.callbacks.read().revision);
    else this.callbacks.dirty?.();
  }

  close(): void {
    this.closed = true;
  }

  /** Capture before queuing: navigation must flush this project's snapshot, never the next one. */
  save(): Promise<void> {
    if (this.closed) return this.queue;
    this.drain();
    const snapshot = this.callbacks.read();
    if (snapshot.busy) return this.queue;
    this.writing++;
    const job = this.queue.then(async () => {
      let files = snapshot.files;
      if (this.incoming) {
        if (!this.closed) return;
        files = mergeFiles(this.incoming.base, files, this.incoming.files);
        this.baseline = this.incoming.files;
        this.incoming = null;
      }
      if (sameFiles(files, this.baseline)) {
        this.callbacks.status('saved', snapshot.revision);
        return;
      }
      this.callbacks.status('saving');
      for (let attempt = 0; ; attempt++) {
        try {
          await this.storage.save(files);
          this.baseline = files;
          this.callbacks.status('saved', snapshot.revision);
          return;
        } catch (error) {
          if (error instanceof StorageConflictError && attempt < 3) {
            const incoming = this.callbacks.normalize?.(error.files) ?? error.files;
            if (!this.closed) {
              this.incoming = { base: this.baseline, files: incoming };
              return;
            }
            // Navigation has detached the editor: flush the captured project, never read
            // the new project's live state. Retry concurrent writes against their new base.
            files = mergeFiles(this.baseline, files, incoming);
            this.baseline = incoming;
          } else {
            this.callbacks.status('error');
            throw error;
          }
        }
      }
    });
    this.queue = job
      .catch(() => {})
      .finally(() => {
        this.writing--;
        this.drain();
      });
    return job;
  }
}
