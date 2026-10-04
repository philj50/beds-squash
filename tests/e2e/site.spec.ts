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

  test('SquashLevels ratings shell loads', async ({ page }) => {
    await open(page, 'leagues/ratings/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/SquashLevels/i);
    await expect(page.locator('#ratings-app')).toBeVisible();
  });

  test('SquashLevels search narrows the player list', async ({ page }) => {
    await page.route('**/rest/v1/squashlevels_players*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-range': '0-1/2' },
        body: JSON.stringify([
          { id: 1, display_name: 'Pat Player', current_level: 4321, updated_at: '2026-09-01T00:00:00Z' },
          { id: 2, display_name: 'Zoe Player', current_level: 2100, updated_at: '2026-09-02T00:00:00Z' },
        ]),
      });
    });
    await open(page, 'leagues/ratings/');
    const search = page.getByRole('searchbox', { name: 'Search players' });
    await expect(page.getByRole('status')).toContainText('Type a name to find a player.');
    await expect(page.getByRole('button', { name: 'Pat Player' })).toHaveCount(0);
    await search.fill('zoe');
    await expect(page.getByRole('button', { name: 'Zoe Player' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pat Player' })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('1 player');
  });

  test('SquashLevels player opens as a timeline', async ({ page }) => {
    await page.route('**/rest/v1/squashlevels_players*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, display_name: 'Pat Player', current_level: 1800, updated_at: '2026-09-01T00:00:00Z' },
        ]),
      });
    });
    await page.route('**/rest/v1/squashlevels_ratings*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { recorded_on: '2026-01-01', level: 1500, kind: 'before' },
          { recorded_on: '2026-01-01', level: 1520, kind: 'after' },
          { recorded_on: '2026-06-01', level: 1700, kind: 'before' },
          { recorded_on: '2026-06-01', level: 1680, kind: 'after' },
          { recorded_on: '2026-09-01', level: 1750, kind: 'before' },
          { recorded_on: '2026-09-01', level: 1800, kind: 'after' },
        ]),
      });
    });
    await open(page, 'leagues/ratings/');
    await page.getByRole('searchbox', { name: 'Search players' }).fill('pat');
    await page.getByRole('button', { name: 'Pat Player' }).click();
    await expect(page.getByRole('img', { name: 'Level after each match' })).toBeVisible();
    await expect(page.locator('[data-history] tr')).toHaveCount(3);
    await expect(page.locator('[data-history]')).toContainText('1,800');
    await expect(page.locator('[data-history]')).not.toContainText('1,500');
  });

  test('a league player name opens all of their matches', async ({ page }) => {
    await page.route('**/rest/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const send = (body: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.endsWith('/league_seasons')) {
        return send([{ id: 7, name: 'Winter 2025/26', starts_on: '2025-10-01', ends_on: '2026-03-31' }]);
      }
      if (url.pathname.endsWith('/divisions')) {
        return send([{ id: 10, name: 'Division 1', scoring: 'PAR to 11' }]);
      }
      if (url.pathname.endsWith('/league_teams')) {
        return send([
          { id: 73, name: 'Club Towers 1', division_id: 10 },
          { id: 74, name: 'Shenley Leisure 1', division_id: 10 },
        ]);
      }
      if (url.pathname.endsWith('/fixtures')) {
        return send([
          {
            id: 288,
            division_id: 10,
            home_team_id: 73,
            away_team_id: 74,
            starts_at: '2025-11-17T19:15:00+00:00',
            status: 'played',
            home_points: 4,
            away_points: 17,
            home_games: 4,
            away_games: 15,
            home: { name: 'Club Towers 1' },
            away: { name: 'Shenley Leisure 1' },
          },
        ]);
      }
      if (url.pathname.endsWith('/rubbers')) {
        if (url.searchParams.has('or')) {
          return send([
            {
              home_player: 'Pat Player',
              away_player: 'Zoe Player',
              score: '11/5 11/7 11/9',
              winner: 'home',
              fixtures: {
                starts_at: '2025-11-17T19:15:00+00:00',
                home: { name: 'Club Towers 1' },
                away: { name: 'Shenley Leisure 1' },
                divisions: { name: 'Division 1', league_seasons: { name: 'Winter 2025/26' } },
              },
            },
          ]);
        }
        return send([
          { position: 1, home_player: 'Pat Player', away_player: 'Zoe Player', score: '11/5 11/7 11/9', winner: 'home' },
        ]);
      }
      return send([]);
    });

    await open(page, 'leagues/results/');
    await page.locator('[data-fixture-btn="288"]').click();
    await page.getByRole('button', { name: 'Pat Player' }).click();
    await expect(page.getByRole('heading', { name: 'Pat Player' })).toBeVisible();
    await expect(page.locator('#player-matches')).toContainText('won 1, lost 0');
    await expect(page.locator('#player-matches')).toContainText(/3\u20130/);
    await expect(page.getByRole('button', { name: 'Zoe Player' })).toBeVisible();
    await expect(page.locator('#player-matches')).toContainText('Club Towers 1');
    await page.getByRole('button', { name: 'Back to tables' }).click();
    await expect(page.getByRole('heading', { name: 'Division 1' })).toBeVisible();
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

  test('share page holds a link for an admin and refuses a video over 10 MB', async ({ page }) => {
    let submitted: Record<string, unknown> | null = null;
    const playerId = '33333333-3333-4333-8333-333333333333';
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const session = {
      access_token: `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: playerId, email: 'pat.player@example.test', role: 'authenticated', exp: expiresAt })}.simulated`,
      refresh_token: 'simulated-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: {
        id: playerId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'pat.player@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { display_name: 'Pat Player' },
        identities: [],
        created_at: '2026-10-02T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z',
      },
    };
    await page.route('**/rest/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const send = (payload: unknown, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
      if (url.pathname.endsWith('/rpc/contribution_leaderboard')) {
        await send([{ credit: 'Pat Player', photos: 2, videos: 1, links: 0, articles: 1, total: 4 }]);
        return;
      }
      if (url.pathname.endsWith('/rpc/submit_contribution') && request.method() === 'POST') {
        submitted = request.postDataJSON();
        await send('11111111-1111-4111-8111-111111111111');
        return;
      }
      if (url.pathname.endsWith('/profiles')) {
        const row = { id: playerId, display_name: 'Pat Player', email: 'pat.player@example.test', is_admin: false };
        const single = (request.headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(single ? row : [row]);
        return;
      }
      if (url.pathname.endsWith('/memberships')) {
        await send([{ role: 'team_player', club_slug: null, teams: { name: 'Test Team 1' } }]);
        return;
      }
      if (url.pathname.endsWith('/clubs')) {
        await send([]);
        return;
      }
      await send([]);
    });
    await open(page, 'share/');
    await expect(page.getByRole('heading', { level: 1, name: 'Share' })).toBeVisible();
    await expect(page.getByText('Pat Player')).toBeVisible();
    await expect(page.getByText('2 photos · 1 video · 1 article')).toBeVisible();
    await expect(page.locator('[data-form]')).toBeHidden();
    await expect(page.getByText('Sign in as a player, team captain, club captain or admin')).toBeVisible();

    await page.evaluate((stored) => {
      localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
    }, session);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-form]')).toBeVisible();
    await page.getByRole('radio', { name: 'Video' }).check();
    await expect(page.getByText('up to 10 MB')).toBeVisible();
    await page.getByLabel('Your name').fill('Pat Player');
    await page.getByLabel('Caption').fill('A short rally');
    await page.locator('input[name="video"]').setInputFiles({
      name: 'too-big.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status')).toHaveText('Videos can be up to 10 MB.');
    expect(submitted).toBeNull();

    await page.getByRole('radio', { name: 'Link' }).check();
    await page.getByLabel('Title').fill('Club night');
    await page.locator('input[name="url"]').fill('https://vimeo.com/1153984252/ad198677f7');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('An admin will look at it before it goes on the site.')).toBeVisible();
    expect(submitted).toMatchObject({
      p_kind: 'link',
      p_credit: 'Pat Player',
      p_title: 'Club night',
      p_url: 'https://vimeo.com/1153984252/ad198677f7',
    });
    expect(submitted).not.toHaveProperty('status');
  });

  test('a signed-in account with no role cannot send content', async ({ page }) => {
    const userId = '55555555-5555-4555-8555-555555555555';
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const session = {
      access_token: `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: userId, email: 'visitor@example.test', role: 'authenticated', exp: expiresAt })}.simulated`,
      refresh_token: 'simulated-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'visitor@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        identities: [],
        created_at: '2026-10-02T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z',
      },
    };
    await page.addInitScript((stored) => {
      localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
    }, session);
    await page.route('**/rest/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const send = (payload: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      if (url.pathname.endsWith('/profiles')) {
        const row = { id: userId, display_name: 'Visitor', email: 'visitor@example.test', is_admin: false };
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(single ? row : [row]);
        return;
      }
      if (url.pathname.endsWith('/rpc/contribution_leaderboard')) {
        await send([]);
        return;
      }
      await send([]);
    });
    await open(page, 'share/');
    await expect(page.getByText('This account cannot send content.')).toBeVisible();
    await expect(page.locator('[data-form]')).toBeHidden();
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
  test('robots.txt blocks captain tools', async ({ request }) => {
    const res = await request.get('robots.txt');
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toMatch(/Disallow:.*captains/i);
  });

  test('sitemap and RSS respond', async ({ request }) => {
    const sitemap = await request.get('sitemap-index.xml');
    expect(sitemap.ok()).toBeTruthy();
    const rss = await request.get('rss.xml');
    expect(rss.ok()).toBeTruthy();
    expect(await rss.text()).toMatch(/<rss|<feed/i);
  });

  test('events calendar download', async ({ request }) => {
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
