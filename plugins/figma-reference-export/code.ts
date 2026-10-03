/// <reference types="@figma/plugin-typings" />
import { captureFrames, exportable } from './capture.ts';
figma.showUI(__html__, { width: 420, height: 520, themeColors: true });
let busy = false;
function selection() {
  const nodes = figma.currentPage.selection;
  const count = nodes.filter(exportable).length;
  figma.ui.postMessage({ type: 'selection', count, invalid: nodes.length - count });
}
figma.on('selectionchange', selection);
selection();
figma.ui.onmessage = async (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'close') return figma.closePlugin();
  if (message.type !== 'capture' || busy) return;
  busy = true;
  try {
    const nodes = figma.currentPage.selection;
    if (!nodes.length || nodes.some((n) => !exportable(n))) throw new Error('Select only top-level frames or components.');
    const packet = await captureFrames(nodes.filter(exportable), { fileName: figma.root.name, pageName: figma.currentPage.name },
      (done, total, name) => figma.ui.postMessage({ type: 'progress', done, total, name }));
    figma.ui.postMessage({ type: 'captured', packet });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not capture the selection.' });
  } finally { busy = false; }
};
