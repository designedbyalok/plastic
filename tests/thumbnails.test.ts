// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { docFrom } from './helpers.ts';
import { parseProject, serializeProject } from '../src/serialization/index.ts';
import { readThumbnail } from '../src/serialization/project.ts';
const previewModule = '../worker/previews.ts';
const { previewHtml, serveFilePreview, servePreviewImage } = await import(previewModule);

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGAAAAABJRU5ErkJggg==';
const source = 'a'.repeat(64);
const version = 'b'.repeat(64);
const token = 'c'.repeat(32);
const thumbnail = { frame: 'frame', image, width: 1, height: 1, source };
const meta = { viewport: null, collapsed: [], activePage: null };
const html = '<html><head><title>Plastic</title><meta property="og:title" content="Plastic"><meta property="og:image" content="generic"><meta property="og:image:width" content="1672"><meta name="twitter:title" content="Plastic"></head><body><div id="root"></div></body></html>';
function env(options: { missing?: boolean; archived?: boolean; deletedThumbnail?: boolean; malformed?: boolean } = {}) {
  return {
    DB: { prepare: () => ({ bind: () => ({ first: async () => options.missing || options.archived ? null : { owner_id: 'owner', id: 'file', title: 'My <Design> "Title"', files: JSON.stringify({ 'project.json': version }) } }) }) },
    FILES: { get: async (key: string) => key.endsWith(version) ? { size: 500, text: async () => options.malformed ? '{bad' : JSON.stringify({ thumbnail: options.deletedThumbnail ? undefined : thumbnail }) } : null },
    ASSETS: { fetch: async () => new Response(html, { headers: { 'content-type': 'text/html', etag: 'old', 'content-length': String(html.length) } }) },
  } as never;
}

describe('file thumbnails', () => {
  it('round-trips a selected frame on a later page, including its raster snapshot', () => {
    const f = docFrom({ tag: 'section' });
    const doc = { ...f.doc, pages: [{ file: 'index.html', name: 'First', roots: [] }, { file: 'second.html', name: 'Second', roots: [f.root] }], thumbnail: { ...thumbnail, frame: f.root } };
    const parsed = parseProject(serializeProject(doc, meta));
    expect(parsed.doc.thumbnail).toEqual(doc.thumbnail);
    expect(parsed.doc.pages[1]?.roots).toContain(f.root);
  });
  it('drops a thumbnail when its frame has been deleted', () => {
    const f = docFrom({ tag: 'section' });
    const files = serializeProject(f.doc, meta);
    files['project.json'] = JSON.stringify({ ...JSON.parse(files['project.json']!), thumbnail });
    expect(parseProject(files).doc.thumbnail).toBeUndefined();
  });
  it('rejects scripted, oversized and malformed snapshot metadata', () => {
    expect(readThumbnail(thumbnail)).toEqual(thumbnail);
    for (const invalid of [{ image: 'data:image/svg+xml;base64,PHN2Zz4=' }, { width: 1201 }, { frame: '\"><script>' }, { source: 'invalid' }, { image: `data:image/png;base64,${'A'.repeat(2_000_000)}` }]) expect(readThumbnail({ ...thumbnail, ...invalid })).toBeUndefined();
  });
  it('escapes file titles and replaces generic metadata without duplicate image tags', () => {
    const rendered = previewHtml(html, '<script>"&', 'https://plastic.test/image?a=1&b=2', thumbnail);
    expect(rendered).toContain('&lt;script&gt;&quot;&amp; • Plastic');
    expect(rendered).not.toContain('<script>');
    expect(rendered.match(/property="og:image"/g)).toHaveLength(1);
    expect(rendered).toContain('content="1"');
    expect(rendered).not.toContain('1672');
    expect(rendered).toContain('<div id="root">');
  });
  it('serves file-specific HTML without requiring a crawler session', async () => {
    const response = await serveFilePreview(new Request(`https://plastic.test/file/file?preview=${token}&frame=frame`), env());
    const rendered = await response.text();
    expect(rendered).toContain(`https://plastic.test/api/previews/${token}/image?v=${version}`);
    expect(rendered).toContain('My &lt;Design&gt; &quot;Title&quot; • Plastic');
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('does not confuse equal file IDs in different accounts or reveal unknown previews', async () => {
    for (const url of [`https://plastic.test/file/other?preview=${token}`, 'https://plastic.test/file/file?preview=invalid']) expect(await (await serveFilePreview(new Request(url), env())).text()).toBe(html);
    expect(await (await serveFilePreview(new Request(`https://plastic.test/file/file?preview=${token}`), env({ missing: true }))).text()).toBe(html);
  });
  it('serves only the PNG bytes and supports HEAD', async () => {
    const url = `https://plastic.test/api/previews/${token}/image`;
    const response = await servePreviewImage(new Request(url), env(), token);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(await (await servePreviewImage(new Request(url, { method: 'HEAD' }), env(), token)).text()).toBe('');
  });
  it('stops serving removed, archived and malformed thumbnails', async () => {
    for (const options of [{ missing: true }, { archived: true }, { deletedThumbnail: true }, { malformed: true }]) expect((await servePreviewImage(new Request('https://plastic.test/image'), env(options), token)).status).toBe(404);
  });
});
