import { expect, test, type Page } from '@playwright/test';

/**
 * Walks the built site and reports defects (failures) and recommendations (logged).
 * Smoke checks against the live host stay in smoke.spec.ts.
 */

const INDEXES = [
  './',
  'news/',
  'events/',
  'clubs/',
  'leagues/',
  'leagues/ratings/',
  'leagues/results/',
  'tournaments/',
  'juniors/',
  'juniors/closed/',
  'county-teams/',
  'gallery/',
  'share/',
  'documents/',
  'about/',
  'contact/',
  'minigame/',
  'login/',
  'captains/admin/',
];

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'beds_cookies',
      value: 'essential',
      url: baseURL!,
    },
  ]);
});

function sitePath(raw: string, baseURL: string) {
  const base = new URL(baseURL);
  const url = new URL(raw, base);
  const prefix = base.pathname.replace(/\/+$/, '');
  const onThisSite = url.origin === base.origin || /philj50\.github\.io|bedfordshiresquash\.co\.uk/i.test(url.host);
  if (!onThisSite) return null;
  if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  const path = `${url.pathname}${url.search}`;
  return path.endsWith('/') || path.includes('.') || path.includes('?') ? path : `${path}/`;
}

async function readPage(page: Page, path: string) {
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() === 'error') errors.push(message.text());
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  const report = await page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const parse = (color: string): Rgba | null => {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 1)];
    };
    const channel = (value: number) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (rgb: Rgba) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    const contrast = (foreground: Rgba, background: Rgba) => {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const over = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front[3];
      return [
        front[0] * alpha + back[0] * (1 - alpha),
        front[1] * alpha + back[1] * (1 - alpha),
        front[2] * alpha + back[2] * (1 - alpha),
        1,
      ];
    };
    const hidden = (element: Element) => {
      const box = element.getBoundingClientRect();
      if (box.width < 2 || box.height < 2 || box.bottom < 0 || box.right < 0) return true;
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return true;
        if (node instanceof HTMLElement && node.hidden) return true;
        node = node.parentElement;
      }
      return false;
    };
    const backgroundOf = (element: Element) => {
      const layers: Rgba[] = [];
      let node: Element | null = element;
      while (node) {
        const parsed = parse(getComputedStyle(node).backgroundColor);
        if (parsed && parsed[3] > 0) layers.push(parsed);
        node = node.parentElement;
      }
      let color: Rgba = [246, 243, 238, 1];
      for (let index = layers.length - 1; index >= 0; index -= 1) color = over(layers[index], color);
      return color;
    };
    const ownText = (element: Element) =>
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    const contrastIssues: string[] = [];
    const seen = new Set<string>();
    for (const element of document.querySelectorAll('body *')) {
      if (contrastIssues.length >= 16) break;
      if (element.closest('.leaflet-container, script, style, [aria-hidden="true"]')) continue;
      if (hidden(element)) continue;
      const text = ownText(element);
      if (text.length < 2) continue;
      const style = getComputedStyle(element);
      const foreground = parse(style.color);
      if (!foreground || foreground[3] === 0) continue;
      const size = Number.parseFloat(style.fontSize);
      const bold = Number.parseInt(style.fontWeight, 10) >= 600;
      const minimum = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      const ratio = contrast(foreground, backgroundOf(element));
      if (ratio >= minimum) continue;
      const sample = text.slice(0, 60);
      const key = `${sample}:${ratio.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      contrastIssues.push(`${ratio < 3 ? 'defect' : 'note'}|${sample}|${ratio.toFixed(2)}|${minimum}`);
    }

    const images = [...document.querySelectorAll('img')]
      .filter((image) => !hidden(image) && !image.closest('.leaflet-container'))
      .filter((image) => !image.hasAttribute('alt'))
      .map((image) => image.getAttribute('src') || image.outerHTML.slice(0, 80));

    const unnamed = [...document.querySelectorAll('a, button, input, select, textarea')]
      .filter((control) => !hidden(control))
      .filter((control) => {
        if (control.getAttribute('aria-hidden') === 'true') return false;
        if (control instanceof HTMLInputElement && ['hidden', 'submit'].includes(control.type)) return false;
        const name = (control.getAttribute('aria-label') || '').trim();
        const labelledBy = control.getAttribute('aria-labelledby');
        const labelled = labelledBy
          ? (document.getElementById(labelledBy)?.textContent || '').trim()
          : '';
        const text = (control.textContent || '').replace(/\s+/g, ' ').trim();
        const wrapped = control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : control.closest('label');
        return !(name || labelled || text || wrapped);
      })
      .slice(0, 8)
      .map((control) => `${control.tagName.toLowerCase()}${control.getAttribute('name') ? `[name=${control.getAttribute('name')}]` : ''}`);

    return {
      title: document.title,
      language: document.documentElement.lang,
      headings: document.querySelectorAll('h1').length,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
      images,
      unnamed,
      contrastIssues,
    };
  });
  page.off('pageerror', onError);
  page.off('console', onConsole);
  return { status: response?.status() ?? 0, errors, ...report };
}

test('public pages answer, have one heading, and stay readable', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const defects: string[] = [];
  const recommendations: string[] = [];
  for (const path of INDEXES) {
    const report = await readPage(page, path);
    const label = path === './' ? '/' : `/${path}`;
    if (report.status >= 400) defects.push(`${label} responded ${report.status}`);
    if (!report.title.includes('Bedfordshire Squash')) defects.push(`${label} title is "${report.title}"`);
    if (report.language !== 'en-GB') defects.push(`${label} language is "${report.language}"`);
    if (report.headings !== 1) defects.push(`${label} has ${report.headings} h1 headings`);
    if (report.description.length < 40) recommendations.push(`${label} description is short (${report.description.length} characters)`);
    for (const image of report.images) defects.push(`${label} image has no alt: ${image}`);
    for (const control of report.unnamed) defects.push(`${label} control has no accessible name: ${control}`);
    for (const issue of report.contrastIssues) {
      const [severity, sample, ratio, minimum] = issue.split('|');
      const line = `${label} "${sample}" contrast ${ratio} (needs ${minimum})`;
      if (severity === 'defect') defects.push(line);
      else recommendations.push(line);
    }
    for (const error of report.errors) {
      if (/favicon|Download the React DevTools|content-security-policy/i.test(error)) continue;
      defects.push(`${label} console: ${error.slice(0, 180)}`);
    }
  }
  if (recommendations.length) console.log(`Recommendations:\n${recommendations.map((item) => `- ${item}`).join('\n')}`);
  expect(defects, defects.map((item) => `- ${item}`).join('\n')).toEqual([]);
});

test('links from the main pages stay on the site', async ({ page, request, baseURL }) => {
  test.setTimeout(180_000);
  const paths = new Set<string>();
  for (const path of INDEXES) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const next = sitePath(href, baseURL!);
      if (next) paths.add(next.split('#')[0]);
    }
  }
  const failures: string[] = [];
  const checked = [...paths].filter((path) => !path.includes('/admin') || path.endsWith('/captains/admin/'));
  for (const path of checked) {
    const response = await request.get(path, { maxRedirects: 5 });
    if (!response.ok() && response.status() !== 304) failures.push(`${response.status()} ${path}`);
  }
  expect(failures, failures.join('\n')).toEqual([]);
  expect(checked.length).toBeGreaterThan(20);
});

test('sitemap urls are part of this build', async ({ request, baseURL }) => {
  const index = await request.get('sitemap-index.xml');
  expect(index.ok()).toBeTruthy();
  const maps = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(maps.length).toBeGreaterThan(0);
  const locations: string[] = [];
  for (const map of maps) {
    const path = sitePath(map, baseURL!);
    expect(path, map).toBeTruthy();
    const body = await (await request.get(path!)).text();
    locations.push(...[...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
  }
  const failures: string[] = [];
  for (const location of locations) {
    const path = sitePath(location, baseURL!);
    if (!path) {
      failures.push(`off-site sitemap entry ${location}`);
      continue;
    }
    const response = await request.get(path);
    if (!response.ok()) failures.push(`${response.status()} ${path}`);
  }
  expect(locations.length).toBeGreaterThan(10);
  expect(failures, failures.join('\n')).toEqual([]);
});

test('a missing page explains itself', async ({ page }) => {
  const response = await page.goto('not-a-real-page/', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('login field is not restricted to email addresses', async ({ page }) => {
  await page.goto('login/', { waitUntil: 'domcontentloaded' });
  const login = page.getByRole('textbox', { name: 'Email or login' });
  await expect(login).toHaveAttribute('type', 'text');
  await login.fill('not-an-email');
  await expect(login).toHaveValue('not-an-email');
  const blocked = await login.evaluate((input) => !(input as HTMLInputElement).checkValidity() && (input as HTMLInputElement).validity.typeMismatch);
  expect(blocked).toBe(false);
});

test('mobile navigation can be opened', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'News', exact: true })).toBeVisible();
  const color = await nav.getByRole('link', { name: 'News', exact: true }).evaluate((link) => getComputedStyle(link).color);
  expect(color).toMatch(/255,\s*255,\s*255|rgb\(255,\s*255,\s*255\)/);
});
