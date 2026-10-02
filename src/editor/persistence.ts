/**
 * Autosave and external-change sync. The design files are the source of truth: edits are
 * written back shortly after they happen, and edits made to the files by anything else
 * (an editor, git checkout, a coding agent) are loaded in as an undoable change.
 */
import { parseProject, serializeProject, type ProjectFiles } from '../serialization/index.ts';
import { connectWorkspace, type ProjectStorage } from '../serialization/storage.ts';
import { setTitle } from '../document/ops.ts';
import { starterDocument } from '../elements/insertables.ts';
import { ProjectSync } from './projectSync.ts';
import { finishTextEditing } from '../canvas/textEditing.ts';
import { editorMeta, useEditor } from './store.ts';

const AUTOSAVE_MS = 400;
/** However long the storage waits, a long editing session still saves at least this often. */
const MAX_SAVE_WAIT_MS = 10_000;

let storage: ProjectStorage | null = null;
let sync: ProjectSync | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let firstPending = 0;
let opening = 0;

function schedule(delay = storage?.saveDelayMs ?? AUTOSAVE_MS): void {
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

export async function saveNow(): Promise<void> {
  const state = useEditor.getState();
  if (!sync) return;
  if (state.tx || state.editingTextId) return schedule();
  try {
    await sync.save();
  } catch (error) {
    console.error(error);
  }
}

export interface OpenedProject {
  readonly found: boolean;
  /** Whether a saved viewport was restored (otherwise the caller should frame the artboards). */
  readonly restoredViewport: boolean;
  /** Stop syncing. Pending edits are flushed first. */
  stop(): void;
}

/** Open a project into the editor and keep it in sync with its files. */
export async function openProject(id: string): Promise<OpenedProject> {
  const ticket = ++opening;
  const workspace = await connectWorkspace();
  const project = workspace.open(id);
  const files = await project.load();
  if (!files || ticket !== opening) return { found: false, restoredViewport: false, stop: () => {} };
  const { doc, meta } = parseProject(files);
  useEditor.getState().load(doc, { viewport: meta.viewport, collapsed: meta.collapsed, activePage: meta.activePage });
  storage = project;
  useEditor.setState({ assetBase: project.assetBase });
  useEditor.getState().setSaveState('saved', useEditor.getState().revision, project.location);
  const normalized = (input: ProjectFiles) => {
    const parsed = parseProject(input);
    return serializeProject(parsed.doc, parsed.meta);
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
        useEditor.getState().apply('External change', () => parsed.doc);
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
    document.removeEventListener('visibilitychange', onHide);
    if (sync !== coordinator) return;
    clearTimeout(timer);
    firstPending = 0;
    finishTextEditing(true);
    if (useEditor.getState().tx) useEditor.getState().commit('Finish edit');
    void coordinator.save().catch(console.error);
    coordinator.close();
    sync = null;
    storage = null;
  };
  return { found: true, restoredViewport: !!meta.viewport, stop };
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
  if (!storage) return null;
  await saveNow();
  const state = useEditor.getState();
  const title = `${state.doc.title || 'Untitled'} copy`;
  const files = serializeProject(setTitle(state.doc, title), editorMeta(state));
  const workspace = await connectWorkspace();
  return workspace.create(title, files, { assetsFrom: storage.id });
}
