/**
 * Autosave and external-change sync. The design files are the source of truth: edits are
 * written back shortly after they happen, and edits made to the files by anything else
 * (an editor, git checkout, a coding agent) are loaded in as an undoable change.
 */
import { parseProject, serializeProject, sameFiles, type ProjectFiles } from '../serialization/index.ts';
import { connectWorkspace, type ProjectStorage } from '../serialization/storage.ts';
import { setTitle } from '../document/ops.ts';
import { bundledFontsReady, loadInterFont } from '../document/fonts.ts';
import { starterDocument } from '../elements/insertables.ts';
import { ProjectSync } from './projectSync.ts';
import { finishTextEditing } from '../canvas/textEditing.ts';
import { captureThumbnail, thumbnailSource } from './thumbnail.ts';
import { editorMeta, useEditor } from './store.ts';
import { connectPresence } from './presence.ts';

const AUTOSAVE_MS = 400;
/** However long the storage waits, a long editing session still saves at least this often. */
const MAX_SAVE_WAIT_MS = 10_000;

let storage: ProjectStorage | null = null;
let sync: ProjectSync | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let firstPending = 0;
let opening = 0;

function schedule(delay = storage?.saveDelayMs ?? AUTOSAVE_MS): void {
  if (storage?.readOnly) return;
  clearTimeout(timer);
  const now = Date.now();
  if (!firstPending) firstPending = now;
  timer = setTimeout(
    () => {
      timer = undefined;
      firstPending = 0;
      void saveNow();
    },
    Math.max(0, Math.min(delay, firstPending + MAX_SAVE_WAIT_MS - now)),
  );
}

/** Before reloading the page (e.g. to update): finish text editing and any gesture, then save. */
export async function flushForReload(): Promise<void> {
  if (!sync || storage?.readOnly) return;
  finishTextEditing(true);
  if (useEditor.getState().tx) useEditor.getState().commit('Finish edit');
  await saveNow({ requirePersisted: true });
}

export async function saveNow({ requirePersisted = false }: { requirePersisted?: boolean } = {}): Promise<void> {
  const state = useEditor.getState();
  const savingStorage = storage;
  const savingSync = sync;
  if (!sync || storage?.readOnly) return;
  if (state.tx || state.editingTextId) {
    if (requirePersisted) throw new Error('Finish editing before reloading.');
    return schedule();
  }
  try {
    if (state.doc.thumbnail && state.doc.nodes[state.doc.thumbnail.frame]) {
      const { frame } = state.doc.thumbnail;
      const hash = await thumbnailSource(state.doc, frame);
      if (hash !== state.doc.thumbnail.source) {
        try {
          const thumbnail = await captureThumbnail(state.doc, frame, state.assetBase);
          const current = useEditor.getState();
          const unchanged = current.doc.nodes[frame] && await thumbnailSource(current.doc, frame) === hash;
          const latest = useEditor.getState();
          if (storage === savingStorage && unchanged && latest.doc === current.doc && !latest.tx && !latest.editingTextId && latest.doc.thumbnail?.frame === frame) {
            // The image is derived data. Refresh it without adding a separate undo step.
            useEditor.setState({ doc: { ...latest.doc, thumbnail }, revision: latest.revision + 1 });
          }
        } catch (error) { console.error('Could not refresh the file thumbnail', error); }
      }
    }
    if (sync === savingSync) {
      if (requirePersisted) await savingSync!.flush();
      else await savingSync?.save();
    } else if (requirePersisted) throw new Error('The open file changed. Try updating again.');
  } catch (error) {
    if (requirePersisted) throw error;
    console.error(error);
  }
}

export interface OpenedProject {
  readonly found: boolean;
  /** Whether a saved viewport was restored (otherwise the caller should frame the artboards). */
  readonly restoredViewport: boolean;
  /** Opened through its shared link by someone else: view-only. */
  readonly readOnly: boolean;
  /** Stop syncing. Pending edits are flushed first. */
  stop(): void;
}

