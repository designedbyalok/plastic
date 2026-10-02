/**
 * Undo/redo over immutable document snapshots. Structural sharing makes a snapshot cheap
 * (only changed nodes are new objects), so history stores whole documents, not inverse ops.
 */
import type { DesignDocument, NodeId } from '../document/types';

export interface Snapshot {
  readonly doc: DesignDocument;
  readonly selection: readonly NodeId[];
  /** Label of the change that followed this snapshot, e.g. "Set padding". */
  readonly label: string;
}

export interface History {
  readonly past: readonly Snapshot[];
  readonly future: readonly Snapshot[];
  /** Consecutive edits with the same key (typing in one field) merge into one undo step. */
  readonly coalesce: { readonly key: string; readonly at: number } | null;
}

export const EMPTY_HISTORY: History = { past: [], future: [], coalesce: null };

const LIMIT = 300;
const COALESCE_MS = 1200;

export function record(history: History, before: Snapshot, key: string | null, now: number): History {
  const merge = key !== null && history.coalesce?.key === key && now - history.coalesce.at < COALESCE_MS && history.past.length > 0;
  const coalesce = key === null ? null : { key, at: now };
  if (merge) return { ...history, future: [], coalesce };
  return { past: [...history.past, before].slice(-LIMIT), future: [], coalesce };
}

export function undo(history: History, current: Snapshot): { history: History; snapshot: Snapshot } | null {
  const snapshot = history.past[history.past.length - 1];
  if (!snapshot) return null;
  return {
    snapshot,
    history: { past: history.past.slice(0, -1), future: [{ ...current, label: snapshot.label }, ...history.future], coalesce: null },
  };
}

export function redo(history: History, current: Snapshot): { history: History; snapshot: Snapshot } | null {
  const snapshot = history.future[0];
  if (!snapshot) return null;
  return {
    snapshot,
    history: { past: [...history.past, { ...current, label: snapshot.label }], future: history.future.slice(1), coalesce: null },
  };
}
