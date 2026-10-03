import type { Env } from './env.ts';
import { readThumbnail } from '../src/serialization/project.ts';
import type { FileThumbnail } from '../src/document/types.ts';

export const PREVIEW_ID = /^[a-f0-9]{32}$/;
interface PreviewRow { owner_id: string; id: string; title: string; files: string }

async function readPreview(env: Env, previewId: string): Promise<{ row: PreviewRow; thumbnail?: FileThumbnail; version?: string } | null> {
  if (!PREVIEW_ID.test(previewId)) return null;
  const row = await env.DB.prepare('select owner_id, id, title, files from project where preview_id = ? and archived_at is null').bind(previewId).first<PreviewRow>();
  if (!row) return null;
  let files: Record<string, string>;
  try { files = JSON.parse(row.files) as Record<string, string>; } catch { return null; }
  const version = files['project.json'];
  if (!version || !/^[a-f0-9]{32,64}$/.test(version)) return { row };
  const prefix = `users/${row.owner_id}/projects/${row.id}/`;
  let object = await env.FILES.get(`${prefix}revisions/project.json/${version}`);
  if (!object) {
    const legacy = await env.FILES.get(`${prefix}project.json`);
    if (legacy?.etag === version) object = legacy;
  }
  if (!object || object.size > 2_100_000) return { row };
  try {
    const project = JSON.parse(await object.text()) as { thumbnail?: unknown };
    return { row, version, thumbnail: readThumbnail(project.thumbnail) };
  } catch { return { row }; }
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function previewHtml(html: string, title: string, image: string, thumbnail?: FileThumbnail): string {
  const name = escape(`${title} • Plastic`);
  const description = 'Designed with Plastic. Indestructible Design.';
  const alt = 'File thumbnail selected in Plastic';
  const tags = `<title>${name}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${name}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${escape(image)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="${alt}" />
    ${thumbnail ? `<meta property="og:image:width" content="${thumbnail.width}" /><meta property="og:image:height" content="${thumbnail.height}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${name}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${escape(image)}" />
    <meta name="twitter:image:alt" content="${alt}" />`;
  return html.replace(/<title>[\s\S]*?<\/title>/i, '').replace(/<meta\s+(?:name|property)="(?:description|og:(?:title|description|image[^" ]*)|twitter:[^" ]*)"[^>]*>/gi, '').replace('</head>', `${tags}\n  </head>`);
}

export async function serveFilePreview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const preview = await readPreview(env, url.searchParams.get('preview') ?? '');
  const response = await env.ASSETS.fetch(request);
  if (!preview || url.pathname !== `/file/${encodeURIComponent(preview.row.id)}` || !response.headers.get('content-type')?.includes('text/html')) return response;
  const image = preview.thumbnail ? `${url.origin}/api/previews/${url.searchParams.get('preview')}/image?v=${preview.version}` : `${url.origin}/opengraph.png`;
  const html = previewHtml(await response.text(), preview.row.title, image, preview.thumbnail);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('cache-control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : html, { status: response.status, headers });
}

/** Public raster only. Project HTML, CSS and assets still require the owner's session. */
export async function servePreviewImage(request: Request, env: Env, previewId: string): Promise<Response> {
  const notFound = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  const preview = await readPreview(env, previewId);
  if (!preview?.thumbnail) return notFound();
  try {
    const binary = atob(preview.thumbnail.image.split(',')[1]!);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return notFound();
    return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' } });
  } catch { return notFound(); }
}