/** Open a project into the editor and keep it in sync with its files. */
export async function openProject(id: string): Promise<OpenedProject> {
  const ticket = ++opening;
  const workspace = await connectWorkspace();
  // A shared link (?preview=) opens someone else's file read-only, or your own as usual.
  const previewId = new URL(location.href).searchParams.get('preview');
  const project = (previewId && workspace.openShared ? await workspace.openShared(id, previewId) : null) ?? workspace.open(id);
  const files = await project.load();
  await bundledFontsReady;
  if (!files || ticket !== opening) return { found: false, restoredViewport: false, readOnly: false, stop: () => {} };
  const readOnly = project.readOnly === true;
  useEditor.getState().setReadOnly(readOnly);
  const parsedFile = parseProject(files);
  const { meta } = parsedFile;
  const doc = loadInterFont(parsedFile.doc);
  useEditor.getState().load(doc, { viewport: meta.viewport, collapsed: meta.collapsed, activePage: meta.activePage });
  storage = project;
  useEditor.setState({ assetBase: project.assetBase });
  useEditor.getState().setSaveState('saved', useEditor.getState().revision, project.location);
  const normalized = (input: ProjectFiles) => {
    // Canonicalize actual disk bytes without treating propagated instances as already saved.
    const options = { syncComponents: false };
    const parsed = parseProject(input, options);
    return serializeProject(parsed.doc, parsed.meta, options);
  };
  let applying = false;
  const coordinator = new ProjectSync(project, normalized(files), {
    normalize: normalized,
    dirty: () => {
      if (sync === coordinator) schedule();
    },
    read: () => {
      const state = useEditor.getState();
      return {
        files: serializeProject(state.doc, editorMeta(state)),
        revision: state.revision,
        busy: !!state.tx || !!state.editingTextId,
      };
    },
    apply: (incoming) => {
      if (sync !== coordinator) return;
      applying = true;
      try {
        const parsed = parseProject(incoming);
        useEditor.getState().apply('External change', () => loadInterFont(parsed.doc), { remote: true });
      } finally {
        applying = false;
      }
      schedule();
    },
    status: (status, revision) => {
      if (sync === coordinator) useEditor.getState().setSaveState(status, revision);
    },
  });
  sync = coordinator;
  void updateShareLink().catch(console.error);
  if (!readOnly && !sameFiles(normalized(files), serializeProject(doc, meta))) {
    useEditor.getState().setSaveState('saving', useEditor.getState().revision - 1);
    schedule(0);
  }
  const unsubscribe = useEditor.subscribe((state, previous) => {
    if (applying) return;
    if ((previous.tx && !state.tx) || (previous.editingTextId && !state.editingTextId)) coordinator.drain();
    if (
      state.revision !== previous.revision ||
      (previous.tx && !state.tx) ||
      (previous.editingTextId && !state.editingTextId)
    )
      schedule();
  });
  // Before the live connection opens, so the room's greeting isn't missed.
  const offPresence = project.presence ? connectPresence(project.presence) : () => {};
  const offExternal = project.onExternalChange((incoming) => {
    try {
      coordinator.receive(normalized(incoming));
    } catch (error) {
      console.error('Could not load external change', error);
    }
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer);
      firstPending = 0;
      void saveNow();
    }
  };
  document.addEventListener('visibilitychange', onHide);
  const stop = () => {
    unsubscribe();
    offExternal();
    offPresence();
    document.removeEventListener('visibilitychange', onHide);
    if (sync !== coordinator) return;
    clearTimeout(timer);
    firstPending = 0;
    finishTextEditing(true);
    if (useEditor.getState().tx) useEditor.getState().commit('Finish edit');
    if (!readOnly) void coordinator.save().catch(console.error);
    coordinator.close();
    sync = null;
    storage = null;
    useEditor.getState().setReadOnly(false);
  };
  return { found: true, restoredViewport: !!meta.viewport, readOnly, stop };
}

/** Create a project with one empty artboard; resolves with its id. */
export async function createProject(title = 'Untitled', folderId: string | null = null): Promise<string> {
  const workspace = await connectWorkspace();
  const files = serializeProject(setTitle(starterDocument(), title), {
    viewport: null,
    collapsed: [],
    activePage: null,
  });
  return workspace.create(title, files, { folderId });
}

/** Save the open project as a new file (with its assets); returns the new id. */
export async function duplicateOpenProject(): Promise<string | null> {
  if (!storage || storage.readOnly) return null;
  await saveNow();
  const state = useEditor.getState();
  const title = `${state.doc.title || 'Untitled'} copy`;
  const files = serializeProject(setTitle(state.doc, title), editorMeta(state));
  const workspace = await connectWorkspace();
  return workspace.create(title, files, { assetsFrom: storage.id });
}

/** Add the account-independent preview identity to links copied or shared from the address bar. */
export async function updateShareLink(): Promise<void> {
  if (!storage?.shareLink) return;
  const project = storage;
  const link = new URL(await project.shareLink!());
  if (storage !== project) return;
  const current = new URL(location.href);
  const preview = link.searchParams.get('preview');
  if (preview) current.searchParams.set('preview', preview);
  else current.searchParams.delete('preview');
  history.replaceState(history.state, '', current.href);
}
