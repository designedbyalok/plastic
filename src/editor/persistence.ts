/**
 * Autosave and external-change sync. The design files are the source of truth: edits are
 * written back shortly after they happen, and edits made to the files by anything else
 * (an editor, git checkout, a coding agent) are loaded in as an undoable change.
 */
import { parseProject, serializeProject, type ProjectFiles } from '../serialization';
import { connectStorage, type ProjectStorage } from '../serialization/storage';
import { editorMeta, useEditor } from './store';

const AUTOSAVE_MS = 400;

let storage: ProjectStorage | null = null;
let lastWritten: ProjectFiles | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function same(a: ProjectFiles, b: ProjectFiles | null): boolean {
  return !!b && a.html === b.html && a.css === b.css && a.project === b.project;
}

function schedule(delay = AUTOSAVE_MS): void {
  clearTimeout(timer);
  timer = setTimeout(() => void saveNow(), delay);
}

export async function saveNow(): Promise<void> {
  const state = useEditor.getState();
  if (!storage) return;
  if (state.tx || state.editingTextId) return schedule();
  const files = serializeProject(state.doc, editorMeta(state));
  const revision = state.revision;
  if (same(files, lastWritten)) {
    state.setSaveState('saved', revision);
    return;
  }
  state.setSaveState('saving');
  try {
    await storage.save(files);
    lastWritten = files;
    useEditor.getState().setSaveState('saved', revision);
  } catch (error) {
    console.error(error);
    useEditor.getState().setSaveState('error');
  }
}

function applyExternal(files: ProjectFiles): void {
  const state = useEditor.getState();
  if (state.tx) return;
  try {
    const { doc } = parseProject(files);
    lastWritten = files;
    state.apply('External change', (current) => ({ ...doc, frames: { ...current.frames, ...doc.frames } }));
    useEditor.getState().setSaveState('saved', useEditor.getState().revision);
  } catch (error) {
    console.error('Could not load external change', error);
  }
}

/** Open the project and keep it in sync. Resolves with whether a saved viewport was restored. */
export async function startPersistence(): Promise<{ stop: () => void; restoredViewport: boolean }> {
  storage = await connectStorage();
  const files = await storage.load();
  const store = useEditor.getState();
  let restoredViewport = false;
  if (files) {
    try {
      const { doc, meta } = parseProject(files);
      store.load(doc, { viewport: meta.viewport, collapsed: meta.collapsed });
      restoredViewport = !!meta.viewport;
      lastWritten = files;
    } catch (error) {
      console.error('Could not open project, starting fresh', error);
    }
  }
  useEditor.getState().setSaveState(files ? 'saved' : 'idle', useEditor.getState().revision, storage.location);
  if (!files) schedule(0);

  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.revision !== prev.revision || (prev.tx && !s.tx)) schedule();
  });
  const offExternal = storage.onExternalChange(applyExternal);
  const stop = () => {
    unsubscribe();
    offExternal();
    clearTimeout(timer);
  };
  return { stop, restoredViewport };
}
