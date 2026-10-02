/** Read-only view of exactly what gets saved. The files on disk are the editable source. */
import { useMemo, useState } from 'react';
import { serializeProject } from '../serialization';
import { serializeHTML } from '../serialization/html';
import { editorMeta, useEditor } from '../editor/store';

type Tab = 'html' | 'css' | 'project';

export function CodePanel() {
  const doc = useEditor((s) => s.doc);
  const [tab, setTab] = useState<Tab>('html');
  const [clean, setClean] = useState(true);
  const files = useMemo(() => serializeProject(doc, editorMeta(useEditor.getState())), [doc]);
  const text = tab === 'html' ? (clean ? serializeHTML(doc, { ids: false }) : files.html) : tab === 'css' ? files.css : files.project;

  return (
    <section className="code-panel" aria-label="Code">
      <div className="code-tabs" role="tablist">
        {(['html', 'css', 'project'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`code-tab${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'html' ? 'index.html' : t === 'css' ? 'styles.css' : 'project.json'}
          </button>
        ))}
        <span className="code-spacer" />
        {tab === 'html' && (
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
