import DOMPurify from 'dompurify';
import { toPng } from 'html-to-image';
import { serializeStyleSheet, serializeTokenSheet } from '../document/css.ts';
import { pageOf, rootOf } from '../document/tree.ts';
import type { DesignDocument, FileThumbnail } from '../document/types.ts';
import { serializeNode } from '../serialization/html.ts';
import { readThumbnail } from '../serialization/project.ts';
import { useEditor } from './store.ts';
import { notify } from '../canvas/gestureStore.ts';
import { saveNow, updateShareLink } from './persistence.ts';

function source(doc: DesignDocument, id: string): string {
  return [id, serializeNode(doc, rootOf(doc, id)), serializeTokenSheet(doc.tokens), serializeStyleSheet(doc.styles)].join('\n');
}

export async function thumbnailSource(doc: DesignDocument, id: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source(doc, id)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Render in an isolated viewport, so snapshots also work for frames on inactive pages. */
export async function captureThumbnail(doc: DesignDocument, id: string, base: string | null): Promise<FileThumbnail> {
  if (doc.nodes[id]?.kind !== 'element') throw new Error('Select a frame to use as the thumbnail.');
  const hash = await thumbnailSource(doc, id);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  Object.assign(iframe.style, { position: 'fixed', left: '-20000px', top: '0', width: '1440px', height: '900px', border: '0', pointerEvents: 'none' });
  const css = `${serializeTokenSheet(doc.tokens)}\n${serializeStyleSheet(doc.styles)}`.replace(/<\/style/gi, '<\\/style');
  const markup = DOMPurify.sanitize(serializeNode(doc, rootOf(doc, id)), { ADD_ATTR: ['data-pl-id'], FORBID_TAGS: ['iframe', 'object', 'embed', 'script'] });
  const baseTag = base ? `<base href="${new URL(base, location.href).href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` : '';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Thumbnail rendering timed out.')), 15000);
      iframe.onload = () => { clearTimeout(timer); resolve(); };
      iframe.srcdoc = `<!doctype html><html><head>${baseTag}<style>:where(html,body){margin:0;padding:0;background:transparent}</style><style>${css}</style></head><body>${markup}</body></html>`;
      document.body.append(iframe);
    });
    const rendered = iframe.contentDocument!;
    const root = rendered.querySelector<HTMLElement>(`[data-pl-id="${rootOf(doc, id)}"]`)!;
    const rootRect = root.getBoundingClientRect();
    iframe.style.width = `${Math.max(1, Math.ceil(rootRect.right))}px`;
    iframe.style.height = `${Math.max(1, Math.ceil(rootRect.bottom))}px`;
    await rendered.fonts.ready;
    await Promise.all(Array.from(rendered.images, async (image) => {
      await image.decode();
    }));
    const el = rendered.querySelector<HTMLElement>(`[data-pl-id="${id}"]`)!;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('The thumbnail frame must have a visible width and height.');
    const scale = Math.min(1200 / rect.width, 1200 / rect.height, 1);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    const image = await toPng(el, { canvasWidth: width, canvasHeight: height, pixelRatio: 1, backgroundColor: '#ffffff', style: { margin: '0', transform: 'none' } });
    const thumbnail = readThumbnail({ page: pageOf(doc, id)?.file, frame: id, image, width, height, source: hash });
    if (!thumbnail) throw new Error('This thumbnail is too large. Choose a simpler frame.');
    return thumbnail;
  } finally { iframe.remove(); }
}

export async function useAsThumbnail(id: string): Promise<void> {
  try {
    const { doc, assetBase } = useEditor.getState();
    const thumbnail = await captureThumbnail(doc, id, assetBase);
    const current = useEditor.getState();
    if (await thumbnailSource(current.doc, id) !== thumbnail.source) throw new Error('The frame changed while rendering. Try again.');
    current.apply('Set file thumbnail', (d) => ({ ...d, thumbnail }));
    await saveNow();
    if (useEditor.getState().saveStatus === 'error') throw new Error('Could not save the thumbnail. Try again.');
    await updateShareLink();
    notify('File Thumbnail Updated');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not set file thumbnail.'); }
}
