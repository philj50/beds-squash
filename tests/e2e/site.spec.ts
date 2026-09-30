import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'beds_cookies',
      value: 'essential',
      url: baseURL!,
    },
  ]);
});

async function open(page: import('@playwright/test').Page, path = '') {
  const relative = path.replace(/^\//, '') || './';
  await page.goto(relative, { waitUntil: 'domcontentloaded' });
}

test.describe('Public site', () => {
  test('home page and main navigation', async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle(/Bedfordshire Squash/);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'News', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Leagues', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Juniors', exact: true })).toBeVisible();
  });

  test('news index and a league match article', async ({ page }) => {
    await open(page, 'news/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/news/i);
    await expect(page.getByRole('link', { name: /David Gibson beat Luke Horner/i })).toBeVisible();
    await open(page, 'news/2026-08-11-league-match/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('David Gibson');
    await expect(page.getByRole('link', { name: 'league tables', exact: true })).toHaveAttribute(
      'href',
      /leagues\/results\/#7\/10\/t73\/m288/,
    );
  });

  test('league results shell loads', async ({ page }) => {
    await open(page, 'leagues/results/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Tables and fixtures/i);
    await expect(page.locator('#results-app')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'League Master ↗' })).toHaveAttribute(
      'href',
      /^https:\/\/bedfordshiresquash\.leaguemaster/,
    );
  });

  test('junior closed signup form', async ({ page }) => {
    await open(page, 'juniors/closed/');
    await expect(page.getByRole('heading', { level: 1, name: 'Junior County Closed' })).toBeVisible();
    await expect(page.locator('form[data-form]')).toBeVisible();
    await expect(page.locator('input[name="player_first_name"]')).toBeVisible();
  });

  test('contact page shows association email pattern', async ({ page }) => {
    await open(page, 'contact/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/contact/i);
    await expect(page.getByRole('main').getByRole('link', { name: 'bedssquash@gmail.com' })).toBeVisible();
  });

  test('clubs and documents indexes', async ({ page }) => {
    await open(page, 'clubs/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/clubs/i);
    await open(page, 'documents/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/documents/i);
  });
});

test.describe('SEO and feeds', () => {
  test('robots.txt blocks captain tools', async ({ request, baseURL }) => {
    const res = await request.get('robots.txt');
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toMatch(/Disallow:.*captains/i);
  });

  test('sitemap and RSS respond', async ({ request, baseURL }) => {
    const sitemap = await request.get('sitemap-index.xml');
    expect(sitemap.ok()).toBeTruthy();
    const rss = await request.get('rss.xml');
    expect(rss.ok()).toBeTruthy();
    expect(await rss.text()).toMatch(/<rss|<feed/i);
  });

  test('events calendar download', async ({ request, baseURL }) => {
    const res = await request.get('events.ics');
    expect(res.ok()).toBeTruthy();
    expect(await res.text()).toMatch(/BEGIN:VCALENDAR/);
  });
});

test.describe('Private areas', () => {
  test('captain admin is noindex', async ({ page }) => {
    await open(page, 'captains/admin/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
  });

  test('junior entries admin is noindex', async ({ page }) => {
    await open(page, 'juniors/closed/entries/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
  });
});
