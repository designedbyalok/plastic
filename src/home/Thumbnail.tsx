/**
 * Use the same selected-frame snapshot as shared links. Files without a selection retain
 * their live first-page preview, rendered in a sandboxed iframe and scaled to fit.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { DesignDocument } from '../document/types.ts';
import { serializeNode } from '../serialization/html.ts';

const PADDING = 12;
/** Viewport used for laying out roots whose width depends on it (before measuring). */
const LAYOUT_WIDTH = 1440;

function thumbnailDocument(doc: DesignDocument, css: string, base: string | null): string {
  const roots = doc.pages[0]?.roots ?? [];
  const frames = roots.map((id) => doc.frames[id] ?? { x: 0, y: 0 });
  const minX = Math.min(0, ...frames.map((f) => f.x));
  const minY = Math.min(0, ...frames.map((f) => f.y));
  const markup = roots
    .map((id, i) => `<div data-thumb-root style="position:absolute;left:${frames[i]!.x - minX}px;top:${frames[i]!.y - minY}px">${serializeNode(doc, id, 0, { ids: false })}</div>`)
    .join('');
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html><head><meta charset="utf-8">${base ? `<base href="${base.replace(/"/g, '&quot;')}">` : ''}<style>:where(html,body){margin:0;overflow:hidden;background:transparent}</style><style>${safeCss}</style></head><body>${markup}</body></html>`;
}

function LiveThumbnail({ doc, css, base = null }: { doc: DesignDocument; css: string; base?: string | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => thumbnailDocument(doc, css, base), [doc, css, base]);

  useEffect(() => {
    const box = boxRef.current!;
    const frame = frameRef.current!;
    let content = { width: 0, height: 0 };

    const place = () => {
      if (!content.width || !content.height) {
        frame.style.visibility = 'hidden';
        return;
      }
      const scale = Math.min((box.clientWidth - PADDING * 2) / content.width, (box.clientHeight - PADDING * 2) / content.height, 1);
      const x = (box.clientWidth - content.width * scale) / 2;
      const y = (box.clientHeight - content.height * scale) / 2;
      frame.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      frame.style.visibility = 'visible';
    };

    let passes = 0;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const before = content;
      let right = 0;
      let bottom = 0;
      doc.querySelectorAll('[data-thumb-root]').forEach((el) => {
        const r = el.getBoundingClientRect();
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      });
      content = { width: Math.ceil(right), height: Math.ceil(bottom) };
      // The iframe becomes a viewport exactly as wide as the artboards, for media queries.
      if (content.width) frame.style.width = `${content.width}px`;
      if (content.height) frame.style.height = `${content.height}px`;
      place();
      // Narrowing the viewport can trigger media queries and reflow; settle once more.
      const changed = before.width !== content.width || before.height !== content.height;
      if (changed && ++passes < 3) requestAnimationFrame(measure);
    };

    frame.style.width = `${LAYOUT_WIDTH}px`;
    frame.addEventListener('load', measure);
    const resize = new ResizeObserver(place);
    resize.observe(box);
    return () => {
      frame.removeEventListener('load', measure);
      resize.disconnect();
    };
  }, [srcDoc]);

  return (
    <div ref={boxRef} className="home-thumb">
      <iframe ref={frameRef} className="home-thumb-frame" srcDoc={srcDoc} sandbox="allow-same-origin" tabIndex={-1} aria-hidden="true" title="" loading="lazy" />
    </div>
  );
}

export function Thumbnail(props: { doc: DesignDocument; css: string; base?: string | null }) {
  const thumbnail = props.doc.thumbnail;
  if (thumbnail && props.doc.nodes[thumbnail.frame]) return <div className="home-thumb"><img src={thumbnail.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div>;
  return <LiveThumbnail {...props} />;
}
