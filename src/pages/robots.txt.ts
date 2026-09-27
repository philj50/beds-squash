import type { APIRoute } from 'astro';

/** Tells crawlers the public site is open and the content editor is not. */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const origin = site ?? new URL('https://philj50.github.io');
  const sitemap = new URL(`${base}/sitemap-index.xml`, origin).href;
  const body = `User-agent: *
Allow: /
Disallow: ${base}/admin/
Disallow: ${base}/captains/

Sitemap: ${sitemap}
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
