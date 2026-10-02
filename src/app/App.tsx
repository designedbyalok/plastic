import { useEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas';
import { zoomToFit } from '../editor/commands';
import { startPersistence } from '../editor/persistence';
import { useShortcuts } from '../editor/shortcuts';
import { useEditor } from '../editor/store';
import { CodePanel } from '../panels/CodePanel';
import { Inspector } from '../panels/inspector/Inspector';
import { LayersPanel } from '../panels/LayersPanel';
import { Toolbar } from '../panels/Toolbar';

export function App() {
  const codeOpen = useEditor((s) => s.codeOpen);
  const [ready, setReady] = useState(false);
  useShortcuts();

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startPersistence().then(({ stop: cleanup, restoredViewport }) => {
      if (cancelled) return cleanup();
      stop = cleanup;
      setReady(true);
      // No saved viewport: frame the artboards once they have been laid out.
      if (!restoredViewport) requestAnimationFrame(() => requestAnimationFrame(zoomToFit));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <LayersPanel />
        <main className="stage">
          <Canvas />
          {codeOpen && <CodePanel />}
          {!ready && <div className="loading">Opening project…</div>}
        </main>
        <Inspector />
      </div>
    </div>
  );
}
