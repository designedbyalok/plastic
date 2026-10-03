/**
 * Figma import on the home screen: drop a .fig anywhere (or pick one), the dev server converts it
 * into a Plastic file, and a report lists what came across — pages, layers, images, tokens — and
 * which fonts aren't installed on this machine.
 */
import { CircleCheck, FileUp, Loader2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isFontAvailable } from '../app/fonts.ts';
import type { FigmaImportResult } from '../serialization/storage.ts';

export type ImportState =
  | { readonly status: 'idle' }
  | { readonly status: 'importing'; readonly name: string; readonly progress?: string }
  | { readonly status: 'done'; readonly result: FigmaImportResult }
  | { readonly status: 'error'; readonly name: string; readonly message: string };

export function isFigmaFile(file: File): boolean {
  return /\.fig$/i.test(file.name);
}

/** Watches the window for files dragged in; `onFile` receives the dropped .fig. */
export function useFileDrop(enabled: boolean, onFile: (file: File) => void): boolean {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onFile);
  handler.current = onFile;

  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const overHandler = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const file = e.dataTransfer!.files[0];
      if (file) handler.current(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overHandler);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overHandler);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [enabled]);

  return over;
}

export function DropOverlay() {
  return (
    <div className="import-drop" aria-hidden="true">
      <div className="import-drop-box">
        <FileUp size={22} strokeWidth={1.5} />
        <div className="import-drop-title">Drop a Figma File to Import</div>
        <div className="import-drop-hint">.fig files become Plastic files: pages, frames, auto layout, text and images stay editable.</div>
      </div>
    </div>
  );
}

const number = new Intl.NumberFormat();

function plural(n: number, word: string): string {
  return `${number.format(n)} ${word}${n === 1 ? '' : 's'}`;
}

export function ImportDialog({ state, onClose, onOpen }: { state: Exclude<ImportState, { status: 'idle' }>; onClose(): void; onOpen(id: string): void }) {
  useEffect(() => {
    if (state.status === 'importing') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.status, onClose]);

  return (
    <div className="import-backdrop" onPointerDown={(e) => e.target === e.currentTarget && state.status !== 'importing' && onClose()}>
      <div className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        {state.status === 'importing' && (
          <div className="import-progress">
            <Loader2 size={18} strokeWidth={1.75} className="import-spin" />
            <div>
              <div id="import-title" className="import-title">
                Importing {state.name}
              </div>
              <div className="import-subtitle">{state.progress ?? 'Converting pages, auto layout, text and images…'}</div>
            </div>
          </div>
        )}
        {state.status === 'error' && (
          <>
            <Header title={`Couldn’t Import ${state.name}`} onClose={onClose} />
            <p className="import-error">{state.message}</p>
            <div className="import-actions">
              <button type="button" className="import-button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
        {state.status === 'done' && <Report result={state.result} onClose={onClose} onOpen={onOpen} />}
      </div>
    </div>
  );
}

function Header({ title, onClose }: { title: string; onClose(): void }) {
  return (
    <header className="import-header">
      <h2 id="import-title" className="import-title">
        {title}
      </h2>
      <button type="button" className="import-close" aria-label="Close" onClick={onClose}>
        <X size={14} strokeWidth={1.75} />
      </button>
    </header>
  );
}

function Report({ result, onClose, onOpen }: { result: FigmaImportResult; onClose(): void; onOpen(id: string): void }) {
  const { report } = result;
  const fonts = report.fonts.map((f) => ({ ...f, available: isFontAvailable(f.family) }));
  const missing = fonts.filter((f) => !f.available);
  const artboards = report.pages.reduce((sum, p) => sum + p.artboards, 0);
  return (
    <>
      <Header title={`Imported “${report.title}”`} onClose={onClose} />
      <p className="import-summary">
        {[plural(report.pages.length, 'page'), plural(artboards, 'artboard'), plural(report.layers, 'layer'), plural(report.images, 'image'), plural(report.tokens, 'token')].join(' · ')}
      </p>

      <section className="import-section" aria-label="Pages">
        <h3>Pages</h3>
        <ul className="import-pages">
          {report.pages.map((p) => (
            <li key={p.file}>
              <span className="import-page-name">{p.name || p.file}</span>
              <span className="import-muted">{plural(p.artboards, 'artboard')}</span>
            </li>
          ))}
        </ul>
      </section>

      {fonts.length > 0 && (
        <section className="import-section" aria-label="Fonts">
          <h3>
            Fonts
            {missing.length > 0 && <span className="import-badge">{missing.length} missing</span>}
          </h3>
          <ul className="import-fonts">
            {fonts.map((f) => (
              <li key={f.family} className={f.available ? '' : 'is-missing'}>
                {f.available ? <CircleCheck size={14} strokeWidth={1.75} className="import-ok" /> : <TriangleAlert size={14} strokeWidth={1.75} className="import-warn" />}
                <span className="import-font-name" style={{ fontFamily: `"${f.family}", var(--home-font, system-ui)` }}>
                  {f.family}
                </span>
                <span className="import-muted">{f.weights.join(', ')}</span>
                <span className="import-font-status">{f.available ? 'Installed' : 'Not installed'}</span>
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="import-note">
              Text in missing fonts falls back to a similar system font. Install {missing.length === 1 ? 'it' : 'them'} and reopen the file, or point the font token
              {missing.length === 1 ? ' ' : 's '}
              {missing.map((f, i) => (
                <span key={f.token}>
                  {i > 0 && ', '}
                  <code>--{f.token}</code>
                </span>
              ))}{' '}
              at another family in Theme.
            </p>
          )}
        </section>
      )}

      {report.warnings.length > 0 && (
        <section className="import-section" aria-label="Notes">
          <h3>Notes</h3>
          <ul className="import-warnings">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="import-actions">
        <button type="button" className="import-button" onClick={onClose}>
          Close
        </button>
        <button type="button" className="import-button is-primary" autoFocus onClick={() => onOpen(result.id)}>
          Open File
        </button>
      </div>
    </>
  );
}
