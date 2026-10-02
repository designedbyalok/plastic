/**
 * Home: the person's files. Recents (everything, most recently edited first), Files (organized
 * in folders), the Archive, and their Profile. Each file is a folder of HTML and CSS; its name
 * is the document's <title> and its thumbnail is the design itself.
 */
import { Archive, ArchiveRestore, ChevronRight, Clock, Cloud, FileUp, Folder, FolderInput, FolderPlus, HardDrive, LayoutGrid, List, Minus, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { fileHref, folderHref, linkClick, navigate, type Route } from '../app/router.ts';
import type { DesignDocument } from '../document/types.ts';
import { createProject } from '../editor/persistence.ts';
import { STYLES_FILE, TOKENS_FILE, parseProject } from '../serialization/index.ts';
import { browserFiles, connectWorkspace, type Folder as FolderData, type Profile, type ProjectSummary, type Workspace } from '../serialization/storage.ts';
import { AccountMenu } from './AccountMenu.tsx';
import { DropOverlay, ImportDialog, isFigmaFile, useFileDrop, type ImportState } from './FigmaImport.tsx';
import { MenuDivider, MenuHeading, MenuItem, useDismiss } from './Menu.tsx';
import { ProfileView } from './Profile.tsx';
import { Thumbnail } from './Thumbnail.tsx';
import { editedAgo } from './time.ts';
import './home.css';

type View = 'grid' | 'list';
type HomeRoute = Exclude<Route, { name: 'file' }>;

interface FileEntry {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly doc: DesignDocument;
  readonly css: string;
  /** Where the project's assets/ are served from (thumbnails resolve images against it). */
  readonly base: string | null;
  readonly folderId: string | null;
  readonly archivedAt: number | null;
}

const VIEW_KEY = 'plastic:home-view';
const CARD_KEY = 'plastic:home-local-card-dismissed';
/** Drag type for moving a file card onto a folder (or onto Files / Archive in the sidebar). */
const FILE_DRAG = 'application/x-plastic-file';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // preferences are a convenience only
  }
}

function toEntry(summary: ProjectSummary, workspace: Workspace): FileEntry | null {
  try {
    const { doc } = parseProject(summary.files);
    // Thumbnails render the first page with the project's tokens and styles, in cascade order.
    const css = `${summary.files[TOKENS_FILE] ?? ''}\n${summary.files[STYLES_FILE] ?? ''}`;
    return {
      id: summary.id,
      title: doc.title || summary.id,
      updatedAt: summary.updatedAt,
      doc,
      css,
      base: workspace.assetBase(summary.id),
      folderId: summary.folderId ?? null,
      archivedAt: summary.archivedAt ?? null,
    };
  } catch {
    return null;
  }
}

function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(FILE_DRAG);

