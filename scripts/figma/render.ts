/** Benchmark-only browser entry: use the same reconciler and stylesheet writers as the canvas. */
import { DomRenderer } from '../../src/canvas/renderer.ts';
import { parseProject } from '../../src/serialization/index.ts';
import { serializeStyleSheet, serializeTokenSheet } from '../../src/document/css.ts';

async function render(files: Record<string, string>, root: string) {
  const { doc } = parseProject(files);
  if (doc.nodes[root]?.kind !== 'element') throw new Error('Benchmark frame is missing.');
  for (const css of [serializeTokenSheet(doc.tokens), serializeStyleSheet(doc.styles)]) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  }
  new DomRenderer(document.body).render(doc, root);
  await document.fonts.ready;
  for (const image of document.images) {
    await image.decode(); // A missing or invalid image fails the evaluation, rather than scoring an empty fill.
  }
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
}
(window as unknown as { renderBenchmark: typeof render }).renderBenchmark = render;
