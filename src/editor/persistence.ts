/**
 * Autosave and external-change sync. The design files are the source of truth: edits are
 * written back shortly after they happen, and edits made to the files by anything else
 * (an editor, git checkout, a coding agent) are loaded in as an undoable change.
 */
import { parseProject, serializeProject, type ProjectFiles } from '../serialization';
import { connectWorkspace, type ProjectStorage } from '../serialization/storage';
import { setTitle } from '../document/ops';
import { starterDocument } from '../elements/insertables';
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

export interface OpenedProject {
  readonly found: boolean;
  /** Whether a saved viewport was restored (otherwise the caller should frame the artboards). */
  readonly restoredViewport: boolean;
  /** Stop syncing. Pending edits are flushed first. */
  stop(): void;
}

/** Open a project into the editor and keep it in sync with its files. */
export async function openProject(id: string): Promise<OpenedProject> {
  const workspace = await connectWorkspace();
  const project = workspace.open(id);
  const files = await project.load();
  if (!files) return { found: false, restoredViewport: false, stop: () => {} };

  const { doc, meta } = parseProject(files);
  useEditor.getState().load(doc, { viewport: meta.viewport, collapsed: meta.collapsed });
  storage = project;
  lastWritten = files;
  useEditor.getState().setSaveState('saved', useEditor.getState().revision, project.location);

  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.revision !== prev.revision || (prev.tx && !s.tx)) schedule();
  });
  const offExternal = project.onExternalChange(applyExternal);
  const stop = () => {
    unsubscribe();
    offExternal();
    clearTimeout(timer);
    // Serializes synchronously, so the flushed content is this project's even if another opens next.
    void saveNow().finally(() => {
      if (storage === project) storage = null;
    });
  };
  return { found: true, restoredViewport: !!meta.viewport, stop };
}

/** Create a project with one empty artboard; resolves with its id. */
export async function createProject(title = 'Untitled'): Promise<string> {
  const workspace = await connectWorkspace();
  const files = serializeProject(setTitle(starterDocument(), title), { viewport: null, collapsed: [] });
  return workspace.create(title, files);
}