export function Home({ route }: { route: HomeRoute }) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [folders, setFolders] = useState<FolderData[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [location, setLocation] = useState('workspace');
  const [kind, setKind] = useState<Workspace['kind']>('disk');
  const [browserCount, setBrowserCount] = useState(0);
  const [moving, setMoving] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(() => (readPref(VIEW_KEY) === 'list' ? 'list' : 'grid'));
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' });
  const [canImport, setCanImport] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const now = useNow();

  const latest = useRef(0);
  const refresh = useCallback(async () => {
    // Refreshes can overlap (an action and a file-watcher event); only the newest one lands.
    const seq = ++latest.current;
    const workspace = await connectWorkspace();
    setLocation(workspace.location);
    setKind(workspace.kind);
    setCanImport(!!workspace.importFigma);
    const [list, folderList, person] = await Promise.all([workspace.list(), workspace.folders().catch(() => []), workspace.profile().catch(() => null)]);
    if (seq !== latest.current) return;
    setFiles(list.map((p) => toEntry(p, workspace)).filter((f): f is FileEntry => f !== null));
    setFolders(folderList);
    setProfile(person);
    if (workspace.kind === 'cloud') setBrowserCount((await browserFiles.list()).length);
  }, []);

  useEffect(() => {
    void refresh();
    let off = () => {};
    void connectWorkspace().then((workspace) => {
      off = workspace.onChange(() => void refresh());
    });
    return () => off();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const folderId = route.name === 'files' ? route.folderId : null;
  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;
  const searching = !!query.trim();

  useEffect(() => {
    document.title = route.name === 'profile' ? 'Profile — Plastic' : route.name === 'archive' ? 'Archive — Plastic' : folder ? `${folder.name} — Plastic` : 'Plastic';
  }, [route.name, folder]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = files ?? [];
    const matches = (f: FileEntry) => !q || f.title.toLowerCase().includes(q) || f.id.includes(q);
    // Search looks through every file that isn't archived, wherever it's filed.
    if (q && route.name !== 'archive') return all.filter((f) => !f.archivedAt && matches(f));
    if (route.name === 'archive') return all.filter((f) => f.archivedAt && matches(f)).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
    if (route.name === 'files') return all.filter((f) => !f.archivedAt && f.folderId === folderId);
    return all.filter((f) => !f.archivedAt);
  }, [files, query, route.name, folderId]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of files ?? []) if (!f.archivedAt && f.folderId) map.set(f.folderId, (map.get(f.folderId) ?? 0) + 1);
    return map;
  }, [files]);

  const run = async (fn: (w: Workspace) => Promise<unknown>) => {
    const workspace = await connectWorkspace();
    try {
      await fn(workspace);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
    await refresh();
  };

  const newFile = async () => {
    if (creating) return;
    setCreating(true);
    try {
      navigate(fileHref(await createProject('Untitled', route.name === 'files' ? folderId : null)));
    } finally {
      setCreating(false);
    }
  };

  const newFolder = () =>
    void run(async (w) => {
      const created = await w.createFolder('Untitled folder');
      setRenaming(created.id);
    });

  const importFile = async (file: File) => {
    if (importState.status === 'importing') return;
    if (!isFigmaFile(file)) {
      setImportState({ status: 'error', name: file.name, message: 'Only Figma .fig files can be imported. In Figma, use File → Save local copy… to get one.' });
      return;
    }
    const workspace = await connectWorkspace();
    if (!workspace.importFigma) {
      setImportState({ status: 'error', name: file.name, message: 'Sign in to import Figma files, or run Plastic locally (bun run dev).' });
      return;
    }
    setImportState({ status: 'importing', name: file.name });
    try {
      const result = await workspace.importFigma(file, (progress) => setImportState({ status: 'importing', name: file.name, progress }));
      if (route.name === 'files' && folderId) await workspace.place(result.id, { folderId });
      setSelected(result.id);
      setImportState({ status: 'done', result });
      void refresh();
    } catch (error) {
      setImportState({ status: 'error', name: file.name, message: error instanceof Error ? error.message : String(error) });
    }
  };
  const dragging = useFileDrop(canImport && importState.status !== 'importing', (file) => void importFile(file));

  /** Click selects a file; double-click (or Enter) opens it. Modifier clicks keep link behavior. */
  const cardProps = (f: FileEntry) => ({
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      setSelected(f.id);
    },
    onDoubleClick: () => !f.archivedAt && navigate(fileHref(f.id)),
    onKeyDown: (e: ReactKeyboardEvent<HTMLAnchorElement>) => {
      if (e.key === 'Enter' && !f.archivedAt) {
        e.preventDefault();
        navigate(fileHref(f.id));
      }
    },
    onFocus: () => setSelected(f.id),
    draggable: !f.archivedAt,
    onDragStart: (e: DragEvent<HTMLAnchorElement>) => {
      e.dataTransfer.setData(FILE_DRAG, f.id);
      e.dataTransfer.effectAllowed = 'move';
      setSelected(f.id);
    },
  });

  /** Copy files saved in this browser (before accounts) into the account, then clear them here. */
  const moveBrowserFiles = async () => {
    if (moving) return;
    setMoving(true);
    try {
      const workspace = await connectWorkspace();
      for (const p of await browserFiles.list()) {
        const title = toEntry(p, workspace)?.title ?? p.id;
        await workspace.create(title, p.files);
        browserFiles.remove(p.id);
      }
    } finally {
      setMoving(false);
      await refresh();
    }
  };

  const changeView = (next: View) => {
    setView(next);
    writePref(VIEW_KEY, next);
  };

  const fileActions = (f: FileEntry) => (
    <FileMenu
      file={f}
      folders={folders}
      onMove={(target) => void run((w) => w.place(f.id, { folderId: target }))}
      onArchive={(archived) => void run((w) => w.place(f.id, { archived }))}
      onDelete={() => {
        if (confirm(`Delete “${f.title}” forever? This can’t be undone.`)) void run((w) => w.deleteProject(f.id));
      }}
    />
  );

  const title = searching ? 'Search' : route.name === 'archive' ? 'Archive' : route.name === 'files' ? 'Files' : route.name === 'profile' ? 'Profile' : 'Recents';

  return (
    <div className="home">
      <Sidebar
        route={route}
        location={location}
        kind={kind}
        profile={profile}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        onDropFile={(id, target) => void run((w) => (target === 'archive' ? w.place(id, { archived: true }) : w.place(id, { folderId: null, archived: false })))}
      />
      <main className="home-main">
        {route.name === 'profile' && !searching ? (
          <section className="home-files" aria-label="Profile">
            <ProfileView profile={profile} onSaved={() => void refresh()} />
          </section>
        ) : (
          <>
            <header className="home-header">
              <div className="home-header-inner">
                <h1 className="home-title">
                  {folder && !searching ? (
                    <span className="home-breadcrumb">
                      <a href={folderHref(null)} onClick={linkClick}>
                        Files
                      </a>
                      <ChevronRight size={16} strokeWidth={1.75} />
                      <span>{folder.name}</span>
                    </span>
                  ) : (
                    title
                  )}
                </h1>
                {route.name !== 'archive' && (
                  <div className="home-actions">
                    {canImport && (
                      <>
                        <button type="button" className="home-import" onClick={() => pickerRef.current?.click()} disabled={importState.status === 'importing'} title="Import a Figma .fig file (or drop it anywhere)">
                          <FileUp size={13} strokeWidth={1.75} />
                          Import
                        </button>
                        <input
                          ref={pickerRef}
                          type="file"
                          accept=".fig"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) void importFile(file);
                          }}
                        />
                      </>
                    )}
                    {route.name === 'files' && !folderId && (
                      <button type="button" className="home-import" onClick={newFolder}>
                        <FolderPlus size={13} strokeWidth={1.75} />
                        New folder
                      </button>
                    )}
                    <button type="button" className="home-new" onClick={() => void newFile()} disabled={creating}>
                      <Plus size={12} strokeWidth={2} />
                      New file
                    </button>
                    <div className="home-view-toggle" role="radiogroup" aria-label="View">
                      {(['grid', 'list'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={view === v}
                          aria-label={v === 'grid' ? 'Grid view' : 'List view'}
                          className={`home-view-option${view === v ? ' is-active' : ''}`}
                          onClick={() => changeView(v)}
                        >
                          {v === 'grid' ? <LayoutGrid size={15} strokeWidth={1.5} /> : <List size={15} strokeWidth={1.5} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </header>

            <section className="home-files" aria-label="Files" onClick={() => setSelected(null)}>
              <div className="home-files-inner">
                {kind === 'cloud' && browserCount > 0 && route.name === 'home' && (
                  <div className="home-move">
                    <span>
                      {browserCount === 1 ? '1 file is' : `${browserCount} files are`} saved only in this browser. Move {browserCount === 1 ? 'it' : 'them'} to your account to keep {browserCount === 1 ? 'it' : 'them'} everywhere.
                    </span>
                    <button type="button" className="home-import" disabled={moving} onClick={(e) => (e.stopPropagation(), void moveBrowserFiles())}>
                      {moving ? 'Moving…' : 'Move to my account'}
                    </button>
                  </div>
                )}

                {route.name === 'files' && !folderId && !searching && folders.length > 0 && (
                  <div className="home-folders">
                    {folders.map((f) => (
                      <FolderTile
                        key={f.id}
                        folder={f}
                        count={counts.get(f.id) ?? 0}
                        renaming={renaming === f.id}
                        onRename={(name) => {
                          setRenaming(null);
                          if (name && name !== f.name) void run((w) => w.renameFolder(f.id, name));
                        }}
                        onStartRename={() => setRenaming(f.id)}
                        onDelete={() => {
                          if (confirm(`Delete the folder “${f.name}”? Its files move back to Files.`)) void run((w) => w.deleteFolder(f.id));
                        }}
                        onDropFile={(id) => void run((w) => w.place(id, { folderId: f.id }))}
                      />
                    ))}
                  </div>
                )}

                {route.name === 'files' && folderId && !folder && files !== null && <p className="home-empty">This folder doesn’t exist anymore.</p>}

                {files === null ? null : visible.length === 0 ? (
                  <EmptyState route={route} searching={searching} hasFolders={folders.length > 0} onNew={() => void newFile()} />
                ) : view === 'grid' ? (
                  <div className="home-grid">
                    {visible.map((f) => (
                      <a key={f.id} className={`home-card${selected === f.id ? ' is-selected' : ''}`} href={fileHref(f.id)} {...cardProps(f)}>
                        <div className="home-card-meta">
                          <span className="home-card-text">
                            <span className="home-card-title">{f.title}</span>
                            <span className="home-card-subtitle">{f.archivedAt ? `Archived ${editedAgo(f.archivedAt, now).replace(/^Edited /, '')}` : editedAgo(f.updatedAt, now)}</span>
                          </span>
                          {fileActions(f)}
                        </div>
                        <Thumbnail doc={f.doc} css={f.css} base={f.base} />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="home-list" role="list">
                    {visible.map((f) => (
                      <a key={f.id} role="listitem" className={`home-row${selected === f.id ? ' is-selected' : ''}`} href={fileHref(f.id)} {...cardProps(f)}>
                        <span className="home-row-thumb">
                          <Thumbnail doc={f.doc} css={f.css} base={f.base} />
                        </span>
                        <span className="home-row-title">{f.title}</span>
                        <span className="home-row-path">{(f.folderId && folders.find((x) => x.id === f.folderId)?.name) || (kind === 'disk' ? `${location}/${f.id}` : location)}</span>
                        <span className="home-row-time">{editedAgo(f.updatedAt, now)}</span>
                        {fileActions(f)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>
      {dragging && <DropOverlay />}
      {importState.status !== 'idle' && (
        <ImportDialog
          state={importState}
          onClose={() => setImportState({ status: 'idle' })}
          onOpen={(id) => {
            setImportState({ status: 'idle' });
            navigate(fileHref(id));
          }}
        />
      )}
    </div>
  );
}

function FileMenu({ file, folders, onMove, onArchive, onDelete }: { file: FileEntry; folders: FolderData[]; onMove(folderId: string | null): void; onArchive(archived: boolean): void; onDelete(): void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const close = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="home-card-actions" ref={ref} onClick={(e) => (e.preventDefault(), e.stopPropagation())} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`home-card-more${open ? ' is-open' : ''}`}
        aria-label={`Actions for ${file.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        draggable={false}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <MoreHorizontal size={15} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="home-menu home-card-menu" role="menu">
          {file.archivedAt ? (
            <>
              <MenuItem icon={<ArchiveRestore size={14} strokeWidth={1.75} />} onSelect={close(() => onArchive(false))}>
                Restore
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<Trash2 size={14} strokeWidth={1.75} />} danger onSelect={close(onDelete)}>
                Delete forever
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem icon={<ChevronRight size={14} strokeWidth={1.75} />} onSelect={close(() => navigate(fileHref(file.id)))}>
                Open
              </MenuItem>
              <MenuDivider />
              <MenuHeading>Move to</MenuHeading>
              <MenuItem icon={<FolderInput size={14} strokeWidth={1.75} />} disabled={!file.folderId} onSelect={close(() => onMove(null))}>
                Files
              </MenuItem>
              {folders.map((f) => (
                <MenuItem key={f.id} icon={<Folder size={14} strokeWidth={1.75} />} disabled={file.folderId === f.id} onSelect={close(() => onMove(f.id))}>
                  {f.name}
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem icon={<Archive size={14} strokeWidth={1.75} />} onSelect={close(() => onArchive(true))}>
                Archive
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FolderTile({
  folder,
  count,
  renaming,
  onRename,
  onStartRename,
  onDelete,
  onDropFile,
}: {
  folder: FolderData;
  count: number;
  renaming: boolean;
  onRename(name: string): void;
  onStartRename(): void;
  onDelete(): void;
  onDropFile(id: string): void;
}) {
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div
      className={`home-folder${over ? ' is-drop' : ''}`}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(FILE_DRAG);
        if (id) {
          e.preventDefault();
          onDropFile(id);
        }
      }}
    >
      {renaming ? (
        <span className="home-folder-link">
          <Folder size={15} strokeWidth={1.5} />
          <input
            className="home-folder-rename"
            autoFocus
            defaultValue={folder.name}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => onRename(e.currentTarget.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') onRename(folder.name);
            }}
          />
        </span>
      ) : (
        <a className="home-folder-link" href={folderHref(folder.id)} onClick={linkClick} onDoubleClick={(e) => (e.preventDefault(), onStartRename())}>
          <Folder size={15} strokeWidth={1.5} />
          <span className="home-folder-name">{folder.name}</span>
          <span className="home-folder-count">{count || ''}</span>
        </a>
      )}
      <div className="home-card-actions" ref={ref}>
        <button type="button" className={`home-card-more${open ? ' is-open' : ''}`} aria-label={`Actions for ${folder.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <MoreHorizontal size={15} strokeWidth={1.75} />
        </button>
        {open && (
          <div className="home-menu home-card-menu" role="menu">
            <MenuItem
              icon={<Pencil size={14} strokeWidth={1.75} />}
              onSelect={() => {
                setOpen(false);
                onStartRename();
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              icon={<Trash2 size={14} strokeWidth={1.75} />}
              danger
              onSelect={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete folder
            </MenuItem>
          </div>
        )}
      </div>
    </div>
  );
}

function Sidebar({
  route,
  location,
  kind,
  profile,
  query,
  onQuery,
  searchRef,
  onDropFile,
}: {
  route: HomeRoute;
  location: string;
  kind: Workspace['kind'];
  profile: Profile | null;
  query: string;
  onQuery(q: string): void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onDropFile(id: string, target: 'files' | 'archive'): void;
}) {
  const [cardDismissed, setCardDismissed] = useState(() => readPref(CARD_KEY) === '1');
  const where = kind === 'cloud' ? { icon: <Cloud size={13} strokeWidth={1.75} />, text: 'Saved to your account' } : kind === 'disk' ? { icon: <HardDrive size={13} strokeWidth={1.75} />, text: `${location}/` } : { icon: <HardDrive size={13} strokeWidth={1.75} />, text: 'Saved in this browser only' };
  return (
    <aside className="home-sidebar">
      <div className="home-sidebar-top">
        <AccountMenu profile={profile} />

        <nav aria-label="Workspace">
          <label className="home-search">
            <Search size={13} strokeWidth={1.75} className="home-search-icon" />
            <input ref={searchRef} type="search" placeholder="Search" aria-label="Search files" value={query} onChange={(e) => onQuery(e.target.value)} />
            <kbd className="home-search-kbd">⌘F</kbd>
          </label>
          <NavItem href="/" active={route.name === 'home'} icon={<Clock size={15} strokeWidth={1.5} />}>
            Recents
          </NavItem>

          <div className="home-divider" />

          <NavItem href="/files" active={route.name === 'files'} icon={<Folder size={15} strokeWidth={1.5} />} onDropFile={(id) => onDropFile(id, 'files')}>
            Files
          </NavItem>
          <NavItem href="/archive" active={route.name === 'archive'} icon={<Archive size={15} strokeWidth={1.5} />} onDropFile={(id) => onDropFile(id, 'archive')}>
            Archive
          </NavItem>

          {!cardDismissed && (
            <div className="home-card-note">
              <div className="home-card-note-title">Your files are plain HTML</div>
              <div className="home-card-note-body">
                Each file is a folder of HTML pages and CSS. Open it in any editor, or commit it to Git.
              </div>
              <button
                type="button"
                className="home-card-note-dismiss"
                aria-label="Dismiss"
                onClick={() => {
                  setCardDismissed(true);
                  writePref(CARD_KEY, '1');
                }}
              >
                <Minus size={12} strokeWidth={1.5} />
              </button>
            </div>
          )}
        </nav>
      </div>
      <div className="home-sidebar-bottom" title={kind === 'disk' ? `Files are folders in ${location}/` : where.text}>
        {where.icon}
        <span>{where.text}</span>
      </div>
    </aside>
  );
}

function NavItem({ href, active, icon, children, onDropFile }: { href: string; active: boolean; icon: ReactNode; children: ReactNode; onDropFile?(id: string): void }) {
  const [over, setOver] = useState(false);
  return (
    <a
      className={`home-nav-item${active ? ' is-active' : ''}${over ? ' is-drop' : ''}`}
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={linkClick}
      onDragOver={(e) => {
        if (!onDropFile || !isFileDrag(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(FILE_DRAG);
        if (id && onDropFile) {
          e.preventDefault();
          onDropFile(id);
        }
      }}
    >
      {icon}
      {children}
    </a>
  );
}

function EmptyState({ route, searching, hasFolders, onNew }: { route: HomeRoute; searching: boolean; hasFolders: boolean; onNew(): void }) {
  if (searching) return <p className="home-empty">No files match your search.</p>;
  if (route.name === 'archive') return <p className="home-empty">Nothing archived. Archived files leave Recents and Files until you restore them.</p>;
  if (route.name === 'files' && route.folderId) return <p className="home-empty">This folder is empty. Drag files onto it, or use a file’s ⋯ menu to move it here.</p>;
  if (route.name === 'files' && hasFolders) return null;
  return (
    <div className="home-empty">
      <p>No files yet.</p>
      <button type="button" className="home-new" onClick={onNew}>
        <Plus size={12} strokeWidth={2} />
        New file
      </button>
    </div>
  );
}
