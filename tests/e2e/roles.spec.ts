import { expect, test, type Page, type Route } from '@playwright/test';

/** Browser simulation of the three signed-in roles. Supabase is stubbed, so this does not touch live accounts. */

const SUPABASE = 'https://klxyjmwiaivvqjbhxzak.supabase.co';

type RoleName = 'club_captain' | 'team_captain' | 'team_player';

const PEOPLE: Record<RoleName, { id: string; email: string; name: string; place: string }> = {
  club_captain: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'club.captain@example.test',
    name: 'Chris Club',
    place: 'Club captain · Test Club',
  },
  team_captain: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'team.captain@example.test',
    name: 'Taylor Team',
    place: 'Team captain · Test Team 1',
  },
  team_player: {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'pat.player@example.test',
    name: 'Pat Player',
    place: 'Player · Test Team 1',
  },
};

type Player = { id: number; display_name: string; email: string | null; phone: string | null; squad_id: number };
type Availability = { id: number; squad_player_id: number; status: string; fixture_id: number };

function jwt(payload: Record<string, unknown>) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.simulated`;
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'beds_cookies', value: 'essential', url: baseURL! }]);
});

test.describe('Signed out', () => {
  for (const path of [
    'captains/',
    'captains/matches/',
    'captains/profile/',
    'captains/admin/',
    'captains/admin/articles/',
    'juniors/closed/entries/',
  ]) {
    test(`${path} opens the login page`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login\/\?next=/);
      await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
      await expect(page.locator('form[data-form="sign-in"]')).toHaveCount(1);
    });
  }
});

test.describe('Club captain, team captain, and player', () => {
  test('club captain edits the squad and their name, and cannot open admin tools', async ({ page }) => {
    const world = await signIn(page, 'club_captain');
    await page.goto('captains/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Signed in as Chris Club')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Test Team 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();
    await expect(page.locator('[data-player-only]')).toBeHidden();
    await expect(page.locator('[data-admin-link]')).toBeHidden();

    await page.getByRole('textbox', { name: 'Name' }).fill('New Player');
    await page.getByRole('textbox', { name: 'Email' }).fill('new.player@example.test');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('cell', { name: 'New Player' })).toBeVisible();
    expect(world.players.some((player) => player.display_name === 'New Player')).toBeTruthy();

    await page.goto('captains/profile/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Name')).toHaveValue('Chris Club');
    await expect(page.locator('[data-email]')).toHaveText('club.captain@example.test');
    await expect(page.locator('[data-places]')).toHaveText(PEOPLE.club_captain.place);
    await page.getByLabel('Name').fill('Chris C');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Name saved.')).toBeVisible();
    await expect(page.getByText('Signed in as Chris C')).toBeVisible();

    await page.goto('captains/admin/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This account cannot set up teams.')).toBeVisible();
    await page.goto('captains/admin/articles/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This account cannot change articles.')).toBeVisible();
    await page.goto('juniors/closed/entries/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This account cannot see entries.')).toBeVisible();
  });

  test('team captain sets availability order and the team sheet', async ({ page }) => {
    await signIn(page, 'team_captain');
    await page.goto('captains/matches/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Signed in as Taylor Team')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Pat Player' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Sam Spare' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Order' })).toBeVisible();
    await expect(page.getByText('Add players')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Test Team 1 v Visitors' })).toBeVisible();

    const pat = page.locator('tr', { hasText: 'Pat Player' });
    await pat.getByRole('button', { name: 'In' }).click();
    await expect(page.locator('.chip--in')).toHaveText('1 in');
    await pat.locator('select.pos').selectOption('1');
    await expect(page.locator('.team')).toContainText('Pat Player');
  });

  test('player only marks their own availability', async ({ page }) => {
    await signIn(page, 'team_player');
    await page.goto('captains/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Your team' })).toBeVisible();
    await expect(page.getByText(PEOPLE.team_player.place)).toBeVisible();
    await expect(page.getByText('Your captain looks after the squad list')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add' })).toHaveCount(0);

    await page.goto('captains/matches/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Your team' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Pat Player' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Sam Spare' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Order' })).toHaveCount(0);
    await expect(page.getByText('Add players')).toHaveCount(0);
    await expect(page.getByText('Team for this match')).toHaveCount(0);

    await page.locator('tr', { hasText: 'Pat Player' }).getByRole('button', { name: 'In' }).click();
    await expect(page.locator('.chip--in')).toHaveText('1 in');
    await expect(page.locator('[data-status]')).toHaveText('');

    await page.goto('captains/profile/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-places]')).toHaveText(PEOPLE.team_player.place);
    await expect(page.locator('[data-squad-link]')).toHaveText('Your team');
  });

  test('admin can look up a player by club, team, ES number, email and mobile', async ({ page }) => {
    const adminId = '44444444-4444-4444-8444-444444444444';
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const session = {
      access_token: jwt({ sub: adminId, email: 'admin@example.test', role: 'authenticated', exp: expiresAt }),
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
        user_metadata: { display_name: 'County Admin' },
        identities: [],
        created_at: '2026-10-02T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z',
      },
    };
    await page.addInitScript((stored) => {
      localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
    }, session);

    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const send = (payload: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      if (path.startsWith('/auth/v1/')) return send(path.endsWith('/user') ? session.user : session);
      if (path.endsWith('/functions/v1/manage-accounts')) return send({ user_id: adminId });
      if (path.endsWith('/profiles')) {
        const row = { id: adminId, display_name: 'County Admin', email: 'admin@example.test', is_admin: true };
        return send((route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json') ? row : [row]);
      }
      if (path.endsWith('/clubs')) return send([{ slug: 'test-club', name: 'Test Club', contact_name: 'Chris Club', contact_email: 'club@example.test' }]);
      if (path.endsWith('/teams')) {
        return send([{
          id: 5,
          club_slug: 'test-club',
          name: 'Test Team 1',
          division: 'Division 1',
          leaguemaster_team_id: '1',
          captain_name: 'Taylor Team',
          captain_email: 'taylor@example.test',
          last_season: 'Winter 2026/27',
        }]);
      }
      if (path.endsWith('/captain_squads')) {
        return send([{
          id: 10,
          name: 'Test Team 1',
          captain_email: 'taylor@example.test',
          captain_id: null,
          leaguemaster_team_id: '1',
          team_id: 5,
          profiles: null,
          squad_players: [{
            id: 1,
            display_name: 'Pat Player',
            email: 'pat.player@example.test',
            phone: '07000000000',
            england_squash_id: '123456',
          }],
        }]);
      }
      return send([]);
    });

    await page.goto('captains/admin/#players', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible();
    const row = page.locator('[data-directory] tr', { hasText: 'Pat Player' });
    await expect(row).toContainText('Test Club');
    await expect(row).toContainText('Test Team 1');
    await expect(row).toContainText('123456');
    await expect(row).toContainText('pat.player@example.test');
    await expect(row).toContainText('07000000000');
    await expect(page.locator('[data-directory-count]')).toContainText('1 with an ES number');
    await expect(page.locator('[data-directory-count]')).toContainText('1 with a mobile');

    await page.getByRole('searchbox', { name: 'Search' }).fill('no-such-player');
    await expect(page.getByText('No players match that search.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search' }).fill('123456');
    await expect(row).toBeVisible();
  });
});

async function signIn(page: Page, role: RoleName) {
  const person = PEOPLE[role];
  const players: Player[] = [
    { id: 1, squad_id: 10, display_name: 'Pat Player', email: PEOPLE.team_player.email, phone: null },
    { id: 2, squad_id: 10, display_name: 'Sam Spare', email: 'sam.spare@example.test', phone: null },
  ];
  const availability: Availability[] = [];
  const selections: { id: number; squad_player_id: number; position: number; fixture_id: number; squad_id: number }[] = [];
  let displayName = person.name;
  let nextId = 20;

  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const session = {
    access_token: jwt({ sub: person.id, email: person.email, role: 'authenticated', exp: expiresAt }),
    refresh_token: 'simulated-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id: person.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: person.email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { display_name: displayName },
      identities: [],
      created_at: '2026-10-02T00:00:00Z',
      updated_at: '2026-10-02T00:00:00Z',
    },
  };

  await page.addInitScript((stored) => {
    localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
  }, session);

  const membership =
    role === 'club_captain'
      ? [{ role, club_slug: 'test-club', teams: null }]
      : [{ role, club_slug: null, teams: { name: 'Test Team 1' } }];

  const fixture = {
    id: 100,
    starts_at: '2026-10-20T18:00:00.000Z',
    status: 'scheduled',
    home_points: null,
    away_points: null,
    home_games: null,
    away_games: null,
    divisions: { name: 'Division 1', scoring: 'PAR 11' },
    home: { id: 20, name: 'Test Team 1', club_slug: 'test-club', team_id: 5 },
    away: { id: 21, name: 'Visitors', club_slug: 'other-club', team_id: 6 },
  };

  await page.route(`${SUPABASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const single = (request.headers().accept ?? '').includes('application/vnd.pgrst.object+json');
    let body: Record<string, unknown> | null = null;
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        body = request.postDataJSON();
      } catch {
        body = null;
      }
    }

    const send = (payload: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

    if (path.startsWith('/auth/v1/logout')) return send({});
    if (path.startsWith('/auth/v1/token') || (path === '/auth/v1/user' && method === 'GET')) {
      session.user.user_metadata.display_name = displayName;
      return send(path.startsWith('/auth/v1/token') ? session : session.user);
    }
    if (path === '/auth/v1/user' && method === 'PUT') {
      const next = body?.data?.display_name;
      if (typeof next === 'string') displayName = next;
      session.user.user_metadata.display_name = displayName;
      return send(session.user);
    }
    if (path.endsWith('/rpc/set_my_display_name')) {
      if (typeof body?.p_name === 'string') displayName = body.p_name;
      return send(null);
    }
    if (path.endsWith('/profiles')) {
      const row = { display_name: displayName, is_admin: false };
      return send(single ? row : [row]);
    }
    if (path.endsWith('/memberships')) {
      if (url.searchParams.get('role') === 'eq.admin') return send([]);
      return send(membership);
    }
    if (path.endsWith('/clubs')) {
      return send([
        { slug: 'test-club', name: 'Test Club' },
        { slug: 'other-club', name: 'Other Club' },
      ]);
    }
    if (path.endsWith('/captain_squads')) {
      const withPlayers = url.searchParams.get('select')?.includes('squad_players');
      const squad = { id: 10, name: 'Test Team 1', team_id: 5, squad_players: players };
      return send(withPlayers ? [squad] : [{ id: squad.id, name: squad.name, team_id: squad.team_id }]);
    }
    if (path.endsWith('/squad_players')) return answerSquadPlayers(route, method, body, players, () => nextId++);
    if (path.endsWith('/availability')) return answerAvailability(route, method, url, body, availability, () => nextId++);
    if (path.endsWith('/selections')) return answerSelections(route, method, url, body, selections, () => nextId++);
    if (path.endsWith('/league_seasons')) {
      return send([
        { id: 2, name: '2026-27', starts_on: '2026-09-01' },
        { id: 1, name: '2025-26', starts_on: '2025-09-01' },
      ]);
    }
    if (path.endsWith('/league_teams')) return send([{ id: 20 }]);
    if (path.endsWith('/fixtures')) return send([fixture]);
    if (path.endsWith('/nominations') || path.endsWith('/rubbers')) return send([]);
    return send([]);
  });

  return { players };
}

