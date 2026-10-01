// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import rehypeBaseLinks from './src/lib/rehype-base-links.mjs';

/**
 * Deployment target.
 *
 * GitHub Pages project site (default):  https://philj50.github.io/beds-squash/
 * Custom domain (later):                SITE_URL=https://bedfordshiresquash.co.uk SITE_BASE=/
 *
 * Both values can be overridden with environment variables in CI.
 */
const SITE = process.env.SITE_URL || 'https://philj50.github.io';
const BASE = process.env.SITE_BASE || '/beds-squash';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  // Keep HTML-aware whitespace handling (Astro 7 defaults to JSX-style stripping)
  compressHTML: true,
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/captains') && !page.includes('/login') && !page.includes('/juniors/closed/entries'),
    }),
  ],
  markdown: {
    // Unified pipeline so we can rewrite root-relative links in editor-written Markdown
    processor: unified({
      rehypePlugins: [[rehypeBaseLinks, { base: BASE }]],
    }),
  },
});
