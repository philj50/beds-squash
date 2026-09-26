import type { APIRoute } from 'astro';
import { getNews } from '@/lib/content';
import { SITE, url } from '@/lib/site';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site }) => {
  const posts = await getNews();
  const origin = site ?? new URL('https://example.invalid');
  const link = (p: string) => new URL(url(p), origin).href;

  const items = posts
    .slice(0, 30)
    .map(
      (p) => `
    <item>
      <title>${esc(p.data.title)}</title>
      <link>${link(`/news/${p.id}/`)}</link>
      <guid isPermaLink="true">${link(`/news/${p.id}/`)}</guid>
      <pubDate>${p.data.date.toUTCString()}</pubDate>
      ${p.data.summary ? `<description>${esc(p.data.summary)}</description>` : ''}
      <category>${esc(p.data.category)}</category>
    </item>`,
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE.name)} — News</title>
    <link>${link('/news/')}</link>
    <atom:link href="${link('/rss.xml')}" rel="self" type="application/rss+xml" />
    <description>${esc(SITE.description)}</description>
    <language>en-gb</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