function answerSquadPlayers(route: Route, method: string, body: Record<string, unknown> | null, players: Player[], id: () => number) {
  if (method === 'POST' && body) {
    const row: Player = {
      id: id(),
      squad_id: Number(body.squad_id),
      display_name: String(body.display_name),
      email: body.email ? String(body.email) : null,
      phone: body.phone ? String(body.phone) : null,
    };
    players.push(row);
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(row) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(players) });
}

function answerAvailability(
  route: Route,
  method: string,
  url: URL,
  body: Record<string, unknown> | null,
  rows: Availability[],
  id: () => number,
) {
  if (method === 'POST' && body) {
    const row: Availability = {
      id: id(),
      squad_player_id: Number(body.squad_player_id),
      status: String(body.status),
      fixture_id: Number(body.fixture_id),
    };
    rows.push(row);
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(row) });
  }
  if (method === 'PATCH' && body) {
    const target = url.searchParams.get('id') ?? '';
    const row = rows.find((item) => `eq.${item.id}` === target);
    if (row && body.status) row.status = String(body.status);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row ? [row] : []) });
  }
  if (method === 'DELETE') {
    const target = url.searchParams.get('id') ?? '';
    const index = rows.findIndex((item) => `eq.${item.id}` === target);
    if (index >= 0) rows.splice(index, 1);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
  if (single) {
    return route.fulfill({
      status: 406,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' }),
    });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
}

function answerSelections(
  route: Route,
  method: string,
  url: URL,
  body: Record<string, unknown> | null,
  rows: { id: number; squad_player_id: number; position: number; fixture_id: number; squad_id: number }[],
  id: () => number,
) {
  if (method === 'DELETE') {
    const player = url.searchParams.get('squad_player_id');
    const position = url.searchParams.get('position');
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (player && player === `eq.${row.squad_player_id}`) rows.splice(i, 1);
      else if (position && position === `eq.${row.position}`) rows.splice(i, 1);
      else if (!player && !position) rows.splice(i, 1);
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  if (method === 'POST' && body) {
    const row = {
      id: id(),
      squad_player_id: Number(body.squad_player_id),
      position: Number(body.position),
      fixture_id: Number(body.fixture_id),
      squad_id: Number(body.squad_id),
    };
    rows.push(row);
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(row) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
}
