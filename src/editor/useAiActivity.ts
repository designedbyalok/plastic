import { useEffect } from 'react';
import { detectBackend } from '../auth/client.ts';
import { useAiPresence, type AiActivity } from './aiPresence.ts';
export function useAiActivity(projectId: string, enabled: boolean) {
  useEffect(() => {
    useAiPresence.getState().setActivity([]);
    if (!enabled) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/__plastic/ai-activity/${encodeURIComponent(projectId)}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Activity unavailable');
        const values = await response.json() as AiActivity[];
        if (!cancelled) useAiPresence.getState().setActivity(Array.isArray(values) ? values.filter(v => v.file === projectId && Array.isArray(v.nodeIds) && (v.mode === 'read' || v.mode === 'write') && v.expiresAt > Date.now()) : []);
      } catch { if (!cancelled) useAiPresence.getState().setActivity([]); }
      if (!cancelled) timer = setTimeout(() => { void poll(); }, 750);
    };
    // Current MCP transports are local; deployed accounts have no MCP activity endpoint.
    void detectBackend().then(backend => { if (!cancelled && !backend.auth) void poll(); });
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); useAiPresence.getState().setActivity([]); };
  }, [projectId, enabled]);
}
