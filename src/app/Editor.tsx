import { useEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas.tsx';
import { zoomToFit } from '../editor/commands.ts';
import { openProject } from '../editor/persistence.ts';
import { useShortcuts } from '../editor/shortcuts.ts';
import { useEditor } from '../editor/store.ts';
import { CodePanel } from '../panels/CodePanel.tsx';
import { Inspector } from '../panels/inspector/Inspector.tsx';
import { LayersPanel } from '../panels/LayersPanel.tsx';
import { ToolRail } from '../panels/ToolRail.tsx';
import { ConnectAgents } from '../panels/ConnectAgents.tsx';
import { linkClick } from './router.ts';

type Status = 'opening' | 'open' | 'missing';

export function Editor({ projectId }: { projectId: string }) {
  const codeOpen = useEditor((s) => s.codeOpen);
  const agentsOpen = useEditor((s) => s.agentsOpen);
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
    <div className="app editor">
      <div className="workspace">
        <LayersPanel />
        <ToolRail />
        <main className="stage">
          {status === 'open' && <Canvas />}
          {codeOpen && <CodePanel />}
          {status === 'opening' && <div className="loading">Opening file…</div>}
        </main>
        <Inspector />
      </div>
      {agentsOpen && <ConnectAgents />}
    </div>
  );
}
