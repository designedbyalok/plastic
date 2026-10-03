/** End-to-end local test with simulated Figma transport; not a genuine-reference corpus. */
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { SceneGraph } from '@open-pencil/scene-graph';
import { exportFigFile } from '@open-pencil/core/io/formats/fig';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { convertFigFile } from '../../src/figma/convert.ts';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const folder = await mkdtemp(join(tmpdir(), 'plastic-reference-plugin-'));
const dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser;
const graph = new SceneGraph();
graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Test Card', width: 320, height: 200, fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }] });
const source = await exportFigFile(graph);
const converted = await convertFigFile(source, 'Test');
const mapping = converted.trace.nodes.find((n) => n.name === 'Test Card');
assert(mapping, 'Binary source node mapping is absent.');
const image = new PNG({ width: 320, height: 200 }); image.data.fill(255);
const png = PNG.sync.write(image);
const packet = { schemaVersion: 1, exporterVersion: '1.0.0', fileName: 'Test', pageName: 'Page 1', capturedAt: new Date().toISOString(), frames: [{ id: 'frame-1', sourceId: mapping.sourceId, name: 'Test Card', sourceWidth: 320, sourceHeight: 200, width: 320, height: 200, png: [...png], rest: { document: { id: mapping.sourceId, name: 'Test Card' } }, nodes: [{ sourceId: mapping.sourceId, bounds: { x: 0, y: 0, width: 320, height: 200 } }], fonts: [] }] };
const html = await readFile('plugins/figma-reference-export/dist/ui.html', 'utf8');
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(html, { headers: { 'content-type': 'text/html' } }) });
let browser;
const checks = [];
async function run(args, expected = 0) {
  const child = Bun.spawn(['bun', ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PLASTIC_BENCHMARK_OUTPUT: join(folder, 'results') } });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  assert(exit === expected, `Expected exit ${expected}, got ${exit}: ${stdout}\n${stderr}`);
  return stdout;
}
try {
  browser = await chromium.launch({ ...(process.env.PLASTIC_CHROMIUM_PATH ? { executablePath: process.env.PLASTIC_CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`);
  assert(await page.locator('#capture').isDisabled(), 'Capture needs a valid selection.');
  await page.evaluate(() => window.postMessage({ pluginMessage: { type: 'selection', count: 1, invalid: 0 } }, '*'));
  await page.locator('#capture').click();
  await page.evaluate((packet) => {
    packet.frames[0].png = new Uint8Array(packet.frames[0].png);
    window.postMessage({ pluginMessage: { type: 'captured', packet } }, '*');
  }, packet);
  await page.locator('#status').filter({ hasText: 'References Ready' }).waitFor();
  assert(await page.locator('#download').isDisabled(), 'Download needs the matching .fig attachment.');
  await page.locator('#source').setInputFiles({ name: 'test.fig', mimeType: 'application/octet-stream', buffer: Buffer.from(source) });
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadEvent;
  const bundlePath = join(folder, 'reference.zip');
  await download.saveAs(bundlePath);
  assert(download.suggestedFilename() === 'figma-reference-figma-reference.zip', 'Bundle download name is wrong.');
  assert(!errors.length, errors.join('; '));
  checks.push('Plugin UI selection, attachment and ZIP download');
  await run(['scripts/figma/unpack.mjs', bundlePath, join(folder, 'fixture')]);
  checks.push('Bundle extraction and checksum verification');
  await run(['scripts/figma/benchmark.mjs', join(folder, 'fixture/manifest.json')]);
  checks.push('Binary .fig → canvas renderer → reference diff and geometry evaluation');
  const report = JSON.parse(await readFile(join(folder, 'results/figma-reference/report.json'), 'utf8'));
  assert(report.frames[0].passed && report.frames[0].diffRatio === 0, 'Local simulated reference did not match.');

  const original = await readFile(bundlePath);
  const corrupt = unzipSync(original); corrupt['references/frame-1.png'][20] ^= 1;
  const corruptPath = join(folder, 'corrupt.zip'); await writeFile(corruptPath, zipSync(corrupt));
  await run(['scripts/figma/unpack.mjs', corruptPath, join(folder, 'corrupt-fixture')], 1);
  assert(!(await stat(join(folder, 'corrupt-fixture')).catch(() => null)), 'Corrupt references must not be written.');
  checks.push('Corrupt reference rejected before writing files');
  const unsafePath = join(folder, 'unsafe.zip'); await writeFile(unsafePath, zipSync({ '../escape.txt': strToU8('unsafe') }));
  await run(['scripts/figma/unpack.mjs', unsafePath, join(folder, 'unsafe-fixture')], 1);
  checks.push('Escaping archive paths rejected');
  const capturePath = join(folder, 'fixture/capture.json');
  const capture = JSON.parse(await readFile(capturePath, 'utf8')); capture.frames[0].sourceWidth = 321;
  await writeFile(capturePath, JSON.stringify(capture));
  await run(['scripts/figma/benchmark.mjs', join(folder, 'fixture/manifest.json')], 1);
  const mismatched = JSON.parse(await readFile(join(folder, 'results/figma-reference/report.json'), 'utf8'));
  assert(mismatched.frames[0].error.includes('does not match'), 'Mismatched source snapshots must fail.');
  checks.push('Mismatched local copy rejected even when the original pixels matched');
  // Keep the fixture as originally captured for later inspection.
  capture.frames[0].sourceWidth = 320; await writeFile(capturePath, JSON.stringify(capture));
  await writeFile(join(folder, 'checks.json'), JSON.stringify({ simulatedFigmaTransport: true, genuineReferenceCorpus: false, passed: true, checks }, null, 2));
  console.log(`PASS ${checks.length} plugin pipeline checks. Disposable artifacts: ${folder}`);
} finally { await browser?.close(); server.stop(true); dom.window.close(); }
