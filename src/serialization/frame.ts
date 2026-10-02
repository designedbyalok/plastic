import { serializeStyleSheet, serializeTokenSheet } from '../document/css.ts';
import { getElement, isRoot, pageOf, subtreeIds } from '../document/tree.ts';
import type { DesignDocument } from '../document/types.ts';
import { layerName } from '../elements/registry.ts';
import { serializeNode } from './html.ts';

export function parseFrameLink(link: string): { file: string; frame: string } {
  const url = new URL(link, 'http://plastic.local');
  const path = /^\/file\/([^/]+)\/?$/.exec(url.pathname);
  const frame = url.searchParams.get('frame');
  if (!path || !frame || !/^[\w-]{1,64}$/.test(frame)) throw new Error('Expected a Plastic frame link: /file/<file>?frame=<id>.');
  const file = decodeURIComponent(path[1]!);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(file)) throw new Error('Invalid project id in frame link.');
  return { file, frame };
}

/** Keep the ordered cascade, global rules, variants and font faces intact for reproduction. */
export function frameDesign(doc: DesignDocument, id: string) {
  const root = getElement(doc, id);
  if (!root || !isRoot(doc, id)) throw new Error('This frame no longer exists.');
  const ids = subtreeIds(doc, id);
  return {
    format: 'plastic-frame', version: 1,
    frame: { id, name: layerName(doc, id), page: pageOf(doc, id)!.file, position: doc.frames[id] ?? { x: 0, y: 0 } },
    html: serializeNode(doc, id),
    css: serializeStyleSheet(doc.styles), tokensCss: serializeTokenSheet(doc.tokens),
    nodes: ids.map((nodeId) => ({ ...doc.nodes[nodeId]!, ...(doc.names[nodeId] ? { name: doc.names[nodeId] } : {}) })),
    instructions: 'Use the supplied HTML hierarchy and ordered CSS/token CSS as the design source. Preserve dimensions, flex/grid, typography, SVG paths, images and responsive/state rules. Resolve asset URLs against assetBase. Verify the implementation visually at the supplied viewport size. Font availability and browser rendering affect fidelity; do not claim a pixel-perfect match without comparison.',
  };
}
