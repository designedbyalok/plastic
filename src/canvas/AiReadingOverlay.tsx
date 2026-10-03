import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useAiPresence } from '../editor/aiPresence.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import { rootOf } from '../document/tree.ts';
import { screenRectOf } from './dom.ts';
import type { Rect } from './coords.ts';
export function AiReadingOverlay() {
  const activity = useAiPresence(s => s.activity); const doc = useEditor(s => s.doc); const page = useEditor(s => s.activePage);
  const [boxes, setBoxes] = useState<Array<{ id: string; rect: Rect; reading: boolean }>>([]);
  useEffect(() => {
    if (!activity.length) { setBoxes([]); return; }
    let raf = 0; let previous = '';
    const tick = () => {
      const state = useEditor.getState(); const targets = new Map<string, boolean>();
      for (const call of activity) {
        if (call.page && !state.doc.pages.some(p => p.file === state.activePage && (p.file === call.page || p.name === call.page))) continue;
        const ids = call.nodeIds.length ? call.nodeIds : activeRoots(state);
        for (const node of ids) { const id = screenRectOf(node) ? node : rootOf(state.doc, node); if (id) targets.set(id, (targets.get(id) ?? true) && call.mode === 'read'); }
      }
      const measured = [...targets].flatMap(([id, reading]) => { const rect = screenRectOf(id); return rect ? [{ id, rect, reading }] : []; });
      const signature = JSON.stringify(measured); if (signature !== previous) { previous = signature; setBoxes(measured); }
      raf = requestAnimationFrame(tick);
    };
    tick(); return () => cancelAnimationFrame(raf);
  }, [activity, doc, page]);
  return <div className="ai-reading-overlay" aria-hidden="true">{boxes.map(({ id, rect, reading }) => <div key={id} className="ai-reading-frame" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
    <div className="ai-reading-sweep" /><span className="ai-reading-label"><Bot size={11} />{reading ? 'AI Reading' : 'AI Editing'}</span>
  </div>)}</div>;
}
