/** Local evaluation only. Never uploads files, trains models, or updates reference images. */
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { JSDOM } from 'jsdom';
import { SceneGraph } from '@open-pencil/scene-graph';
import { referenceCaptureSchema } from '../../src/figma/referenceCapture.ts';
import { benchmarkSchema } from '../../src/figma/benchmark.ts';
import { parseProject } from '../../src/serialization/index.ts';
import { subtreeIds } from '../../src/document/tree.ts';
import { convertGraph, convertFigFile } from '../../src/figma/convert.ts';

const manifests = process.argv.slice(2);
if (!manifests.length) manifests.push('tests/fixtures/figma-import/layout.json');
const output = resolve(process.env.PLASTIC_BENCHMARK_OUTPUT ?? 'artifacts/figma-import');
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const bundle = await Bun.build({ entrypoints: ['scripts/figma/render.ts'], target: 'browser', minify: true });
if (!bundle.success) throw new Error(bundle.logs.join('\n'));
const renderer = await bundle.outputs[0].text();
const fontCss = (await readFile('src/assets/fonts/inter/inter.css', 'utf8')).replaceAll('url("./', 'url("/fonts/');
const fonts = Object.fromEntries(await Promise.all(['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'].map(async (name) => [`/fonts/${name}.woff2`, await readFile(`src/assets/fonts/inter/${name}.woff2`)])));
const base = '<!doctype html><html><head><meta charset="utf-8"><style>:where(html,body){margin:0;padding:0;overflow:hidden;background:transparent}' + fontCss + '</style></head><body><script src="/render.js"></script></body></html>';
let active = null;
let fixtureFontCss = '';
let fixtureFonts = {};
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/') return new Response(base.replace('</style>', fixtureFontCss + '</style>'), { headers: { 'content-type': 'text/html' } });
  if (path === '/render.js') return new Response(renderer, { headers: { 'content-type': 'text/javascript' } });
  if (fonts[path] || fixtureFonts[path]) return new Response(fonts[path] ?? fixtureFonts[path], { headers: { 'content-type': 'font/woff2' } });
  const bytes = active?.assets[decodeURIComponent(path.slice(1))];
  return bytes ? new Response(bytes) : new Response('Not found', { status: 404 });
} });
const origin = `http://127.0.0.1:${server.port}`;
let browser;
const runs = [];
let failed = false;

