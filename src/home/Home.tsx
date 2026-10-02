/**
 * Home: the workspace's files, most recently edited first. Each file is a folder on disk;
 * its name is the document's <title> and its thumbnail is the design itself.
 */
import { Clock, Cloud, FileUp, Folder, Layers3, LayoutGrid, List, LogOut, Minus, Plus, Search } from 'lucide-react';
import { useAccount } from '../auth/AuthGate.tsx';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import { fileHref, linkClick, navigate } from '../app/router.ts';
import type { DesignDocument } from '../document/types.ts';
import { createProject } from '../editor/persistence.ts';
import { STYLES_FILE, TOKENS_FILE, parseProject } from '../serialization/index.ts';
import { browserFiles, connectWorkspace, type ProjectSummary, type Workspace } from '../serialization/storage.ts';
import { DropOverlay, ImportDialog, isFigmaFile, useFileDrop, type ImportState } from './FigmaImport.tsx';
import { Thumbnail } from './Thumbnail.tsx';
import { editedAgo } from './time.ts';
import './home.css';

type View = 'grid' | 'list';

interface FileEntry {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly doc: DesignDocument;
  readonly css: string;
  /** Where the project's assets/ are served from (thumbnails resolve images against it). */
  readonly base: string | null;
}

const VIEW_KEY = 'plastic:home-view';
const CARD_KEY = 'plastic:home-local-card-dismissed';

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
    return { id: summary.id, title: doc.title || summary.id, updatedAt: summary.updatedAt, doc, css, base: workspace.assetBase(summary.id) };
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

