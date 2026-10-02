/** Read-only view of exactly what gets saved. The files on disk are the editable source. */
import { useMemo, useState } from 'react';
import { PROJECT_FILE, STYLES_FILE, TOKENS_FILE, serializeProject } from '../serialization';
import { serializeHTML } from '../serialization/html';
import { editorMeta, useEditor } from '../editor/store';

/** Tab "page" shows the page on the canvas; the others are shared files. */
type Tab = 'page' | typeof STYLES_FILE | typeof TOKENS_FILE | typeof PROJECT_FILE;

export function CodePanel() {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const [tab, setTab] = useState<Tab>('page');
  const [clean, setClean] = useState(true);
  const files = useMemo(() => serializeProject(doc, editorMeta(useEditor.getState())), [doc]);
  const page = doc.pages.find((p) => p.file === activePage) ?? doc.pages[0]!;
  const text = tab === 'page' ? (clean ? serializeHTML(doc, page, { ids: false }) : files[page.file] ?? '') : files[tab] ?? '';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'page', label: page.file },
    { id: STYLES_FILE, label: STYLES_FILE },
    { id: TOKENS_FILE, label: TOKENS_FILE },
    { id: PROJECT_FILE, label: PROJECT_FILE },
  ];

  return (
    <section className="code-panel" aria-label="Code">
      <div className="code-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`code-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <span className="code-spacer" />
        {tab === 'page' && (
          <label className="code-option">
            <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} /> Hide editor ids
          </label>
        )}
        <button type="button" className="code-copy" onClick={() => void navigator.clipboard?.writeText(text)}>
          Copy
        </button>
      </div>
      <pre className="code-body">{text}</pre>
    </section>
  );
}
