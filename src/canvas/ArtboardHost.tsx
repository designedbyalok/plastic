import loadingCss from '../app/loading.css?raw';
import { ImageLoading } from './imageLoading.ts';
/**
 * One artboard = one root element rendered into its own same-origin <iframe>.
 *
 * The iframe is a real viewport, sized to the root element, so `@media` queries, viewport
 * units, `@font-face`, `:root` variables and `body` rules behave exactly as in the exported page.
 * It also isolates the design's CSS from the editor's in both directions.
 *
 * The iframe never receives pointer events (except while inline-editing its text): the canvas
 * hit-tests into its document instead, so every gesture has a single event path.
 * See docs/ARCHITECTURE.md (rendering).
 */
import { useLayoutEffect, useRef } from 'react';
import { serializeStyleSheet, serializeTokenSheet } from '../document/css.ts';
import { previewVariantCss } from '../document/variants.ts';
import { rootOf } from '../document/tree.ts';
import type { NodeId } from '../document/types.ts';
import { useEditor } from '../editor/store.ts';
import { domElement, onRerenderRequest, registerHost } from './dom.ts';
import { DomRenderer } from './renderer.ts';
import { finishTextEditing } from './textEditing.ts';
import { handleCanvasCopy, handleCanvasPaste } from '../editor/clipboard.ts';

/**
 * Editor-only rules, placed *before* the design CSS and wrapped in :where() (zero specificity)
 * so any rule in styles.css overrides them.
 */
const EDITOR_CSS = `
/* Transparent document surfaces let unfilled roots (such as text) show the canvas. */
:where(html, body) { margin: 0; padding: 0; overflow: hidden; background: transparent; }
[contenteditable] { outline: none; cursor: text; }
`;

/** Width used for a root whose width depends on the viewport (e.g. `width: auto`). */
const DEFAULT_VIEWPORT_WIDTH = 1440;

const cssCache = new WeakMap<object, string>();

function cached<T extends object>(sheet: T, serialize: (sheet: T) => string): string {
  let css = cssCache.get(sheet);
  if (css === undefined) {
    css = serialize(sheet);
    cssCache.set(sheet, css);
  }
  return css;
}

const READY_ATTR = 'data-plastic-artboard';

/** Give the iframe a standards-mode document (about:blank starts in quirks mode). */
function prepareDocument(frame: HTMLIFrameElement, base: string | null): Document | null {
  const doc = frame.contentDocument;
  if (!doc) return null;
  if (!doc.documentElement.hasAttribute(READY_ATTR)) {
    // <base> makes the design's relative URLs (assets/…) resolve inside its project folder.
    const baseTag = base ? `<base href="${base.replace(/"/g, '&quot;')}">` : '';
    doc.open();
    doc.write(`<!doctype html><html lang="en" ${READY_ATTR}><head><meta charset="utf-8">${baseTag}</head><body></body></html>`);
    doc.close();
  }
  return doc;
}

/** Stop the design's native behavior (focus, toggling, navigating, submitting) while editing it. */
function blockNativeInteraction(doc: Document): () => void {
  const isEditable = (t: EventTarget | null) => !!t && (t as HTMLElement).isContentEditable === true;
  const prevent = (e: Event) => {
    if (!isEditable(e.target)) e.preventDefault();
  };
  const unfocus = (e: Event) => {
    if (!isEditable(e.target)) (e.target as HTMLElement | null)?.blur?.();
  };
  const types = ['mousedown', 'click', 'auxclick', 'dragstart', 'submit'] as const;
  types.forEach((t) => doc.addEventListener(t, prevent, true));
  doc.addEventListener('focusin', unfocus, true);
  return () => {
    types.forEach((t) => doc.removeEventListener(t, prevent, true));
    doc.removeEventListener('focusin', unfocus, true);
  };
}

function px(n: number): string {
  return `${Math.max(1, Math.ceil(n))}px`;
}

