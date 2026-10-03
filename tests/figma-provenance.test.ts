// @vitest-environment jsdom
import { SceneGraph } from '@open-pencil/scene-graph';
import { describe, it, expect } from 'vitest';
import { exportFigFile } from '@open-pencil/core/io/formats/fig';
import { convertGraph, convertFigFile } from '../src/figma/convert.ts';
import { parseProject, serializeProject } from '../src/serialization/index.ts';
import { serializeHTML } from '../src/serialization/html.ts';
import { readImportTrace } from '../src/figma/provenance.ts';
import { benchmarkSchema } from '../src/figma/benchmark.ts';
import { setStyleOnNodes } from '../src/document/ops.ts';

function scene() {
  const graph = new SceneGraph();
  const card = graph.createNode('FRAME', graph.getPages()[0]!.id, { name: 'Card', width: 320, height: 200 });
  const image = graph.createNode('RECTANGLE', card.id, { name: 'Missing Image', width: 40, height: 40, fills: [{ type: 'IMAGE', imageHash: 'absent', opacity: 1, visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }] });
  graph.createNode('INSTANCE', card.id, { name: 'Instance', width: 20, height: 20 });
  return { graph, card, image };
}

describe('Figma import observations', () => {
  it('maps source nodes without polluting HTML; metadata survives edits and reloads', () => {
    const { graph, card } = scene();
    const out = convertGraph(graph, 'Trace');
    expect(readImportTrace(out.trace)).toEqual(out.trace);
    const entry = out.trace.nodes.find((n) => n.sourceId === card.id)!;
    expect(entry).toMatchObject({ page: 'index.html', name: 'Card', type: 'FRAME', bounds: { width: 320, height: 200 }, disposition: 'converted' });
    const { doc, meta } = parseProject(out.files);
    expect(doc.nodes[entry.plasticId]?.kind).toBe('element');
    const edited = setStyleOnNodes(doc, [entry.plasticId], 'width', '400px');
    const saved = serializeProject(edited, meta);
    expect(parseProject(saved).doc.importTrace).toEqual(out.trace);
    expect(out.trace.nodes.find((n) => n.sourceId === card.id)?.bounds.width).toBe(320); // original observation
    expect(serializeHTML(edited, edited.pages[0]!, { ids: false })).not.toContain(card.id);
    expect(saved['index.html']).not.toContain('data-figma');
    expect(out.report.timing!.conversionMs).toBeGreaterThanOrEqual(0);
  });

  it('associates missing assets and component expansion with the responsible source node', () => {
    const { graph, image } = scene();
    const out = convertGraph(graph, 'Diagnostics');
    expect(out.report.diagnostics).toContainEqual(expect.objectContaining({ sourceId: image.id, code: 'missing-image', severity: 'warning', property: 'fills' }));
    expect(out.report.diagnostics).toContainEqual(expect.objectContaining({ code: 'instance-expanded', severity: 'info' }));
    expect(new Set(out.trace.nodes.map((n) => n.sourceId)).size).toBe(out.trace.nodes.length);
  });

  it('retains original coordinates for children relocated into mask containers', () => {
    const { graph, card } = scene();
    const mask = graph.createNode('RECTANGLE', card.id, { name: 'Mask', isMask: true, x: 10, y: 20, width: 60, height: 60 });
    const child = graph.createNode('RECTANGLE', card.id, { name: 'Masked', x: 25, y: 35, width: 20, height: 20 });
    const out = convertGraph(graph, 'Mask');
    expect(out.trace.nodes.find((n) => n.sourceId === mask.id)).toBeDefined();
    expect(out.trace.nodes.find((n) => n.sourceId === child.id)?.bounds).toEqual({ x: 25, y: 35, width: 20, height: 20 });
  });

  it('marks composited SVG descendants as flattened, not independent editable layers', () => {
    const graph = new SceneGraph();
    const group = graph.createNode('GROUP', graph.getPages()[0]!.id, { name: 'Icon', width: 24, height: 24 });
    const line = graph.createNode('LINE', group.id, { name: 'Line', width: 24, height: 0 });
    const out = convertGraph(graph, 'Icon');
    const root = out.trace.nodes.find((n) => n.sourceId === group.id)!;
    expect(out.trace.nodes.find((n) => n.sourceId === line.id)).toMatchObject({ plasticId: root.plasticId, disposition: 'flattened' });
    expect(out.trace.diagnostics).toContainEqual(expect.objectContaining({ sourceId: group.id, code: 'vector-flattened' }));
  });

  it('records observations and decode timing through the binary .fig path', async () => {
    const graph = new SceneGraph();
    graph.createNode('FRAME', graph.getPages()[0]!.id, { name: 'Card', width: 320, height: 200 });
    const bytes = await exportFigFile(graph);
    const out = await convertFigFile(bytes, 'Binary');
    expect(out.trace.nodes.some((n) => n.name === 'Card')).toBe(true);
    const again = await convertFigFile(bytes, 'Binary');
    expect(again.trace.nodes.map((n) => n.sourceId)).toEqual(out.trace.nodes.map((n) => n.sourceId));
    expect(again.trace.nodes.map((n) => n.sceneId)).not.toEqual(out.trace.nodes.map((n) => n.sceneId));
    expect(readImportTrace(out.trace)).toEqual(out.trace);
    expect(out.report.timing!.decodeMs).toBeGreaterThanOrEqual(0);
    expect(parseProject(out.files).doc.importTrace).toEqual(out.trace);
  });

  it('drops malformed or future trace metadata without losing a design', () => {
    const out = convertGraph(scene().graph, 'Trace');
    const json = JSON.parse(out.files['project.json']!);
    json.importTrace.schemaVersion = 99;
    expect(parseProject({ ...out.files, 'project.json': JSON.stringify(json) }).doc.importTrace).toBeUndefined();
    expect(readImportTrace({ ...out.trace, nodes: [{ ...out.trace.nodes[0], bounds: { x: 0, y: 0, width: Infinity, height: 1 } }] })).toBeUndefined();
  });
});

describe('Fidelity benchmark manifests', () => {
  const manifest = { schemaVersion: 1, id: 'sample', source: { kind: 'synthetic', path: 'source.json' }, frames: [{ id: 'card', sourceId: 'card', width: 320, height: 200, reference: { kind: 'synthetic-html', path: 'reference.html' } }] };
  it('keeps synthetic verification separate from Figma ground truth', () => {
    expect(benchmarkSchema.safeParse(manifest).success).toBe(true);
    expect(benchmarkSchema.safeParse({ ...manifest, frames: [{ ...manifest.frames[0], reference: { kind: 'figma-png', path: 'reference.png' } }] }).success).toBe(false);
  });
  it('rejects escaping paths, duplicate output IDs and invalid dimensions', () => {
    expect(benchmarkSchema.safeParse({ ...manifest, source: { kind: 'figma', path: '../private.fig' } }).success).toBe(false);
    expect(benchmarkSchema.safeParse({ ...manifest, frames: [...manifest.frames, ...manifest.frames] }).success).toBe(false);
    expect(benchmarkSchema.safeParse({ ...manifest, frames: [{ ...manifest.frames[0], width: 0 }] }).success).toBe(false);
  });
});
