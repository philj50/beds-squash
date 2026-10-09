import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'beds_cookies', value: 'essential', url: baseURL! }]);
});

async function open(page: import('@playwright/test').Page, path = '') {
  await page.goto(path.replace(/^\//, '') || './', { waitUntil: 'domcontentloaded' });
}

const clubs = [
  'Bedford Bulls',
  'Biggleswade Squash Club',
  'Club Towers',
  'David Lloyd Squash',
  'Flitwick Squash Club',
  'John Bunyan Sports & Fitness',
  'Leighton Leisure Centre',
  'Luton & Dunstable Squash Club',
  'Open University Squash Club',
  'Saxon Pool & Leisure Centre',
  'Shenley Leisure Squash',
];

test.describe('Public pages', () => {
  test('home shows the news, the next event, and the main links', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Squash in Bedfordshire');
    await expect(page.getByRole('link', { name: 'Welcome to the new Bedfordshire Squash website' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Winter League 2026/27 begins' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Find a club near you' })).toBeVisible();
    await expect(page.getByRole('link', { name: "What's on" })).toBeVisible();
  });

  test('about, county teams, and tournaments have their headings and a way onward', async ({ page }) => {
    await open(page, 'about/');
    await expect(page.getByRole('heading', { level: 1, name: 'About Beds SRA' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'get in touch' })).toBeVisible();

    await open(page, 'county-teams/');
    await expect(page.getByRole('heading', { level: 1, name: 'County Teams' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Steve Davies' })).toBeVisible();

    await open(page, 'tournaments/');
    await expect(page.getByRole('heading', { level: 1, name: 'Tournaments' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'All events →' })).toBeVisible();
  });

  test('the clubs index lists every club and a card opens that club', async ({ page }) => {
    await open(page, 'clubs/');
    await expect(page.getByRole('heading', { level: 1, name: 'Clubs & courts' })).toBeVisible();
    for (const name of clubs) {
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
    }
    await page.getByRole('link', { name: 'Club Towers', exact: true }).first().click();
    await expect(page).toHaveURL(/\/clubs\/club-towers\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Club Towers' })).toBeVisible();
    await expect(page.locator('address')).toContainText('Clapham Road');
    await expect(page.locator('address')).toContainText('MK41 6EL');
    await expect(page.getByRole('link', { name: 'info@clubtowers.com' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'League teams' })).toBeVisible();
  });

  test('a document offers its file, and a missing file still leaves a page', async ({ page }) => {
    await open(page, 'documents/accounts-2025-2026/');
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts 2025–26' })).toBeVisible();
    const accounts = page.getByRole('link', { name: 'Download PDF' });
    const accountsHref = await accounts.getAttribute('href');
    expect(accountsHref).toBeTruthy();
    expect((await page.request.get(accountsHref!)).ok()).toBeTruthy();

    await open(page, 'documents/personal-disclosure-form/');
    await expect(page.getByRole('heading', { level: 1, name: 'Personal Disclosure Form' })).toBeVisible();
    await expect(page.getByText('This document is available as a PDF download above.')).toBeVisible();
    const missingHref = await page.getByRole('link', { name: 'Download PDF' }).getAttribute('href');
    expect(missingHref).toMatch(/personal-disclosure-form\.pdf$/);
    expect((await page.request.get(missingHref!)).ok()).toBeFalsy();
  });

  test('minutes are listed by date and the PDF opens', async ({ page }) => {
    await open(page, 'documents/');
    await expect(page.getByRole('heading', { level: 1, name: 'Documents & minutes' })).toBeVisible();
    const poster = page.locator('li', { hasText: 'Junior County Closed 2026 poster' });
    await expect(poster).toBeVisible();
    const posterPdf = poster.getByRole('link', { name: 'PDF' });
    const posterHref = await posterPdf.getAttribute('href');
    expect(posterHref).toMatch(/beds-junior-county-closed-2026\.pdf$/);
    expect((await page.request.get(posterHref!)).ok()).toBeTruthy();
    const minutes = page.locator('li', { hasText: 'AGM – 23 September 2026' });
    await expect(minutes).toBeVisible();
    await expect(minutes).toContainText('23 September 2026');
    const pdf = minutes.getByRole('link', { name: 'PDF' });
    const href = await pdf.getAttribute('href');
    expect(href).toMatch(/agm-2026-09-23\.pdf$/);
    expect((await page.request.get(href!)).ok()).toBeTruthy();
    await minutes.getByRole('link', { name: 'Read' }).click();
    await expect(page).toHaveURL(/\/documents\/minutes\/2026-09-23-agm\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('23 September 2026');
  });

  test('the events list and the calendar download name the same events', async ({ page }) => {
    await open(page, 'events/');
    await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Junior County Closed' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Winter League 2026/27 begins' })).toBeVisible();
    const calendar = await page.request.get('events.ics');
    expect(calendar.ok()).toBeTruthy();
    const body = await calendar.text();
    expect(body).toContain('SUMMARY:Junior County Closed');
    expect(body).toContain('SUMMARY:Winter League 2026/27 begins');

    await page.getByRole('link', { name: 'Junior County Closed' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Junior County Closed' })).toBeVisible();
    await expect(page.locator('.when')).toContainText('Towers Health & Racquets Club');
    await expect(page.locator('.when')).toContainText('8 Nov 2026');
  });

  test('the gallery lists the album and the album page names it', async ({ page }) => {
    await open(page, 'gallery/');
    await expect(page.getByRole('heading', { level: 1, name: 'Gallery' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'County Closed 2026' })).toBeVisible();
    await expect(page.getByText('0 photos')).toBeVisible();
    await page.getByRole('link', { name: 'County Closed 2026' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'County Closed 2026' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'tournament report' })).toBeVisible();
    await expect(page.locator('.masonry img')).toHaveCount(0);
  });

  test('news links to each story, and a story shows its date', async ({ page }) => {
    await open(page, 'news/');
    await expect(page.getByRole('heading', { level: 1, name: 'News' })).toBeVisible();
    const stories = [
      'Welcome to the new Bedfordshire Squash website',
      'Entries open for the Junior County Closed',
      'David Gibson beat Luke Horner',
    ];
    for (const title of stories) {
      await expect(page.getByRole('link', { name: new RegExp(title, 'i') }).first()).toBeVisible();
    }
    await page.getByRole('link', { name: 'Welcome to the new Bedfordshire Squash website' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome to the new Bedfordshire Squash website' })).toBeVisible();
    await expect(page.locator('article time').first()).toHaveText('26 September 2026');
    await expect(page.getByText('County', { exact: true })).toBeVisible();
  });

  test('the juniors page links to the entry form and not the missing codes of conduct', async ({ page }) => {
    await open(page, 'juniors/');
    await expect(page.getByRole('heading', { level: 1, name: 'Juniors' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Enter', exact: true })).toHaveAttribute('href', /\/juniors\/closed\/$/);
    await expect(page.getByRole('img', { name: /Bedfordshire County Closed junior squash tournament/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download the poster' })).toHaveAttribute('href', /beds-junior-county-closed-2026\.pdf$/);
    await expect(page.getByRole('heading', { name: 'Junior County Closed', level: 3 }).first().locator('xpath=..')).toContainText('Entry is free.');
    await expect(page.getByRole('link', { name: 'Code of Conduct for Juniors' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Code of Conduct for Parents' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Child Protection Policy Statement' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'bsrajunior@gmail.com' })).toBeVisible();

    await open(page, 'documents/');
    await expect(page.getByRole('heading', { name: 'Codes of Conduct' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Code of Conduct for Juniors' })).toHaveCount(0);
  });

  test('a missing page explains itself and links home', async ({ page }) => {
    await open(page, 'no-such-page/');
    await expect(page.getByRole('heading', { level: 1, name: '404 — Out of court' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to the home page' }).click();
    await expect(page).toHaveURL(/\/beds-squash\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Squash in Bedfordshire');
  });

  test('the mobile menu opens, follows a link, and the next page starts closed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const toggle = page.locator('[data-menu-toggle]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#site-nav')).toHaveClass(/is-open/);
    await page.locator('#site-nav').getByRole('link', { name: 'News', exact: true }).click();
    await expect(page).toHaveURL(/\/news\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'News' })).toBeVisible();
    await expect(page.locator('[data-menu-toggle]')).toHaveAttribute('aria-expanded', 'false');
  });
});