async function inside(root, path) {
  const actual = await realpath(resolve(root, path));
  const rel = relative(root, actual);
  if (rel.startsWith('..') || rel.startsWith('/')) throw new Error('Fixture path escapes its directory.');
  return readFile(actual);
}
function syntheticScene(input) {
  if (!Array.isArray(input.nodes)) throw new Error('Synthetic scene needs nodes.');
  const graph = new SceneGraph();
  const ids = new Map([['page', graph.getPages()[0].id]]);
  const allowed = new Set(['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'LINE', 'GROUP', 'COMPONENT', 'INSTANCE', 'VECTOR']);
  for (const node of input.nodes) {
    if (typeof node.key !== 'string' || ids.has(node.key) || !allowed.has(node.type) || !ids.has(node.parent)) throw new Error('Invalid or out-of-order scene node.');
    ids.set(node.key, graph.createNode(node.type, ids.get(node.parent), node.props).id);
  }
  return { graph, ids };
}
async function pageFor(frame) {
  const page = await browser.newPage({ viewport: { width: frame.width, height: frame.height }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    return url.startsWith(origin + '/') || url.startsWith('data:') ? route.continue() : route.abort();
  });
  await page.goto(origin);
  return { page, errors };
}
try {
  browser = await chromium.launch({ ...(process.env.PLASTIC_CHROMIUM_PATH ? { executablePath: process.env.PLASTIC_CHROMIUM_PATH } : {}) });
  for (const manifestPath of manifests) {
    const root = await realpath(dirname(resolve(manifestPath)));
    const manifest = benchmarkSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    const input = await inside(root, manifest.source.path);
    fixtureFonts = {};
    fixtureFontCss = '';
    for (const [index, f] of manifest.fonts.entries()) {
      const url = `/fixture-fonts/${index}.woff2`;
      fixtureFonts[url] = await inside(root, f.path);
      fixtureFontCss += `@font-face{font-family:${JSON.stringify(f.family)};src:url(${JSON.stringify(url)}) format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:block}`;
    }
    const captured = manifest.capture ? referenceCaptureSchema.parse(JSON.parse((await inside(root, manifest.capture)).toString())) : null;
    if (captured) {
      for (const [path, hash] of Object.entries(captured.hashes)) {
        if (createHash('sha256').update(await inside(root, path)).digest('hex') !== hash) throw new Error(`Capture checksum mismatch: ${path}`);
      }
      for (const path of [manifest.source.path, ...manifest.frames.map((f) => f.reference.path)]) {
        if (!captured.hashes[path]) throw new Error(`Missing capture checksum: ${path}`);
      }
    }
    const sourceHash = createHash('sha256').update(input).digest('hex');
    let ids = new Map();
    if (manifest.source.kind === 'figma') active = await convertFigFile(new Uint8Array(input), manifest.id);
    else {
      const scene = syntheticScene(JSON.parse(input.toString()));
      ids = scene.ids;
      active = convertGraph(scene.graph, manifest.id);
    }
    const fontHashes = [{ family: 'Inter', style: 'normal', weight: '100 900', sha256: createHash('sha256').update(Buffer.concat(Object.values(fonts))).digest('hex') }, ...manifest.fonts.map((f, index) => ({ ...f, sha256: createHash('sha256').update(fixtureFonts[`/fixture-fonts/${index}.woff2`]).digest('hex') }))];
    const result = { schemaVersion: 1, id: manifest.id, sourceKind: manifest.source.kind, sourceHash, fontHashes, comparison: { threshold: 0.1, includeAA: false, geometryTolerancePx: 0.75 }, importerVersion: active.trace.importerVersion, timing: active.report.timing, diagnostics: active.trace.diagnostics, ...(captured ? { capture: { exporterVersion: captured.exporterVersion, capturedAt: captured.capturedAt } } : {}), frames: [] };
    const imported = parseProject(active.files).doc;
    const mappings = new Map();
    for (const n of active.trace.nodes) {
      const entries = mappings.get(n.sourceId) ?? []; entries.push(n); mappings.set(n.sourceId, entries);
    }
    const folder = join(output, manifest.id);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'import-trace.json'), JSON.stringify(active.trace, null, 2));
    for (const frame of manifest.frames) {
      const item = { id: frame.id, referenceKind: frame.reference.kind, passed: false };
      const { page, errors } = await pageFor(frame);
      try {
        const sourceId = ids.get(frame.sourceId) ?? frame.sourceId;
        const candidates = mappings.get(sourceId) ?? [];
        const mapping = candidates.find((n) => n.disposition === 'converted' && imported.pages.some((p) => p.roots.includes(n.plasticId)));
        if (!mapping || mapping.disposition !== 'converted') throw new Error('Source frame has no converted node mapping.');
        const snapshot = captured?.frames.find((f) => f.id === frame.id);
        if (captured && (!snapshot || snapshot.sourceId !== frame.sourceId || snapshot.name !== mapping.name || Math.abs(snapshot.sourceWidth - mapping.bounds.width) > 0.01 || Math.abs(snapshot.sourceHeight - mapping.bounds.height) > 0.01 || snapshot.width !== frame.width || snapshot.height !== frame.height))
          throw new Error('The attached .fig does not match the captured frame. Save a fresh local copy and capture again.');
        // Font substitutions must not silently pass a screenshot comparison.
        const requiredFonts = snapshot ? snapshot.fonts.map((f) => ({ ...f, italic: /italic|oblique/i.test(f.style) })) : active.report.fonts;
        const unpinned = requiredFonts.filter((f) => {
          const faces = manifest.fonts.filter((face) => face.family === f.family);
          const covers = (weight, style) => (f.family === 'Inter' && style === 'normal') || faces.some((face) => {
            const [min, max = min] = face.weight.split(' ').map(Number);
            return face.style === style && weight >= min && weight <= max;
          });
          return f.weights.some((weight) => !covers(weight, f.italic ? 'italic' : 'normal'));
        });
        if (unpinned.length) throw new Error(`Unpinned fonts: ${unpinned.map((f) => f.family).join(', ')}. Add font support before evaluating this fixture.`);
        await page.evaluate(async ({ files, id }) => { await window.renderBenchmark(files, id); }, { files: active.files, id: mapping.plasticId });
        const failedFonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family));
        if (failedFonts.length) throw new Error(`Font loading failed: ${failedFonts.join(', ')}`);
        const withinFrame = new Set(subtreeIds(imported, mapping.plasticId));
        const geometry = [];
        for (const expected of frame.nodes) {
          const source = ids.get(expected.sourceId) ?? expected.sourceId;
          const entry = (mappings.get(source) ?? []).find((n) => withinFrame.has(n.plasticId) && n.disposition === 'converted');
          if (!entry || entry.disposition !== 'converted') { geometry.push({ sourceId: expected.sourceId, passed: false, reason: 'Missing editable layer' }); continue; }
          const actual = await page.evaluate((id) => {
            const el = document.querySelector(`[data-pl-id="${id}"]`);
            if (!el) return null;
            const r = el.getBoundingClientRect(), css = getComputedStyle(el);
            return { bounds: { x: r.x, y: r.y, width: r.width, height: r.height }, text: el.textContent, fontWeight: css.fontWeight, display: css.display };
          }, entry.plasticId);
          const pass = actual && Object.entries(expected.bounds).every(([key, value]) => Math.abs(actual.bounds[key] - value) <= 0.75)
            && ['text', 'fontWeight', 'display'].every((key) => expected[key] === undefined || expected[key] === actual[key]);
          geometry.push({ sourceId: expected.sourceId, passed: !!pass, expected, actual });
        }
        const rendered = await page.screenshot({ animations: 'disabled', caret: 'hide' });
        await writeFile(join(folder, frame.id + '-actual.png'), rendered);
        let reference;
        if (frame.reference.kind === 'figma-png') reference = await inside(root, frame.reference.path);
        else {
          const ref = await pageFor(frame);
          try {
            const html = (await inside(root, frame.reference.path)).toString();
            await ref.page.setContent(html);
            await ref.page.addStyleTag({ content: fontCss + fixtureFontCss });
            await ref.page.evaluate(async () => { await document.fonts.ready; for (const img of document.images) await img.decode(); });
            reference = await ref.page.screenshot({ animations: 'disabled', caret: 'hide' });
            if (ref.errors.length) throw new Error(ref.errors.join('; '));
          } finally { await ref.page.close(); }
        }
        await writeFile(join(folder, frame.id + '-reference.png'), reference);
        const actualPng = PNG.sync.read(rendered), expectedPng = PNG.sync.read(reference);
        if (expectedPng.width !== frame.width || expectedPng.height !== frame.height) throw new Error('Reference dimensions differ from the fixed viewport.');
        const diff = new PNG({ width: frame.width, height: frame.height });
        const different = pixelmatch(actualPng.data, expectedPng.data, diff.data, frame.width, frame.height, { threshold: 0.1, includeAA: false });
        await writeFile(join(folder, frame.id + '-diff.png'), PNG.sync.write(diff));
        const ratio = different / (frame.width * frame.height);
        Object.assign(item, { referenceHash: createHash('sha256').update(reference).digest('hex'), diffPixels: different, diffRatio: ratio, maxDiffRatio: frame.maxDiffRatio, geometry, errors, passed: ratio <= frame.maxDiffRatio && geometry.every((g) => g.passed) && !errors.length });
      } catch (error) { item.error = String(error.message ?? error); }
      finally { await page.close(); }
      result.frames.push(item);
      failed ||= !item.passed;
      console.log(`${item.passed ? 'PASS' : 'FAIL'} ${manifest.id}/${frame.id} (${item.referenceKind})${item.error ? ': ' + item.error : `: ${(item.diffRatio * 100).toFixed(3)}% different`}`);
    }
    runs.push(result);
    await writeFile(join(folder, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  }
  await writeFile(join(output, 'summary.json'), JSON.stringify({ schemaVersion: 1, browser: browser.version(), passed: !failed, runs }, null, 2) + '\n');
} finally { await browser?.close(); server.stop(true); dom.window.close(); }
if (failed) process.exitCode = 1;
