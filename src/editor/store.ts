/**
 * Editor store. Two kinds of state live here and must not be confused:
 *
 *  - `doc`: the design document. Changed only through `apply` / transactions, so every change
 *    is undoable and goes through pure functions in src/document.
 *  - everything else: editor state (selection, tool, viewport, …). Never part of the design,
 *    never in undo history.
 */
import { create } from 'zustand';
import type { DesignDocument, NodeId } from '../document/types';
import { starterDocument } from '../elements/insertables';
import type { Viewport } from '../canvas/coords';
import { EMPTY_HISTORY, record, redo, undo, type History } from './history';

export type Tool =
  | { readonly kind: 'select' }
  | { readonly kind: 'hand' }
  | { readonly kind: 'frame' }
  | { readonly kind: 'insert'; readonly itemId: string };

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Transaction {
  readonly base: DesignDocument;
  readonly selection: readonly NodeId[];
}

export interface ApplyOptions {
  /** Merge with the previous edit if it had the same key (e.g. typing in one field). */
  readonly coalesce?: string;
  /** Selection after the change. */
  readonly select?: readonly NodeId[];
}

export interface EditorState {
  readonly doc: DesignDocument;
  readonly history: History;
  readonly tx: Transaction | null;
  /** Increments on every document change; persistence compares it with `savedRevision`. */
  readonly revision: number;
  readonly savedRevision: number;
  readonly saveStatus: SaveStatus;
  readonly storageLocation: string;

  readonly selection: readonly NodeId[];
  readonly hoverId: NodeId | null;
  readonly editingTextId: NodeId | null;
  readonly tool: Tool;
  readonly viewport: Viewport;
  readonly collapsed: Readonly<Record<NodeId, true>>;
  readonly codeOpen: boolean;
  readonly layersOpen: boolean;
  readonly spacePressed: boolean;

  apply(label: string, recipe: (doc: DesignDocument) => DesignDocument, options?: ApplyOptions): void;
  begin(): void;
  preview(recipe: (base: DesignDocument) => DesignDocument): void;
  commit(label: string, select?: readonly NodeId[]): void;
  cancel(): void;
  undo(): void;
  redo(): void;
  /** Replace the document (open a project). Clears history. */
  load(doc: DesignDocument, view?: { viewport?: Viewport | null; collapsed?: readonly NodeId[] }): void;

  select(ids: readonly NodeId[]): void;
  toggleSelected(id: NodeId): void;
  setHover(id: NodeId | null): void;
  setTool(tool: Tool): void;
  setViewport(viewport: Viewport): void;
  setCollapsed(id: NodeId, collapsed: boolean): void;
  setEditingText(id: NodeId | null): void;
  setCodeOpen(open: boolean): void;
  setLayersOpen(open: boolean): void;
  setSpacePressed(pressed: boolean): void;
  setSaveState(status: SaveStatus, savedRevision?: number, location?: string): void;
}

function existing(doc: DesignDocument, ids: readonly NodeId[]): NodeId[] {
  return ids.filter((id) => doc.nodes[id]);
}

export const useEditor = create<EditorState>()((set, get) => ({
  doc: starterDocument(),
  history: EMPTY_HISTORY,
  tx: null,
  revision: 0,
  savedRevision: 0,
  saveStatus: 'idle',
  storageLocation: '',
  selection: [],
  hoverId: null,
  editingTextId: null,
  tool: { kind: 'select' },
  viewport: { x: 80, y: 80, zoom: 1 },
  collapsed: {},
  codeOpen: false,
  layersOpen: true,
  spacePressed: false,

  apply(label, recipe, options = {}) {
    const { doc, selection, history, tx, revision } = get();
    if (tx) return; // a gesture owns the document until it commits
    const next = recipe(doc);
    const nextSelection = options.select ? existing(next, options.select) : existing(next, selection);
    if (next === doc) {
      if (options.select) set({ selection: nextSelection });
      return;
    }
    set({
      doc: next,
      history: record(history, { doc, selection, label }, options.coalesce ?? null, Date.now()),
      selection: nextSelection,
      revision: revision + 1,
    });
  },

  begin() {
    const { doc, selection } = get();
    set({ tx: { base: doc, selection } });
  },

  preview(recipe) {
    const { tx, revision } = get();
    if (!tx) return;
    set({ doc: recipe(tx.base), revision: revision + 1 });
  },

  commit(label, select) {
    const { tx, doc, history, selection } = get();
    if (!tx) return;
    const nextSelection = select ? existing(doc, select) : existing(doc, selection);
    if (doc === tx.base) {
      set({ tx: null, selection: nextSelection });
      return;
    }
    set({
      tx: null,
      history: record(history, { doc: tx.base, selection: tx.selection, label }, null, Date.now()),
      selection: nextSelection,
    });
  },

  cancel() {
    const { tx, revision } = get();
    if (tx) set({ doc: tx.base, tx: null, revision: revision + 1 });
  },

  undo() {
    const { history, doc, selection, tx, revision } = get();
    if (tx) return;
    const result = undo(history, { doc, selection, label: '' });
    if (!result) return;
    set({ doc: result.snapshot.doc, selection: existing(result.snapshot.doc, result.snapshot.selection), history: result.history, revision: revision + 1, editingTextId: null });
  },

  redo() {
    const { history, doc, selection, tx, revision } = get();
    if (tx) return;
    const result = redo(history, { doc, selection, label: '' });
    if (!result) return;
    set({ doc: result.snapshot.doc, selection: existing(result.snapshot.doc, result.snapshot.selection), history: result.history, revision: revision + 1, editingTextId: null });
  },

  load(doc, view = {}) {
    const collapsed: Record<NodeId, true> = {};
    for (const id of view.collapsed ?? []) collapsed[id] = true;
    set((s) => ({
      doc,
      history: EMPTY_HISTORY,
      tx: null,
      revision: s.revision + 1,
      savedRevision: s.revision + 1,
      selection: [],
      hoverId: null,
      editingTextId: null,
      collapsed,
      ...(view.viewport ? { viewport: view.viewport } : {}),
    }));
  },

  select(ids) {
    set({ selection: existing(get().doc, ids) });
  },
  toggleSelected(id) {
    const { selection } = get();
    set({ selection: selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id] });
  },
  setHover(id) {
    if (get().hoverId !== id) set({ hoverId: id });
  },
  setTool(tool) {
    set({ tool });
  },
  setViewport(viewport) {
    set({ viewport });
  },
  setCollapsed(id, collapsed) {
    const next = { ...get().collapsed };
    if (collapsed) next[id] = true;
    else delete next[id];
    set({ collapsed: next });
  },
  setEditingText(id) {
    set({ editingTextId: id });
  },
  setCodeOpen(open) {
    set({ codeOpen: open });
  },
  setLayersOpen(open) {
    set({ layersOpen: open });
  },
  setSpacePressed(pressed) {
    if (get().spacePressed !== pressed) set({ spacePressed: pressed });
  },
  setSaveState(status, savedRevision, location) {
    set((s) => ({ saveStatus: status, savedRevision: savedRevision ?? s.savedRevision, storageLocation: location ?? s.storageLocation }));
  },
}));

export function editorMeta(state: EditorState) {
  return { viewport: state.viewport, collapsed: Object.keys(state.collapsed) };
}
