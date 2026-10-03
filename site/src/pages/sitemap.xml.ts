/** /sitemap.xml (served at the site root by the Worker). */
import type { APIRoute } from 'astro';
import { RELEASES } from '../data/changelog';
import { SITE } from '../data/site';

export const GET: APIRoute = () => {
  const updated = RELEASES[0]!.date;
  const pages = [
    { path: '/', priority: '1.0' },
    { path: '/changelog', priority: '0.8' },
    { path: '/download', priority: '0.6' },
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${new URL(p.path, SITE.url).href}</loc><lastmod>${updated}</lastmod><priority>${p.priority}</priority></url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
