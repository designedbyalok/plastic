import { Suspense, lazy, useEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas.tsx';
import { zoomToFit } from '../editor/commands.ts';
import { openProject } from '../editor/persistence.ts';
import { useShortcuts } from '../editor/shortcuts.ts';
import { useEditor } from '../editor/store.ts';
import { Inspector } from '../panels/inspector/Inspector.tsx';
import { LayersPanel } from '../panels/LayersPanel.tsx';
import { ToolRail } from '../panels/ToolRail.tsx';
import { ConnectAgents } from '../panels/ConnectAgents.tsx';
import { AppSkeleton, CodeSkeleton } from './Skeleton.tsx';
import { linkClick } from './router.ts';
import { focusLinkedFrame } from '../editor/frameLinks.ts';

// The code editor (CodeMirror) loads when the Code panel is first opened.
const CodePanel = lazy(() => import('../panels/CodePanel.tsx').then((m) => ({ default: m.CodePanel })));

type Status = 'opening' | 'open' | 'missing' | 'error';

export function Editor({ projectId }: { projectId: string }) {
  const codeOpen = useEditor((s) => s.codeOpen);
  const agentsOpen = useEditor((s) => s.agentsOpen);
  const title = useEditor((s) => s.doc.title);
  const [status, setStatus] = useState<Status>('opening');
  const [openError, setOpenError] = useState('');
  useShortcuts(status === 'open');

  useEffect(() => {
    if (status !== 'open') return;
    focusLinkedFrame();
    window.addEventListener('popstate', focusLinkedFrame);
    window.addEventListener('plastic:navigate', focusLinkedFrame);
    return () => {
      window.removeEventListener('popstate', focusLinkedFrame);
      window.removeEventListener('plastic:navigate', focusLinkedFrame);
    };
  }, [status, projectId]);

  useEffect(() => {
    document.title = status === 'open' ? `${title} — Plastic` : 'Plastic';
  }, [status, title]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    setStatus('opening');
    setOpenError('');
    void openProject(projectId).then((opened) => {
      if (cancelled) return opened.stop();
      stop = opened.stop;
      setStatus(opened.found ? 'open' : 'missing');
      // No saved viewport: frame the artboards once they have been laid out.
      if (opened.found && !opened.restoredViewport && !new URL(location.href).searchParams.has('frame')) requestAnimationFrame(() => requestAnimationFrame(zoomToFit));
    }).catch((error: unknown) => {
      if (cancelled) return;
      setOpenError(error instanceof Error ? error.message : 'Could not open this project.');
      setStatus('error');
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [projectId]);

  if (status === 'opening') return <AppSkeleton editor />;

  if (status === 'error') {
    return (
      <div className="missing-file" role="alert">
        <p>{openError}</p>
        <button type="button" onClick={() => location.reload()}>Try Again</button>
        <a href="/" onClick={linkClick}>Back to Files</a>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="missing-file">
        <p>There is no file called “{projectId}” in this workspace.</p>
        <a href="/" onClick={linkClick}>
          Back to Files
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
          {codeOpen && (
            <Suspense fallback={<CodeSkeleton />}>
              <CodePanel />
            </Suspense>
          )}
        </main>
        <Inspector />
      </div>
      {agentsOpen && <ConnectAgents />}
    </div>
  );
}