export function Home() {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [location, setLocation] = useState('workspace');
  const [kind, setKind] = useState<Workspace['kind']>('disk');
  const [browserCount, setBrowserCount] = useState(0);
  const [moving, setMoving] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(() => (readPref(VIEW_KEY) === 'list' ? 'list' : 'grid'));
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' });
  const [canImport, setCanImport] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const now = useNow();

  const refresh = useCallback(async () => {
    const workspace = await connectWorkspace();
    setLocation(workspace.location);
    setKind(workspace.kind);
    if (workspace.kind === 'cloud') setBrowserCount((await browserFiles.list()).length);
    setCanImport(!!workspace.importFigma);
    const list = await workspace.list();
    setFiles(list.map((p) => toEntry(p, workspace)).filter((f): f is FileEntry => f !== null));
  }, []);

  useEffect(() => {
    document.title = 'Plastic';
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (files ?? []).filter((f) => !q || f.title.toLowerCase().includes(q) || f.id.includes(q));
  }, [files, query]);

  const newFile = async () => {
    if (creating) return;
    setCreating(true);
    try {
      navigate(fileHref(await createProject()));
    } finally {
      setCreating(false);
    }
  };

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
      setSelected(result.id);
      setImportState({ status: 'done', result });
      void refresh();
    } catch (error) {
      setImportState({ status: 'error', name: file.name, message: error instanceof Error ? error.message : String(error) });
    }
  };
  const dragging = useFileDrop(canImport && importState.status !== 'importing', (file) => void importFile(file));

  /** Click selects a file; double-click (or Enter) opens it. Modifier clicks keep link behavior. */
  const cardProps = (id: string) => ({
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      setSelected(id);
    },
    onDoubleClick: () => navigate(fileHref(id)),
    onKeyDown: (e: ReactKeyboardEvent<HTMLAnchorElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigate(fileHref(id));
      }
    },
    onFocus: () => setSelected(id),
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

  return (
    <div className="home">
      <Sidebar location={location} kind={kind} query={query} onQuery={setQuery} searchRef={searchRef} />
      <main className="home-main">
        <header className="home-header">
          <div className="home-header-inner">
            <h1 className="home-title">{query.trim() ? 'Search' : 'Recents'}</h1>
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
          </div>
        </header>

        <section className="home-files" aria-label="Files" onClick={() => setSelected(null)}>
          <div className="home-files-inner">
            {kind === 'cloud' && browserCount > 0 && (
              <div className="home-move">
                <span>
                  {browserCount === 1 ? '1 file is' : `${browserCount} files are`} saved only in this browser. Move {browserCount === 1 ? 'it' : 'them'} to your account to keep {browserCount === 1 ? 'it' : 'them'} everywhere.
                </span>
                <button type="button" className="home-import" disabled={moving} onClick={(e) => (e.stopPropagation(), void moveBrowserFiles())}>
                  {moving ? 'Moving…' : 'Move to my account'}
                </button>
              </div>
            )}
            {files === null ? null : visible.length === 0 ? (
              <EmptyState searching={!!query.trim()} onNew={() => void newFile()} />
            ) : view === 'grid' ? (
              <div className="home-grid">
                {visible.map((f) => (
                  <a key={f.id} className={`home-card${selected === f.id ? ' is-selected' : ''}`} href={fileHref(f.id)} {...cardProps(f.id)}>
                    <div className="home-card-meta">
                      <span className="home-card-title">{f.title}</span>
                      <span className="home-card-subtitle">{editedAgo(f.updatedAt, now)}</span>
                    </div>
                    <Thumbnail doc={f.doc} css={f.css} base={f.base} />
                  </a>
                ))}
              </div>
            ) : (
              <div className="home-list" role="list">
                {visible.map((f) => (
                  <a key={f.id} role="listitem" className={`home-row${selected === f.id ? ' is-selected' : ''}`} href={fileHref(f.id)} {...cardProps(f.id)}>
                    <span className="home-row-thumb">
                      <Thumbnail doc={f.doc} css={f.css} base={f.base} />
                    </span>
                    <span className="home-row-title">{f.title}</span>
                    <span className="home-row-path">{kind === 'disk' ? `${location}/${f.id}` : location}</span>
                    <span className="home-row-time">{editedAgo(f.updatedAt, now)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>
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

function Sidebar({ location, kind, query, onQuery, searchRef }: { location: string; kind: Workspace['kind']; query: string; onQuery(q: string): void; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const [cardDismissed, setCardDismissed] = useState(() => readPref(CARD_KEY) === '1');
  const account = useAccount();
  return (
    <aside className="home-sidebar">
      <div className="home-sidebar-top">
        <div className="home-account">
          <span className="home-avatar" aria-hidden="true">
            <Layers3 size={13} strokeWidth={2} />
          </span>
          <span className="home-account-name" title={account?.email}>
            {account?.name || 'Plastic'}
          </span>
          {account && (
            <button type="button" className="home-sign-out" title="Sign out" aria-label="Sign out" onClick={() => void account.signOut()}>
              <LogOut size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>

        <nav aria-label="Workspace">
          <label className="home-search">
            <Search size={13} strokeWidth={1.75} className="home-search-icon" />
            <input ref={searchRef} type="search" placeholder="Search" aria-label="Search files" value={query} onChange={(e) => onQuery(e.target.value)} />
            <kbd className="home-search-kbd">⌘F</kbd>
          </label>
          <a className="home-nav-item is-active" href="/" aria-current="page" onClick={linkClick}>
            <Clock size={15} strokeWidth={1.5} />
            Recents
          </a>

          <div className="home-divider" />

          {kind === 'cloud' ? (
            <>
              <div className="home-nav-heading" title="Saved to your Plastic account">
                <Cloud size={15} strokeWidth={1.5} />
                Your files
              </div>
              <div className="home-nav-path">Saved to your account</div>
            </>
          ) : (
            <>
              <div className="home-nav-heading" title={kind === 'disk' ? `Files are folders in ${location}/` : 'Saved in this browser'}>
                <Folder size={15} strokeWidth={1.5} />
                {kind === 'disk' ? 'Local workspace' : 'This browser'}
              </div>
              <div className="home-nav-path">{kind === 'disk' ? `${location}/` : 'Saved in this browser only'}</div>
            </>
          )}

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
    </aside>
  );
}

function EmptyState({ searching, onNew }: { searching: boolean; onNew(): void }) {
  return (
    <div className="home-empty">
      {searching ? (
        <p>No files match your search.</p>
      ) : (
        <>
          <p>No files yet.</p>
          <button type="button" className="home-new" onClick={onNew}>
            <Plus size={12} strokeWidth={2} />
            New file
          </button>
        </>
      )}
    </div>
  );
}
