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
import { serializeStyleSheet, serializeTokenSheet } from '../document/css';
import { rootOf } from '../document/tree';
import type { NodeId } from '../document/types';
import { useEditor } from '../editor/store';
import { domElement, onRerenderRequest, registerHost } from './dom';
import { DomRenderer } from './renderer';
import { finishTextEditing } from './textEditing';

/**
 * Editor-only rules, placed *before* the design CSS and wrapped in :where() (zero specificity)
 * so any rule in styles.css overrides them.
 */
const EDITOR_CSS = `
/* Keep the browser's default white page canvas: an artboard looks like its root on a real page. */
:where(html, body) { margin: 0; padding: 0; overflow: hidden; }
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
      guard.textContent = EDITOR_CSS;
      // Same order as the exported page: tokens.css, then styles.css.
      doc.head.append(guard, tokens, style);
      const renderer = new DomRenderer(doc.body);
      const unblock = blockNativeInteraction(doc);
      const unregister = registerHost(id, iframe);

      // The viewport follows the root element's box, so media queries see the artboard width.
      let observed: Element | null = null;
      const resize = new win.ResizeObserver(() => fit());
      const fit = () => {
        const root = domElement(id);
        if (!root) return;
        const r = root.getBoundingClientRect();
        iframe.style.width = px(r.right + Math.max(0, r.left));
        iframe.style.height = px(r.bottom + Math.max(0, r.top));
      };
      const observe = () => {
        const root = domElement(id);
        if (root === observed) return;
        if (observed) resize.unobserve(observed);
        if (root) resize.observe(root);
        observed = root;
        fit();
      };

      let lastDoc: unknown = null;
      const render = () => {
        const { doc: design } = useEditor.getState();
        if (design === lastDoc || !design.nodes[id]) return;
        lastDoc = design;
        const tokenCss = cached(design.tokens, serializeTokenSheet);
        if (tokens.textContent !== tokenCss) tokens.textContent = tokenCss;
        const css = cached(design.styles, serializeStyleSheet);
        if (style.textContent !== css) style.textContent = css;
        renderer.render(design, id);
        observe();
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

      teardown = () => {
        unsubscribe();
        offRerender();
        unregister();
        unblock();
        resize.disconnect();
        doc.removeEventListener('pointerdown', onPointerDown);
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
        tabIndex={-1}
        style={{ pointerEvents: editingHere ? 'auto' : 'none' }}
      />
    </div>
  );
}
