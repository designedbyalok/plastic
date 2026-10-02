import type { ProjectFiles } from './index.ts';

/** A compare-and-swap save failed; the coordinator merges and retries against the incoming version. */
export class StorageConflictError extends Error {
  constructor(readonly files: ProjectFiles) {
    super('This project changed elsewhere. Merging the incoming changes.');
    this.name = 'StorageConflictError';
  }
}
