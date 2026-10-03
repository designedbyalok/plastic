/// <reference types="@figma/plugin-typings" />
/** Read-only capture. Screenshots always come from Figma, never from Plastic. */
export const EXPORTER_VERSION = '1.0.0';
export interface NodeExpectation {
  sourceId: string;
  bounds: { x: number; y: number; width: number; height: number };
  text?: string;
  fontWeight?: string;
}
export interface CapturedFrame {
  id: string;
  sourceId: string;
  name: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  png: Uint8Array;
  rest: Object;
  nodes: NodeExpectation[];
  fonts: { family: string; style: string; weights: number[] }[];
}
export interface CapturePacket {
  schemaVersion: 1;
  exporterVersion: string;
  fileName: string;
  pageName: string;
  capturedAt: string;
  frames: CapturedFrame[];
}
export function exportable(node: SceneNode): node is FrameNode | ComponentNode {
  return (node.type === 'FRAME' || node.type === 'COMPONENT') && node.parent?.type === 'PAGE';
}
function dimensions(png: Uint8Array) {
  const magic = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 24 || !magic.every((n, i) => png[i] === n)) throw new Error('Figma did not return a PNG.');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
function expectations(frame: FrameNode | ComponentNode) {
  const bounds = frame.absoluteBoundingBox!;
  const nodes: NodeExpectation[] = [];
  const fonts = new Map<string, { family: string; style: string; weights: number[] }>();
  const visit = (node: SceneNode) => {
    if (!node.visible) return; // A hidden ancestor also hides its descendants.
    const r = node.absoluteBoundingBox;
    // Expanded instance IDs (I…;…) don't necessarily survive .fig decoding. Retain them in
    // REST JSON, but avoid asserting geometry against an invented ID correspondence.
    if (r && /^\d+:\d+$/.test(node.id)) {
      const check: NodeExpectation = { sourceId: node.id, bounds: { x: r.x - bounds.x, y: r.y - bounds.y, width: r.width, height: r.height } };
      if (node.type === 'TEXT') {
        check.text = node.characters;
        if (typeof node.fontWeight === 'number') check.fontWeight = String(node.fontWeight);
      }
      nodes.push(check);
    }
    if (node.type === 'TEXT') {
      if (node.hasMissingFont) throw new Error(`Install the missing fonts in “${node.name}” before capturing a reference.`);
      for (const segment of node.getStyledTextSegments(['fontName', 'fontWeight'])) {
        const font = segment.fontName;
        const key = `${font.family}\n${font.style}`;
        const entry = fonts.get(key) ?? { ...font, weights: [] };
        if (!entry.weights.includes(segment.fontWeight)) entry.weights.push(segment.fontWeight);
        fonts.set(key, entry);
      }
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(frame);
  return { nodes, fonts: [...fonts.values()] };
}
export async function captureFrames(
  frames: readonly (FrameNode | ComponentNode)[],
  context: { fileName: string; pageName: string },
  progress: (done: number, total: number, name: string) => void = () => {},
): Promise<CapturePacket> {
  if (!frames.length) throw new Error('Select at least one top-level frame or component.');
  const captured: CapturedFrame[] = [];
  for (const [index, frame] of frames.entries()) {
    if (!exportable(frame) || !frame.visible || !frame.absoluteBoundingBox) throw new Error('Select visible top-level frames or components on the current page.');
    const t = frame.absoluteTransform;
    if (Math.abs(t[0][0] - 1) > 0.0001 || Math.abs(t[1][1] - 1) > 0.0001 || Math.abs(t[0][1]) > 0.0001 || Math.abs(t[1][0]) > 0.0001)
      throw new Error(`“${frame.name}” is rotated or scaled. Use an untransformed top-level frame for this benchmark.`);
    if (frame.width <= 0 || frame.height <= 0 || frame.width > 8192 || frame.height > 8192) throw new Error('Reference frames must be between 1 and 8192 pixels per side.');
    progress(index, frames.length, frame.name);
    const before = await frame.exportAsync({ format: 'JSON_REST_V1' });
    const observed = expectations(frame);
    const png = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 }, contentsOnly: true, useAbsoluteBounds: true, colorProfile: 'SRGB' });
    const after = await frame.exportAsync({ format: 'JSON_REST_V1' });
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`“${frame.name}” changed during capture. Capture again after editing finishes.`);
    const size = dimensions(png);
    if (Math.abs(size.width - frame.width) > 1 || Math.abs(size.height - frame.height) > 1)
      throw new Error(`“${frame.name}” exports beyond its frame dimensions. Capture a frame with clipped content.`);
    captured.push({ id: `frame-${index + 1}`, sourceId: frame.id, name: frame.name, sourceWidth: frame.width, sourceHeight: frame.height, ...size, png, rest: before, ...observed });
  }
  progress(frames.length, frames.length, 'Complete');
  return { schemaVersion: 1, exporterVersion: EXPORTER_VERSION, ...context, capturedAt: new Date().toISOString(), frames: captured };
}
