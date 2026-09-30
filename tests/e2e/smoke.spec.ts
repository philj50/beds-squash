import { test, expect } from '@playwright/test';

/** Quick checks against the deployed GitHub Pages site (see npm run test:smoke). */

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'beds_cookies',
      value: 'essential',
      url: baseURL!,
    },
  ]);
});

test('home page responds', async ({ page }) => {
  // Leading "/" ignores baseURL path (GitHub Pages project site).
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Bedfordshire Squash/);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
});

test('feeds and robots', async ({ request }) => {
  expect((await request.get('robots.txt')).ok()).toBeTruthy();
  expect((await request.get('sitemap-index.xml')).ok()).toBeTruthy();
  const rss = await request.get('rss.xml');
  expect(rss.ok()).toBeTruthy();
  expect(await rss.text()).toMatch(/<rss|<feed/i);
});

test('published league match article', async ({ page }) => {
  await page.goto('news/2026-08-11-league-match/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('David Gibson');
});
