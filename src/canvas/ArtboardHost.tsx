/**
 * One artboard = one root element rendered into its own Shadow DOM. The shadow root isolates
 * the design's CSS from the editor's CSS in both directions, while keeping the design in the
 * same document (cheap hit testing and measurement). See docs/ARCHITECTURE.md (rendering).
 */
import { useLayoutEffect, useRef } from 'react';
import { serializeStyleSheet } from '../document/css';
import type { NodeId, StyleSheet } from '../document/types';
import { useEditor } from '../editor/store';
import { onRerenderRequest, registerHost } from './dom';
import { DomRenderer } from './renderer';

/** Editor-only rules. They only affect non-visual behavior (cursor, editing outline). */
const EDITOR_CSS = `
:host { all: initial; display: block; cursor: inherit; }
* { cursor: inherit !important; }
[contenteditable] { cursor: text !important; outline: none; }
`;

const cssCache = new WeakMap<StyleSheet, string>();

function designCss(sheet: StyleSheet): string {
  let css = cssCache.get(sheet);
  if (css === undefined) {
    // `:root` never matches inside a shadow tree; map document-level variables onto the host.
    css = EDITOR_CSS + serializeStyleSheet(sheet).replace(/:root\b/g, ':host');
    cssCache.set(sheet, css);
  }
  return css;
}

/** Stop the design's native behavior (focus, typing, toggling, navigating) while editing it. */
function blockNativeInteraction(root: ShadowRoot): () => void {
  const inEditable = (e: Event) => e.composedPath().some((t) => t instanceof HTMLElement && t.isContentEditable);
  const prevent = (e: Event) => {
    if (!inEditable(e)) e.preventDefault();
  };
  const unfocus = (e: Event) => {
    if (!inEditable(e) && e.target instanceof HTMLElement) e.target.blur();
  };
  const types = ['mousedown', 'click', 'auxclick', 'dragstart', 'submit'] as const;
  types.forEach((t) => root.addEventListener(t, prevent, true));
  root.addEventListener('focusin', unfocus, true);
  return () => {
    types.forEach((t) => root.removeEventListener(t, prevent, true));
    root.removeEventListener('focusin', unfocus, true);
  };
}

export function ArtboardHost({ id }: { id: NodeId }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frame = useEditor((s) => s.doc.frames[id]);

  useLayoutEffect(() => {
    const host = hostRef.current!;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.replaceChildren();
    const style = document.createElement('style');
    shadow.appendChild(style);
    const renderer = new DomRenderer(shadow);
    const unblock = blockNativeInteraction(shadow);
    const unregister = registerHost(id, host);

    let lastDoc: unknown = null;
    const render = () => {
      const { doc } = useEditor.getState();
      if (doc === lastDoc || !doc.nodes[id]) return;
      lastDoc = doc;
      const css = designCss(doc.styles);
      if (style.textContent !== css) style.textContent = css;
      renderer.render(doc, id);
    };
    render();
    const unsubscribe = useEditor.subscribe(render);
    const offRerender = onRerenderRequest(() => {
      lastDoc = null;
      renderer.invalidate();
      render();
    });
    return () => {
      unsubscribe();
      offRerender();
      unregister();
      unblock();
      renderer.dispose();
      shadow.replaceChildren();
    };
  }, [id]);

  return <div ref={hostRef} className="artboard-host" style={{ left: frame?.x ?? 0, top: frame?.y ?? 0 }} />;
}
