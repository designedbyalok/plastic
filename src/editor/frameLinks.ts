import { frameDesign } from '../serialization/frame.ts';
import { domElement, getViewportElement, styleOf } from '../canvas/dom.ts';
import { notify } from '../canvas/gestureStore.ts';
import { pageOf, rootOf } from '../document/tree.ts';
import { saveNow, updateShareLink } from './persistence.ts';
import { useEditor } from './store.ts';
import { fitRect } from '../canvas/coords.ts';

export function frameLink(id?: string): string {
  const url = new URL(location.href);
  const preview = url.searchParams.get('preview');
  url.search = '';
  if (preview) url.searchParams.set('preview', preview);
  url.hash = '';
  if (id) url.searchParams.set('frame', id);
  return url.href;
}

export async function copyFrameLink(id?: string): Promise<void> {
  try {
    await saveNow();
    if (useEditor.getState().saveStatus === 'error') throw new Error('Save the file before copying its frame link.');
    await updateShareLink();
    await navigator.clipboard.writeText(frameLink(id));
    notify(id ? 'Frame Link Copied' : 'File Link Copied');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not copy frame link.'); }
}

/** Portable context for an AI that cannot access this workspace's link or MCP server. */
export async function copyFrameContext(id: string): Promise<void> {
  try {
    const store = useEditor.getState();
    const design = frameDesign(store.doc, id);
    const root = domElement(id);
    const rootRect = root?.getBoundingClientRect();
    const properties = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'padding', 'margin', 'gap', 'row-gap', 'column-gap', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-content', 'grid-template-columns', 'grid-template-rows', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color', 'background', 'border', 'border-radius', 'box-shadow', 'opacity', 'overflow', 'transform', 'text-align', 'text-decoration', 'white-space', 'fill', 'stroke'];
    const measurements = design.nodes.flatMap((node) => {
      const el = domElement(node.id);
      if (!el || !rootRect) return [];
      const rect = el.getBoundingClientRect(), css = styleOf(el);
      return [{ id: node.id, bounds: { x: rect.x - rootRect.x, y: rect.y - rootRect.y, width: rect.width, height: rect.height }, computed: Object.fromEntries(properties.map((prop) => [prop, css.getPropertyValue(prop)])) }];
    });
    await navigator.clipboard.writeText(JSON.stringify({ ...design, link: frameLink(id), assetBase: store.assetBase, viewport: root ? { width: root.ownerDocument.defaultView?.innerWidth, height: root.ownerDocument.defaultView?.innerHeight } : null, measurements }, null, 2));
    notify('Frame AI context copied');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not copy frame context.'); }
}

export function focusLinkedFrame(): boolean {
  const id = new URL(location.href).searchParams.get('frame');
  const store = useEditor.getState();
  if (!id) return false;
  const page = pageOf(store.doc, id);
  if (!page) { notify('The linked frame no longer exists.'); return false; }
  store.setActivePage(page.file);
  store.select([id]);
  let tries = 0;
  const focus = () => {
    if (useEditor.getState().selection[0] !== id) return;
    const el = domElement(id), viewport = getViewportElement();
    if (el && viewport) {
      // Use local DOM geometry and canvas metadata, independent of a stale camera transform.
      const bounds = el.getBoundingClientRect();
      const position = useEditor.getState().doc.frames[rootOf(useEditor.getState().doc, id)] ?? { x: 0, y: 0 };
      useEditor.getState().setViewport(fitRect({ x: position.x + bounds.x, y: position.y + bounds.y,
        width: bounds.width, height: bounds.height }, { width: viewport.clientWidth, height: viewport.clientHeight }, 96, 4));
    }
    else if (++tries < 30) requestAnimationFrame(focus);
  };
  requestAnimationFrame(() => requestAnimationFrame(focus));
  return true;
}