export function ArtboardHost({ id }: { id: NodeId }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frame = useEditor((s) => s.doc.frames[id]);
  const editingHere = useEditor((s) => !!s.editingTextId && !!s.doc.nodes[s.editingTextId] && rootOf(s.doc, s.editingTextId) === id);

  useLayoutEffect(() => {
    const iframe = frameRef.current!;
    let teardown: (() => void) | null = null;

    const setup = () => {
      teardown?.();
      const doc = prepareDocument(iframe, useEditor.getState().assetBase);
      if (!doc) return;
      const win = doc.defaultView!;
      const guard = doc.createElement('style');
      const tokens = doc.createElement('style');
      const style = doc.createElement('style');
      tokens.dataset.plasticSource = 'tokens.css';
      style.dataset.plasticSource = 'styles.css';
      guard.textContent = EDITOR_CSS + loadingCss + `
[data-plastic-image-loading] { position: absolute; pointer-events: none; z-index: 2147483647; background-color: #eff0f3; }
`;
      // Same order as the exported page: tokens.css, then styles.css.
      doc.head.append(guard, tokens, style);
      const renderer = new DomRenderer(doc.body);
      const imageLoading = new ImageLoading(doc);
      const unblock = blockNativeInteraction(doc);
      const unregister = registerHost(id, iframe);

      // The viewport follows the root element's box, so media queries see the artboard width.
      let observed: Element | null = null;
      let fitFrame = 0;
      const resize = new win.ResizeObserver(() => {
        win.cancelAnimationFrame(fitFrame);
        fitFrame = win.requestAnimationFrame(() => fit());
      });
      const fit = () => {
        const root = domElement(id);
        if (!root) return;
        imageLoading.position();
        const r = root.getBoundingClientRect();
        const state = useEditor.getState();
        const preview = state.stylePreview;
        const previewWidth = preview && state.doc.nodes[preview.id] && rootOf(state.doc, preview.id) === id ? preview.maxWidth : null;
        iframe.style.width = px(previewWidth ?? r.right + Math.max(0, r.left));
        iframe.style.height = px(r.bottom + Math.max(0, r.top));
        // Preserve the last measured box while the browser skips offscreen painting.
        iframe.parentElement!.style.containIntrinsicSize = `${iframe.style.width} ${iframe.style.height}`;
      };
      const observe = () => {
        const root = domElement(id);
        if (root === observed) { fit(); return; }
        if (observed) resize.unobserve(observed);
        if (root) resize.observe(root);
        observed = root;
        fit();
      };

      let lastDoc: unknown = null;
      let lastPreview: unknown = null;
      let visibilityFrame = 0;
      const render = () => {
        const { doc: design, stylePreview } = useEditor.getState();
        if (!design.nodes[id]) return;
        const preview = stylePreview && design.nodes[stylePreview.id] && rootOf(design, stylePreview.id) === id ? stylePreview : null;
        if (design === lastDoc && preview === lastPreview) return;
        let layoutChanged = preview !== lastPreview;
        if (preview !== lastPreview) iframe.style.width = px(preview?.maxWidth ?? DEFAULT_VIEWPORT_WIDTH);
        lastDoc = design;
        lastPreview = preview;
        const tokenCss = cached(design.tokens, serializeTokenSheet);
        if (tokens.textContent !== tokenCss) { tokens.textContent = tokenCss; layoutChanged = true; }
        const node = preview ? design.nodes[preview.id] : null;
        const cls = node?.kind === 'element' ? node.classes[0] : null;
        const css = preview && cls ? previewVariantCss(design.styles, cls, preview) : cached(design.styles, serializeStyleSheet);
        if (style.textContent !== css) { style.textContent = css; layoutChanged = true; }
        const nodesChanged = renderer.render(design, id);
        if (nodesChanged) imageLoading.sync();
        if (layoutChanged || nodesChanged) {
          // Initialize new/changed animation styles before skipping offscreen painting.
          // This also covers agent edits to artboards that have never been on screen.
          iframe.parentElement!.style.contentVisibility = 'visible';
          observe();
          doc.body.getAnimations?.({ subtree: true });
          cancelAnimationFrame(visibilityFrame);
          visibilityFrame = requestAnimationFrame(() => { iframe.parentElement!.style.contentVisibility = ''; });
        }
      };
      render();
      const unsubscribe = useEditor.subscribe(render);
      const offRerender = onRerenderRequest(() => {
        lastDoc = null;
        renderer.invalidate();
        render();
      });
      // Clicking elsewhere inside this artboard while editing text ends the edit.
      const onPointerDown = (e: PointerEvent) => {
        const editing = domElement(useEditor.getState().editingTextId);
        if (editing && !editing.contains(e.target as Node)) finishTextEditing(true);
      };
      doc.addEventListener('pointerdown', onPointerDown);
      const onPaste = (e: ClipboardEvent) => handleCanvasPaste(e, id);
      const onCopy = (e: ClipboardEvent) => handleCanvasCopy(e);
      const onCut = (e: ClipboardEvent) => handleCanvasCopy(e, true);
      doc.addEventListener('copy', onCopy);
      doc.addEventListener('cut', onCut);
      doc.addEventListener('paste', onPaste);

      teardown = () => {
        cancelAnimationFrame(visibilityFrame);
        unsubscribe();
        offRerender();
        unregister();
        unblock();
        resize.disconnect();
        win.cancelAnimationFrame(fitFrame);
        doc.removeEventListener('pointerdown', onPointerDown);
        doc.removeEventListener('copy', onCopy);
        doc.removeEventListener('cut', onCut);
        doc.removeEventListener('paste', onPaste);
        imageLoading.dispose();
        renderer.dispose();
        guard.remove();
        tokens.remove();
        style.remove();
        teardown = null;
      };
    };

    iframe.style.width = px(DEFAULT_VIEWPORT_WIDTH);
    setup();
    // Some browsers replace the initial about:blank document on load; set up again if so.
    const onLoad = () => {
      if (!iframe.contentDocument?.documentElement.hasAttribute(READY_ATTR)) setup();
    };
    iframe.addEventListener('load', onLoad);
    return () => {
      iframe.removeEventListener('load', onLoad);
      teardown?.();
    };
  }, [id]);

  return (
    <div className="artboard-host" style={{ left: frame?.x ?? 0, top: frame?.y ?? 0 }}>
      <iframe
        ref={frameRef}
        className="artboard-frame"
        title={`Artboard ${id}`}
        sandbox="allow-same-origin"
        tabIndex={-1}
        style={{ pointerEvents: editingHere ? 'auto' : 'none' }}
      />
    </div>
  );
}
