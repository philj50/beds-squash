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
    const film = page.getByLabel('Bedfordshire Squash launch film');
    await expect(film).toBeVisible();
    await expect(film).toHaveAttribute('src', /beds-squash-launch-v3\.mp4$/);
    const filmSrc = await film.getAttribute('src');
    expect(filmSrc).toBeTruthy();
    expect((await page.request.get(filmSrc!)).ok()).toBeTruthy();
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'News', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Clubs', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Juniors', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Leagues', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Tournaments', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Events', exact: true })).toHaveCount(0);
    await nav.getByRole('button', { name: 'More' }).click();
    await expect(nav.getByRole('link', { name: 'Events', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Contact', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Minigame mk3' })).toBeVisible();
    const labels = (await nav.getByRole('link').allTextContents()).map((label) => label.trim());
    expect(labels.indexOf('Minigame mk3')).toBe(labels.indexOf('Contact') + 1);
    expect(labels[labels.indexOf('News') + 1]).toBe('Clubs');
    await expect(nav.locator('[data-your-squash]')).toBeHidden();
    await expect(nav.getByRole('link', { name: 'My Squash', exact: true })).toHaveCount(0);
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
    await expect(page).toHaveURL(/\/login\/\?next=/);

    await page.evaluate((stored) => {
      localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
    }, session);
    await page.goto('share/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Share' })).toBeVisible();
    await expect(page.locator('[data-sender]')).toHaveText('Pat Player');
    await expect(page.getByText('2 photos · 1 video · 1 article')).toBeVisible();
    await expect(page.locator('[data-form]')).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Video' }).check();
    await expect(page.getByText('up to 10 MB')).toBeVisible();
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
    await page.locator('input[name="url"]').fill('www.example.com/match');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status')).toHaveText('Use an https link.');
    expect(submitted).toBeNull();

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

  test('an admin can correct an upload, including the sender', async ({ page }) => {
    const adminId = '44444444-4444-4444-8444-444444444444';
    const articleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const linkId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const videoId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const session = {
      access_token: `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: adminId, email: 'admin@example.test', role: 'authenticated', exp: expiresAt })}.simulated`,
      refresh_token: 'simulated-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: {
        id: adminId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'admin@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { display_name: 'Ada Admin' },
        identities: [],
        created_at: '2026-10-02T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z',
      },
    };
    const items = [
      {
        id: articleId,
        kind: 'article',
        credit: 'Pat Player',
        title: 'Clse match',
        caption: 'A short note',
        body: 'This sentance has a typo and is long enough to be an article for the site queue.',
        storage_path: null,
        url: null,
        status: 'pending',
        created_at: '2026-10-11T12:00:00Z',
      },
      {
        id: linkId,
        kind: 'link',
        credit: 'Pat Player',
        title: 'Bad subject',
        caption: 'Watch this',
        body: null,
        storage_path: null,
        url: 'https://example.com/old',
        status: 'pending',
        created_at: '2026-10-11T11:30:00Z',
      },
      {
        id: videoId,
        kind: 'video',
        credit: 'Pat Player',
        title: null,
        caption: 'Shaky rally',
        body: null,
        storage_path: 'incoming/11111111-1111-4111-8111-111111111111.mp4',
        url: null,
        status: 'pending',
        created_at: '2026-10-11T11:00:00Z',
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        kind: 'photo',
        credit: 'Pat Player',
        title: null,
        caption: 'Court photo',
        body: null,
        storage_path: 'incoming/22222222-2222-4222-8222-222222222222.jpg',
        url: null,
        status: 'pending',
        created_at: '2026-10-11T10:00:00Z',
      },
    ];
    let edited: Record<string, unknown> | null = null;
    let published: Record<string, unknown> | null = null;
    const fields = ['p_body', 'p_caption', 'p_credit', 'p_id', 'p_storage_path', 'p_title', 'p_url'];
    await page.addInitScript((stored) => {
      localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
    }, session);
    await page.route('**/storage/v1/**', async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.includes('/object/sign/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { error: null, path: 'incoming/11111111-1111-4111-8111-111111111111.mp4', signedURL: '/object/sign/contributions/incoming/rally.mp4?token=t' },
            { error: null, path: 'incoming/22222222-2222-4222-8222-222222222222.jpg', signedURL: '/object/sign/contributions/incoming/court.jpg?token=t' },
          ]),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'contributions/incoming/replaced.mp4' }) });
    });
    await page.route('**/rest/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const send = (payload: unknown, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
      if (url.pathname.endsWith('/profiles')) {
        const row = { id: adminId, display_name: 'Ada Admin', email: 'admin@example.test', is_admin: true };
        const single = (request.headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(single ? row : [row]);
        return;
      }
      if (url.pathname.endsWith('/contributions') && request.method() === 'GET') {
        await send(items);
        return;
      }
      if (url.pathname.endsWith('/rpc/edit_contribution') && request.method() === 'POST') {
        edited = request.postDataJSON();
        const row = items.find((item) => item.id === edited?.p_id);
        if (row && edited) {
          if (edited.p_credit != null) row.credit = String(edited.p_credit);
          if (edited.p_title != null) row.title = String(edited.p_title);
          if (edited.p_caption != null) row.caption = String(edited.p_caption);
          if (edited.p_body != null) row.body = String(edited.p_body);
          if (edited.p_url != null) row.url = String(edited.p_url);
          if (edited.p_storage_path != null) row.storage_path = String(edited.p_storage_path);
        }
        await send(null);
        return;
      }
      if (url.pathname.endsWith('/rpc/publish_contribution') && request.method() === 'POST') {
        published = request.postDataJSON();
        const row = items.find((item) => item.id === published?.p_id);
        if (row) row.status = 'published';
        await send(null);
        return;
      }
      await send([]);
    });

    await open(page, 'captains/admin/share/');
    await expect(page.getByRole('heading', { level: 1, name: 'Shared content' })).toBeVisible();
    const article = page.locator('[data-item]', { hasText: 'Clse match' });
    await expect(article).toContainText('Pat Player');
    await article.getByRole('button', { name: 'Edit' }).click();
    const articleEditor = article.locator('[data-editor]');
    await expect(articleEditor.getByLabel('Sender')).toHaveValue('Pat Player');
    await expect(articleEditor.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expect(articleEditor.getByRole('button', { name: 'Publish' })).toBeVisible();
    await articleEditor.getByLabel('Subject').fill('Close match');
    await articleEditor.getByLabel('Content').fill('This sentence is long enough to be an article for the site queue.');
    await articleEditor.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    expect(Object.keys(edited ?? {}).sort()).toEqual(fields);
    expect(edited).toMatchObject({
      p_id: articleId,
      p_credit: 'Pat Player',
      p_title: 'Close match',
      p_caption: 'A short note',
      p_body: 'This sentence is long enough to be an article for the site queue.',
      p_url: null,
      p_storage_path: null,
    });

    const link = page.locator('[data-item]', { hasText: 'Bad subject' });
    await link.getByRole('button', { name: 'Edit' }).click();
    const linkEditor = link.locator('[data-editor]');
    await linkEditor.getByLabel('Subject').fill('Club night');
    await linkEditor.getByLabel('Link').fill('https://example.com/match');
    await linkEditor.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    expect(edited).toMatchObject({
      p_id: linkId,
      p_credit: 'Pat Player',
      p_title: 'Club night',
      p_caption: 'Watch this',
      p_url: 'https://example.com/match',
      p_body: null,
      p_storage_path: null,
    });
    await expect(page.locator('[data-item]', { hasText: 'Club night' })).toContainText('Pat Player');

    const photo = page.locator('[data-item]', { hasText: 'Court photo' });
    await photo.getByRole('button', { name: 'Edit' }).click();
    const photoEditor = photo.locator('[data-editor]');
    await photoEditor.getByLabel('Sender').fill('Charlie Jenkins');
    await photoEditor.getByLabel('Subject').fill('Match photo');
    await photoEditor.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    expect(edited).toMatchObject({
      p_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      p_credit: 'Charlie Jenkins',
      p_caption: 'Match photo',
      p_storage_path: null,
      p_title: null,
      p_url: null,
    });
    await expect(page.locator('[data-item]', { hasText: 'Match photo' })).toContainText('Charlie Jenkins');

    const video = page.locator('[data-item]', { hasText: 'Shaky rally' });
    await video.getByRole('button', { name: 'Edit' }).click();
    const videoEditor = video.locator('[data-editor]');
    await videoEditor.getByLabel('Subject').fill('Clean rally');
    await videoEditor.locator('input[name="file"]').setInputFiles({
      name: 'rally.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('fake-video'),
    });
    await videoEditor.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved.');
    expect(edited).toMatchObject({
      p_id: videoId,
      p_credit: 'Pat Player',
      p_caption: 'Clean rally',
      p_title: null,
      p_url: null,
      p_body: null,
    });
    const videoEdit = edited as Record<string, unknown> | null;
    expect(String(videoEdit?.p_storage_path)).toMatch(/^incoming\/[0-9a-f-]{36}\.mp4$/);
    await expect(page.locator('[data-item]', { hasText: 'Clean rally' })).toContainText('Pat Player');

    const saved = page.locator('[data-item]', { hasText: 'Close match' });
    await saved.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('status')).toHaveText('Published.');
    expect(published).toEqual({ p_id: articleId });
    await expect(page.locator('[data-live]')).toContainText('Pat Player');
    await expect(page.locator('[data-live]')).toContainText('Close match');
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

  test('minigame asks for initials and serves from the court', async ({ page }) => {
    await open(page, 'minigame/');
    await expect(page.getByRole('heading', { level: 1, name: 'Minigame mk3' })).toBeVisible();
    await expect(page.getByLabel('Your initials')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'High scores' })).toBeVisible();
    const court = page.locator('canvas');
    await expect(court).toBeVisible();
    await expect(page.getByRole('button', { name: 'Serve' })).toBeHidden();
    await page.getByLabel('Your initials').fill('1dick');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Serve' })).toBeHidden();
    await expect(page.getByLabel('Your initials')).toHaveValue('');
    await page.getByLabel('Your initials').fill('ASS');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Your initials')).toHaveValue('');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByLabel('Your initials').fill('pj');
    await page.getByRole('button', { name: 'Play' }).click();
    const serve = page.getByRole('button', { name: 'Serve' });
    await expect(serve).toBeVisible();
    const courtBox = await court.boundingBox();
    const serveBox = await serve.boundingBox();
    expect(courtBox).toBeTruthy();
    expect(serveBox).toBeTruthy();
    expect(serveBox!.x).toBeGreaterThan(courtBox!.x);
    expect(serveBox!.y).toBeGreaterThan(courtBox!.y);
    expect(serveBox!.x + serveBox!.width).toBeLessThan(courtBox!.x + courtBox!.width);
    expect(serveBox!.y + serveBox!.height).toBeLessThan(courtBox!.y + courtBox!.height);
    const racketTop = await court.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + 4,
          pointerType: 'mouse',
        }),
      );
      const bitmap = canvas.getContext('2d');
      if (!bitmap) return -1;
      const { data, width, height } = bitmap.getImageData(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          if (b > 230 && r > 160 && r < 220 && g > 100 && g < 170 && b > r && b > g) return y;
        }
      }
      return height;
    });
    expect(racketTop).toBeGreaterThanOrEqual(360);
    expect(racketTop).toBeLessThanOrEqual(420);
  });

  test('junior closed signup form', async ({ page }) => {
    await open(page, 'juniors/closed/');
    await expect(page.getByRole('heading', { level: 1, name: 'Junior County Closed' })).toBeVisible();
    await expect(page.locator('form[data-form]')).toBeVisible();
    await expect(page.locator('input[name="player_first_name"]')).toBeVisible();
  });

  test('login accepts a name as well as an email', async ({ page }) => {
    await open(page, 'login/');
    await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
    const login = page.getByRole('textbox', { name: 'Email or login' });
    await expect(login).toHaveAttribute('type', 'text');
    await login.fill('BSCA');
    await expect(login).toHaveValue('BSCA');
    await expect(login).toBeFocused();
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
