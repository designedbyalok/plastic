/** Unpack a local reference bundle after validating paths, size limits and file hashes. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { benchmarkSchema } from '../../src/figma/benchmark.ts';
import { referenceCaptureSchema } from '../../src/figma/referenceCapture.ts';
const [input, destination] = process.argv.slice(2);
if (!input || !destination) throw new Error('Usage: bun run reference:unpack bundle.zip new-fixture-directory');
const bytes = await readFile(input);
if (bytes.length > 256 * 1024 * 1024) throw new Error('Reference bundles can be up to 256 MB.');
let total = 0;
const files = unzipSync(bytes, { filter: (entry) => {
  if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(entry.name) || entry.name.split('/').some((s) => s === '..' || s === '.')) throw new Error('Unsafe archive path.');
  total += entry.originalSize;
  if (total > 512 * 1024 * 1024 || entry.originalSize > 256 * 1024 * 1024) throw new Error('Reference archive is too large when expanded.');
  return true;
} });
const text = (name) => {
  if (!files[name]) throw new Error(`Missing ${name}.`);
  return JSON.parse(new TextDecoder().decode(files[name]));
};
const manifest = benchmarkSchema.parse(text('manifest.json'));
if (manifest.source.kind !== 'figma' || manifest.capture !== 'capture.json') throw new Error('Not a Figma reference export bundle.');
const capture = referenceCaptureSchema.parse(text(manifest.capture));
const required = [manifest.source.path, ...manifest.frames.flatMap((f) => [f.reference.path, `nodes/${f.id}.json`])];
for (const path of required) {
  if (!files[path] || !capture.hashes[path]) throw new Error(`Missing captured file or checksum: ${path}`);
  if (createHash('sha256').update(files[path]).digest('hex') !== capture.hashes[path]) throw new Error(`Capture checksum mismatch: ${path}`);
}
const target = resolve(destination);
// A new directory avoids overwriting existing goldens or mixing old/new references.
await mkdir(target);
for (const [name, data] of Object.entries(files)) {
  const path = join(target, name);
  const parent = name.includes('/') ? join(target, name.slice(0, name.lastIndexOf('/'))) : target;
  await mkdir(parent, { recursive: true });
  await writeFile(path, data, { flag: 'wx' });
}
console.log(`Extracted ${manifest.frames.length} genuine-reference cases to ${target}. Run: bun run benchmark:figma ${join(target, 'manifest.json')}`);
