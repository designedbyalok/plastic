import { describe, it, expect, vi } from 'vitest';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import { captureFrames, type CapturePacket } from '../plugins/figma-reference-export/capture.ts';
import { referenceBundle, referenceManifest } from '../plugins/figma-reference-export/bundle.ts';
import { referenceCaptureSchema } from '../src/figma/referenceCapture.ts';
import { benchmarkSchema } from '../src/figma/benchmark.ts';

function png(width = 320, height = 200) {
  const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height); return bytes;
}
function frame() {
  const text = { id: '1:3', type: 'TEXT', name: 'Title', visible: true, characters: 'Hello', fontWeight: 500,
    absoluteBoundingBox: { x: 124, y: 64, width: 100, height: 28 }, hasMissingFont: false,
    getStyledTextSegments: () => [{ fontName: { family: 'Inter', style: 'Medium' }, fontWeight: 500 }] };
  const hidden = { id: '1:4', type: 'RECTANGLE', visible: false };
  const exportAsync = vi.fn(async (settings: { format: string }) => settings.format === 'PNG' ? png() : { document: { id: '1:2', name: 'Card' } });
  const value = { id: '1:2', name: 'Card', type: 'FRAME', parent: { type: 'PAGE' }, visible: true, width: 320, height: 200,
    absoluteTransform: [[1, 0, 100], [0, 1, 40]], absoluteBoundingBox: { x: 100, y: 40, width: 320, height: 200 }, children: [text, hidden], exportAsync };
  return { value, text, exportAsync, node: value as unknown as FrameNode };
}
const context = { fileName: 'Design', pageName: 'Page 1' };
async function packet(): Promise<CapturePacket> { return captureFrames([frame().node], context); }

describe('Figma reference capture', () => {
  it('exports actual Figma PNGs at 1x sRGB and derives frame-relative geometry and font requirements', async () => {
    const { node, exportAsync } = frame();
    const result = await captureFrames([node], context);
    expect(exportAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'PNG', constraint: { type: 'SCALE', value: 1 }, colorProfile: 'SRGB', useAbsoluteBounds: true }));
    expect(result.frames[0]!.nodes).toContainEqual({ sourceId: '1:3', bounds: { x: 24, y: 24, width: 100, height: 28 }, text: 'Hello', fontWeight: '500' });
    expect(result.frames[0]!.nodes.some((n) => n.sourceId === '1:4')).toBe(false);
    expect(result.frames[0]!.fonts).toEqual([{ family: 'Inter', style: 'Medium', weights: [500] }]);
  });
  it('fails rather than mixing JSON and PNG from different document states', async () => {
    const { node, exportAsync } = frame();
    exportAsync.mockResolvedValueOnce({ document: { id: '1:2', name: 'Before' } });
    exportAsync.mockResolvedValueOnce(png());
    exportAsync.mockResolvedValueOnce({ document: { id: '1:2', name: 'After' } });
    await expect(captureFrames([node], context)).rejects.toThrow('changed during capture');
  });
  it('refuses nested, rotated or empty selections and references with effects extending beyond their frame', async () => {
    await expect(captureFrames([], context)).rejects.toThrow('Select');
    const nested = frame(); nested.value.parent.type = 'FRAME';
    await expect(captureFrames([nested.node], context)).rejects.toThrow('top-level');
    const rotated = frame(); rotated.value.absoluteTransform[0]![0] = 0;
    await expect(captureFrames([rotated.node], context)).rejects.toThrow('rotated');
    const oversized = frame(); oversized.exportAsync.mockImplementation(async (s) => s.format === 'PNG' ? png(350) : { document: { id: '1:2', name: 'Card' } });
    await expect(captureFrames([oversized.node], context)).rejects.toThrow('beyond');
  });
  it('reports missing fonts instead of using a substituted Figma screenshot as a golden', async () => {
    const bad = frame(); bad.text.hasMissingFont = true;
    await expect(captureFrames([bad.node], context)).rejects.toThrow('missing fonts');
  });
});

describe('Local reference bundles', () => {
  it('packages source bytes, true reference paths, raw JSON and verifiable hashes in a compatible manifest', async () => {
    const source = zipSync({ 'canvas.fig': strToU8('fig-kiwi-test') });
    const files = unzipSync(await referenceBundle(await packet(), source, 'card'));
    const manifest = benchmarkSchema.parse(JSON.parse(strFromU8(files['manifest.json']!)));
    expect(manifest.source).toEqual({ kind: 'figma', path: 'source.fig' });
    expect(manifest.capture).toBe('capture.json');
    expect(files['source.fig']).toEqual(source);
    expect(files['references/frame-1.png']).toEqual(png());
    const capture = referenceCaptureSchema.parse(JSON.parse(strFromU8(files['capture.json']!)));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(source).buffer))).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(capture.hashes['source.fig']).toBe(digest);
    expect(capture.frames[0]!.name).toBe('Card');
    expect(JSON.parse(strFromU8(files['nodes/frame-1.json']!))).toEqual({ document: { id: '1:2', name: 'Card' } });
  });
  it('supports legacy raw fig-kiwi copies and refuses unrelated attachments and unsafe bundle names', async () => {
    const capture = await packet();
    await expect(referenceBundle(capture, strToU8('fig-kiwi-test'), 'raw')).resolves.toBeInstanceOf(Uint8Array);
    await expect(referenceBundle(capture, png(), 'wrong')).rejects.toThrow('native .fig');
    expect(() => referenceManifest(capture, '../escape')).toThrow('short name');
  });
});
