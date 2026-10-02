import { useEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas';
import { zoomToFit } from '../editor/commands';
import { openProject } from '../editor/persistence';
import { useShortcuts } from '../editor/shortcuts';
import { useEditor } from '../editor/store';
import { CodePanel } from '../panels/CodePanel';
import { Inspector } from '../panels/inspector/Inspector';
import { LayersPanel } from '../panels/LayersPanel';
import { Toolbar } from '../panels/Toolbar';
import { linkClick } from './router';

type Status = 'opening' | 'open' | 'missing';

export function Editor({ projectId }: { projectId: string }) {
  const codeOpen = useEditor((s) => s.codeOpen);
  const title = useEditor((s) => s.doc.title);
  const [status, setStatus] = useState<Status>('opening');
  useShortcuts();

  useEffect(() => {
    document.title = status === 'open' ? `${title} — Plastic` : 'Plastic';
  }, [status, title]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    setStatus('opening');
    void openProject(projectId).then((opened) => {
      if (cancelled) return opened.stop();
      stop = opened.stop;
      setStatus(opened.found ? 'open' : 'missing');
      // No saved viewport: frame the artboards once they have been laid out.
      if (opened.found && !opened.restoredViewport) requestAnimationFrame(() => requestAnimationFrame(zoomToFit));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [projectId]);

  if (status === 'missing') {
    return (
      <div className="missing-file">
        <p>There is no file called “{projectId}” in this workspace.</p>
        <a href="/" onClick={linkClick}>
          Back to files
        </a>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <LayersPanel />
        <main className="stage">
          {status === 'open' && <Canvas />}
          {codeOpen && <CodePanel />}
          {status === 'opening' && <div className="loading">Opening file…</div>}
        </main>
        <Inspector />
      </div>
    </div>
  );
}
