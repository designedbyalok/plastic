import { strToU8, zip, unzipSync, type Zippable } from 'fflate';
import type { CapturePacket } from './capture.ts';

export function referenceManifest(packet: CapturePacket, id: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new Error('Use a short name with lowercase letters, numbers and hyphens.');
  return {
    schemaVersion: 1,
    id,
    source: { kind: 'figma', path: 'source.fig' },
    capture: 'capture.json',
    frames: packet.frames.map((f) => ({ id: f.id, sourceId: f.sourceId, width: f.width, height: f.height,
      reference: { kind: 'figma-png', path: `references/${f.id}.png` }, maxDiffRatio: 0.01, nodes: f.nodes })),
  };
}
export async function referenceBundle(packet: CapturePacket, source: Uint8Array, id: string): Promise<Uint8Array> {
  // Modern .fig files are ZIP archives containing Kiwi data; older files contain raw Kiwi.
  const raw = (data: Uint8Array) => String.fromCharCode(...data.slice(0, 8)) === 'fig-kiwi';
  let valid = raw(source);
  if (!valid) {
    try { valid = Object.values(unzipSync(source, { filter: (file) => ['canvas.fig', 'canvas'].includes(file.name) })).some(raw); } catch { /* not a .fig archive */ }
  }
  if (!valid) throw new Error('Attach a native .fig local copy saved from this Figma file.');
  const files: Zippable = { 'source.fig': [source, { level: 0 }], 'manifest.json': strToU8(JSON.stringify(referenceManifest(packet, id), null, 2)) };
  const hash = async (data: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashes: Record<string, string> = { 'source.fig': await hash(source) };
  for (const f of packet.frames) {
    files[`references/${f.id}.png`] = [f.png, { level: 0 }];
    files[`nodes/${f.id}.json`] = strToU8(JSON.stringify(f.rest));
    hashes[`references/${f.id}.png`] = await hash(f.png);
    hashes[`nodes/${f.id}.json`] = await hash(strToU8(JSON.stringify(f.rest)));
  }
  const { frames, ...context } = packet;
  files['capture.json'] = strToU8(JSON.stringify({ ...context, hashes, frames: frames.map(({ png: _png, rest: _rest, nodes: _nodes, ...f }) => f) }, null, 2));
  files['README.txt'] = strToU8('Plastic Figma Reference Bundle\n\nUnzip into a local fixture folder. The bundle contains your complete attached .fig file.\nRun: bun run benchmark:figma path/to/manifest.json\nPNG references came from Figma at 1x in sRGB. Never replace them with Plastic renders.\nAttach any required, licensed WOFF2 fonts through the manifest fonts field.\nCapture metadata records requested font families/styles, not font binaries.\nNo designs are uploaded by the exporter. This is not a training dataset enrollment.\n');
  return new Promise((resolve, reject) => zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
}
