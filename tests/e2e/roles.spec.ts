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

type Player = {
  id: number;
  display_name: string;
  email: string | null;
  phone: string | null;
  england_squash_id?: string | null;
  squad_id: number;
};
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
    'captains/you/',
    'captains/admin/',
    'captains/admin/articles/',
    'captains/admin/share/',
    'captains/admin/minigame/',
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
    await expect(page.getByRole('button', { name: 'Add' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(page.locator('[data-player-only]')).toBeHidden();
    await expect(page.locator('[data-admin-link]')).toBeHidden();

    const patEmail = page.getByRole('textbox', { name: 'Email for Pat Player' });
    await patEmail.fill('pat.new@example.test');
    await patEmail.blur();
    await expect(page.getByText('Email saved for Pat Player.')).toBeVisible();
    expect(world.players.find((player) => player.display_name === 'Pat Player')?.email).toBe('pat.new@example.test');

    await page.goto('captains/profile/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Name')).toHaveValue('Chris Club');
    await expect(page.locator('[data-email]')).toHaveText('club.captain@example.test');
    await expect(page.locator('[data-places]')).toHaveText(PEOPLE.club_captain.place);
    await page.getByLabel('Name').fill('Chris C');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Name saved.')).toBeVisible();
    await expect(page.getByText('Signed in as Chris C')).toBeVisible();

    await page.goto('captains/admin/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
    await expect(page.locator('.admin-tabs .tab-label').filter({ visible: true })).toHaveText(['SquashLevels', 'This website']);
    await expect(page.getByRole('button', { name: 'Club', exact: true })).toBeVisible();
    await expect(page.locator('[data-site-club]')).toContainText('Pat Player');
    await expect(page.locator('[data-site-club]')).toContainText('Test Team 2');
    await expect(page.locator('[data-site-club]')).not.toContainText('Away Player');
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'Email for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'Email for Taylor Team' })).toHaveCount(0);
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'ES number for Taylor Team' })).toBeVisible();
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'Phone for Taylor Team' })).toBeVisible();
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'Email for Chris Club' })).toHaveCount(0);
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'Phone for Chris Club' })).toBeVisible();
    const clubEs = page.locator('[data-site-club]').getByRole('textbox', { name: 'ES number for Pat Player' });
    const clubPhone = page.locator('[data-site-club]').getByRole('textbox', { name: 'Phone for Pat Player' });
    await expect(clubEs).toBeVisible();
    await expect(clubPhone).toBeVisible();
    await clubEs.fill('1234567');
    await clubEs.blur();
    await expect(page.getByText('ES number saved for Pat Player.')).toBeVisible();
    await clubPhone.fill('07000999888');
    await clubPhone.blur();
    await expect(page.getByText('Phone saved for Pat Player.')).toBeVisible();
    expect(world.players.find((player) => player.display_name === 'Pat Player')?.phone).toBe('07000999888');
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Email for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Email for Chris Club' })).toHaveCount(0);
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Email for Taylor Team' })).toHaveCount(0);
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Phone for Chris Club' })).toBeVisible();
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'ES number for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Phone for Pat Player' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a player' })).toHaveCount(0);
    await page.getByRole('button', { name: 'SL', exact: true }).click();
    await expect(page.locator('[data-site-sl]')).toContainText('Pat Player');
    await expect(page.locator('[data-site-sl]')).toContainText('4,321');
    await expect(page.locator('[data-site-sl]')).toContainText('Sam Squad');
    await expect(page.locator('[data-site-sl]')).not.toContainText('Away Player');
    await expect(page.getByRole('button', { name: 'People' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Admins' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Groups' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Roles' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Activities' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Traffic' })).toHaveCount(0);
    await expect(page.locator('[data-junior-link]')).toBeHidden();
    await expect(page.locator('[data-share-link]')).toBeHidden();
    await expect(page.locator('[data-scores-link]')).toBeHidden();
    await page.goto('captains/admin/articles/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This account cannot change articles.')).toBeVisible();
    await page.goto('captains/admin/share/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This account cannot publish shared content.')).toBeVisible();
    await page.goto('captains/admin/minigame/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This account cannot change the minigame board.')).toBeVisible();
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
    await expect(page.getByText('Add players')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Test Team 1 v Visitors' })).toBeVisible();

    const pat = page.locator('tr', { hasText: 'Pat Player' });
    await pat.getByRole('button', { name: 'In' }).click();
    await expect(page.locator('.chip--in')).toHaveText('1 in');
    await pat.locator('select.pos').selectOption('1');
    await expect(page.locator('.team')).toContainText('Pat Player');

    await page.goto('captains/admin/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Email for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Email for Taylor Team' })).toHaveCount(0);
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'ES number for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-player-list]')).not.toContainText('Test Team 2');
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    await expect(page.locator('[data-site-team]')).toContainText('Pat Player');
    await expect(page.getByRole('columnheader', { name: 'LM name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'SL name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'SL level' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible();
    await expect(page.locator('[data-site-team] tr', { hasText: 'Pat Player' }).getByRole('cell', { name: 'P', exact: true })).toBeVisible();
    await expect(page.locator('[data-site-team] tr', { hasText: 'Taylor Team' }).getByRole('cell', { name: 'T;P', exact: true })).toBeVisible();
    await expect(page.locator('[data-site-team] tr', { hasText: 'Chris Club' }).getByRole('cell', { name: 'C;P', exact: true })).toBeVisible();
    await expect(page.locator('[data-site-team] tr', { hasText: 'Pat Player' })).toContainText('4,321');
    await expect(page.locator('[data-site-team]').getByRole('combobox', { name: 'SquashLevels for Pat Player' })).toHaveCount(0);
    await expect(page.locator('[data-site-team]').getByRole('textbox', { name: 'Email for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-team]').getByRole('textbox', { name: 'Phone for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-team]').getByRole('textbox', { name: 'Email for Taylor Team' })).toHaveCount(0);
    await expect(page.locator('[data-site-team]').getByRole('textbox', { name: 'ES number for Taylor Team' })).toBeVisible();
    await expect(page.locator('[data-site-team]').getByRole('textbox', { name: 'Phone for Taylor Team' })).toBeVisible();
    await expect(page.locator('[data-site-team]')).not.toContainText('Test Team 2');
    await page.getByRole('button', { name: 'Club', exact: true }).click();
    await expect(page.locator('[data-site-club]')).toContainText('Test Club');
    await expect(page.locator('[data-site-club]')).toContainText('Pat Player');
    await expect(page.locator('[data-site-club]')).not.toContainText('Test Team 2');
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'Email for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'Email for Taylor Team' })).toHaveCount(0);
    await expect(page.locator('[data-site-club]').getByRole('textbox', { name: 'Phone for Taylor Team' })).toBeVisible();
    await page.getByRole('button', { name: 'SL', exact: true }).click();
    await expect(page.locator('[data-site-sl]')).toContainText('Pat Player');
    await expect(page.locator('[data-site-sl]')).toContainText('4,321');
    await expect(page.locator('[data-site-sl]')).not.toContainText('Sam Squad');
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

    await page.goto('captains/admin/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-own-name]')).toHaveValue('Pat Player');
    await expect(page.locator('[data-own-email]')).toHaveText('pat.player@example.test');
    await expect(page.locator('[data-own-facts]')).toContainText('Test Club');
    await expect(page.locator('[data-own-facts]')).toContainText('Test Team 1');
    await expect(page.locator('[data-own-facts]')).toContainText('Pat Player');
    await expect(page.locator('[data-tab="site-player"]')).not.toContainText('Sam Spare');
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Email for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'ES number for Sam Spare' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    await expect(page.locator('[data-site-team]')).toContainText('Pat Player');
    await expect(page.locator('[data-site-team]')).not.toContainText('Sam Spare');
    await expect(page.locator('[data-site-team]').getByRole('textbox', { name: 'Email for Pat Player' })).toBeVisible();
    await expect(page.locator('[data-site-team]').getByRole('textbox', { name: 'Phone for Pat Player' })).toBeVisible();
    await page.getByRole('button', { name: 'Club', exact: true }).click();
    await expect(page.locator('[data-site-club]')).toContainText('Test Club');
    await expect(page.locator('[data-site-club]')).not.toContainText('Test Team 2');
    await page.getByRole('button', { name: 'SL', exact: true }).click();
    await expect(page.locator('[data-site-sl]')).toContainText('4,321');
    await expect(page.locator('[data-site-sl]')).toContainText('10 Jan 2026');
    await expect(page.locator('[data-site-sl]')).toContainText('Level after each match');
    await expect(page.locator('[data-site-sl]')).not.toContainText('Sam Spare');
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

    const playerLinks: { id: number; profile_id: string | null; squashlevels_player_id: number | null; lm_player_name: string | null }[] = [];
    let nextLinkId = 1;
    const groupMembers: { profile_id: string; person_name: string; place: string | null; group_slug: string }[] = [
      { profile_id: adminId, person_name: 'County Admin', place: null, group_slug: 'admins' },
      { profile_id: '55555555-5555-4555-8555-555555555555', person_name: 'Gail', place: null, group_slug: 'admins' },
      { profile_id: '66666666-6666-4666-8666-666666666666', person_name: 'Sam Morris', place: null, group_slug: 'admins' },
      { profile_id: '66666666-6666-4666-8666-666666666666', person_name: 'Sam Morris', place: 'Test Club', group_slug: 'lm_club_captains' },
    ];
    const scores = [
      { id: 9, player_name: 'Philip Jenkins', score: 40, created_at: '2026-10-04T11:00:00.000Z' },
      ...Array.from({ length: 15 }, (_, index) => ({
        id: 10 + index,
        player_name: `P${index}`,
        score: 30 - index,
        created_at: '2026-10-04T11:00:00.000Z',
      })),
    ];
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const send = (payload: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      if (path.startsWith('/auth/v1/')) return send(path.endsWith('/user') ? session.user : session);
      if (path.endsWith('/functions/v1/squashlevels-link')) {
        const payload = route.request().postDataJSON() as { name?: string } | null;
        const name = (payload?.name ?? '').trim();
        if (name.toLowerCase() !== 'pat player') {
          return route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: `No SquashLevels player is called ${name}.` }),
          });
        }
        return send({ id: 90, display_name: 'Pat Player', current_level: 4321 });
      }
      if (path.endsWith('/functions/v1/manage-accounts')) {
        const payload = route.request().postDataJSON() as { action?: string } | null;
        if (payload?.action === 'states') {
          return send({
            accounts: [{ id: adminId, last_sign_in_at: '2026-10-04T09:30:00.000Z', active: true }],
          });
        }
        return send({ user_id: adminId });
      }
      if (path.endsWith('/profiles')) {
        const county = { id: adminId, display_name: 'County Admin', email: 'admin@example.test', is_admin: true };
        const people = [
          county,
          { id: '55555555-5555-4555-8555-555555555555', display_name: 'Gail', email: 'gail@example.test', is_admin: true },
          { id: '66666666-6666-4666-8666-666666666666', display_name: 'Sam Morris', email: 'sam.morris@example.test', is_admin: true },
        ];
        const id = url.searchParams.get('id') ?? '';
        const wanted = id.startsWith('eq.') ? id.slice(3) : '';
        const row = wanted ? people.find((person) => person.id === wanted) ?? null : county;
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        return send(single || wanted ? row : people);
      }
      if (path.endsWith('/memberships')) {
        return send([
          {
            id: 1,
            profile_id: '66666666-6666-4666-8666-666666666666',
            role: 'club_captain',
            club_slug: 'test-club',
            team_id: null,
            profiles: { display_name: 'Sam Morris', email: 'sam.morris@example.test' },
            teams: null,
          },
          {
            id: 2,
            profile_id: '66666666-6666-4666-8666-666666666666',
            role: 'team_captain',
            club_slug: null,
            team_id: 5,
            profiles: { display_name: 'Sam Morris', email: 'sam.morris@example.test' },
            teams: { name: 'Test Team 1', division: 'Division 1' },
          },
          {
            id: 3,
            profile_id: '66666666-6666-4666-8666-666666666666',
            role: 'team_player',
            club_slug: null,
            team_id: 5,
            profiles: { display_name: 'Sam Morris', email: 'sam.morris@example.test' },
            teams: { name: 'Test Team 1', division: 'Division 1' },
          },
        ]);
      }
      if (path.endsWith('/clubs')) {
        return send([
          { slug: 'test-club', name: 'Test Club', contact_name: 'Chris Club', contact_email: 'club@example.test' },
          { slug: 'other-club', name: 'Other Club', contact_name: 'Olivia Other', contact_email: 'other@example.test' },
        ]);
      }
      if (path.endsWith('/teams')) {
        return send([
          {
            id: 5,
            club_slug: 'test-club',
            name: 'Test Team 1',
            division: 'Division 1',
            leaguemaster_team_id: '1',
            captain_name: 'Taylor Team',
            captain_email: 'taylor@example.test',
            last_season: 'Winter 2026/27',
          },
          {
            id: 6,
            club_slug: 'test-club',
            name: 'Test Team 2',
            division: 'Division 2',
            leaguemaster_team_id: '2',
            captain_name: 'Sam Captain',
            captain_email: 'sam@example.test',
            last_season: 'Winter 2026/27',
          },
          {
            id: 7,
            club_slug: 'other-club',
            name: 'Other Team',
            division: 'Division 1',
            leaguemaster_team_id: '3',
            captain_name: 'Alex Captain',
            captain_email: 'alex@example.test',
            last_season: 'Winter 2026/27',
          },
        ]);
      }
      if (path.endsWith('/squashlevels_players')) {
        return send([{ id: 90, display_name: 'Pat Player', current_level: 4321, updated_at: '2026-01-10' }]);
      }
      if (path.endsWith('/squashlevels_names')) {
        return send([{ name_key: 'zoe player', player_id: 90, status: 'matched' }]);
      }
      if (path.endsWith('/captain_squads')) {
        return send([
          {
            id: 10,
            name: 'Test Team 1',
            captain_email: 'taylor@example.test',
            captain_id: null,
            leaguemaster_team_id: '1',
            team_id: 5,
            profiles: null,
            squad_players: [
              { id: 1, display_name: 'Pat Player', email: 'pat.player@example.test', phone: '07000000000', england_squash_id: '123456' },
              { id: 2, display_name: 'Zoe Player', email: 'zoe.player@example.test', phone: null, england_squash_id: null },
              { id: 5, display_name: 'Sam Morris', email: 'sam.morris@example.test', phone: null, england_squash_id: null },
            ],
          },
          {
            id: 11,
            name: 'Test Team 2',
            captain_email: 'sam@example.test',
            captain_id: null,
            leaguemaster_team_id: '2',
            team_id: 6,
            profiles: null,
            squad_players: [
              { id: 3, display_name: 'Sam Squad', email: 'sam.squad@example.test', phone: null, england_squash_id: '654321' },
            ],
          },
          {
            id: 12,
            name: 'Other Team',
            captain_email: 'alex@example.test',
            captain_id: null,
            leaguemaster_team_id: '3',
            team_id: 7,
            profiles: null,
            squad_players: [
              { id: 4, display_name: 'Alex Away', email: null, phone: null, england_squash_id: null },
            ],
          },
        ]);
      }
      if (path.endsWith('/nominations')) {
        return send([
          { team_id: 5, player_name: 'Pat Player', period: 1, position: 1, season: 'Winter 2026/27' },
          { team_id: 5, player_name: 'Zoe Player', period: 1, position: 2, season: 'Winter 2026/27' },
          { team_id: 6, player_name: 'Sam Squad', period: 1, position: 1, season: 'Winter 2026/27' },
          { team_id: 7, player_name: 'Alex Away', period: 1, position: 1, season: 'Winter 2026/27' },
        ]);
      }
      if (path.endsWith('/lm_player_contacts')) {
        return send([{ id: 1, team_id: 5, player_name: 'Pat Player', email: 'old.contact@example.test' }]);
      }
      if (path.endsWith('/minigame_scores')) {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? scores.length);
        const slice = scores.slice(offset, offset + limit);
        const last = slice.length ? offset + slice.length - 1 : offset;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'content-range': `${slice.length ? offset : 0}-${last}/${scores.length}`,
            'access-control-expose-headers': 'Content-Range',
          },
          body: JSON.stringify(slice),
        });
      }
      if (path.endsWith('/rpc/get_site_traffic_stats')) {
        return send({
          total_7d: 3,
          total_30d: 10,
          sessions_7d: 2,
          sessions_30d: 4,
          sign_ins_7d: 1,
          sign_ins_30d: 1,
          by_day: [],
          top_pages: [],
          recent_sign_ins: [
            { signed_in_at: '2026-10-04T12:00:00.000Z', display_name: 'Pat Player', email: 'pat.player@example.test' },
          ],
        });
      }
      if (path.endsWith('/rpc/delete_minigame_score')) {
        scores.length = 0;
        return send(null);
      }
      if (path.endsWith('/player_links')) {
        const method = route.request().method();
        if (method === 'POST') {
          const raw = route.request().postDataJSON() as
            | { profile_id?: string | null; squashlevels_player_id?: number | null; lm_player_name?: string | null }
            | { profile_id?: string | null; squashlevels_player_id?: number | null; lm_player_name?: string | null }[];
          const body = Array.isArray(raw) ? raw[0] : raw;
          const row = {
            id: nextLinkId++,
            profile_id: body.profile_id ?? null,
            squashlevels_player_id: body.squashlevels_player_id ?? null,
            lm_player_name: body.lm_player_name ?? null,
          };
          playerLinks.push(row);
          return send(row);
        }
        if (method === 'DELETE') {
          const target = url.searchParams.get('id') ?? '';
          const index = playerLinks.findIndex((row) => `eq.${row.id}` === target);
          if (index >= 0) playerLinks.splice(index, 1);
          return send([]);
        }
        return send(playerLinks);
      }
      if (path.endsWith('/roles')) {
        return send([
          { slug: 'admin', name: 'Admin', position: 1 },
          { slug: 'lm_club_captain', name: 'LM Club Captain', position: 2 },
          { slug: 'lm_team_captain', name: 'LM Team Captain', position: 3 },
          { slug: 'lm_player', name: 'LM Player', position: 4 },
          { slug: 'sl_player', name: 'SL Player', position: 5 },
          { slug: 'jc_player', name: 'JC Player', position: 6 },
          { slug: 'junior_organiser', name: 'Junior Organiser', position: 7 },
          { slug: 'bc_player', name: 'BC Player', position: 8 },
          { slug: 'rb_player', name: 'RB Player', position: 9 },
        ]);
      }
      if (path.endsWith('/groups')) {
        return send([
          { slug: 'admins', name: 'Admins', role_slug: 'admin', source: 'account', managed: true, position: 1 },
          { slug: 'lm_club_captains', name: 'LM Club Captains', role_slug: 'lm_club_captain', source: 'leaguemaster', managed: true, position: 2 },
          { slug: 'lm_team_captains', name: 'LM Team Captains', role_slug: 'lm_team_captain', source: 'leaguemaster', managed: true, position: 3 },
          { slug: 'lm_players', name: 'LM Players', role_slug: 'lm_player', source: 'leaguemaster', managed: true, position: 4 },
          { slug: 'sl_players', name: 'SL Players', role_slug: 'sl_player', source: 'squashlevels', managed: true, position: 5 },
          { slug: 'jc_players', name: 'JC Players', role_slug: 'jc_player', source: 'website', managed: false, position: 6 },
          { slug: 'junior_organisers', name: 'Junior Organisers', role_slug: 'junior_organiser', source: 'website', managed: false, position: 7 },
          { slug: 'bc_players', name: 'BC Players', role_slug: 'bc_player', source: 'website', managed: false, position: 8 },
          { slug: 'rb_players', name: 'RB Players', role_slug: 'rb_player', source: 'website', managed: false, position: 9 },
        ]);
      }
      if (path.endsWith('/group_members')) {
        const method = route.request().method();
        if (method === 'POST') {
          const body = route.request().postDataJSON() as { profile_id: string; group_slug: string; role: string };
          const index = groupMembers.findIndex((row) => row.profile_id === body.profile_id && row.group_slug === body.group_slug);
          if (index >= 0) groupMembers[index] = body;
          else groupMembers.push(body);
          return send(body);
        }
        if (method === 'DELETE') {
          const profile = url.searchParams.get('profile_id') ?? '';
          const slug = url.searchParams.get('group_slug') ?? '';
          const index = groupMembers.findIndex((row) => `eq.${row.profile_id}` === profile && `eq.${row.group_slug}` === slug);
          if (index >= 0) groupMembers.splice(index, 1);
          return send([]);
        }
        return send(groupMembers);
      }
      return send([]);
    });

    await page.goto('captains/admin/#lm-players', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'LM Player' })).toBeVisible();
    await expect(page.locator('.admin-tabs .tab-label')).toHaveText(['League Master', 'SquashLevels', 'This website', 'Links']);
    await expect(page.locator('[data-junior-link]')).toBeVisible();
    await expect(page.locator('[data-share-link]')).toBeVisible();
    await expect(page.locator('[data-scores-link]')).toBeVisible();
    const row = page.locator('[data-lm-players] tr', { hasText: 'Pat Player' });
    await expect(row).toContainText('Test Club');
    await expect(row).toContainText('Test Team 1');
    await expect(row).toContainText('Player');
    await expect(row).toContainText('pat.player@example.test');
    await expect(row).not.toContainText('old.contact@example.test');
    await expect(row.getByRole('textbox')).toHaveCount(0);
    await expect(page.locator('[data-lm-players] tr', { hasText: 'Zoe Player' })).not.toContainText('Test Club');
    await expect(page.locator('[data-lm-players] tr.team-start', { hasText: 'Sam Squad' })).toContainText('Test Team 2');
    await expect(page.locator('[data-lm-players] tr.club-start', { hasText: 'Alex Away' })).toContainText('Other Club');
    await expect(page.locator('[data-directory-count]')).toContainText('4 players');
    await expect(page.locator('[data-directory-count]')).toContainText('3 with an email');

    await page.getByRole('searchbox', { name: 'Search' }).fill('no-such-player');
    await expect(page.getByText('No players match that search.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search' }).fill('Pat');
    await expect(row).toBeVisible();

    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add a player' })).toBeVisible();
    await expect(page.locator('[data-site-player-list]').getByRole('textbox', { name: 'Email for Pat Player' })).toBeVisible();

    await page.getByRole('button', { name: 'LM Club' }).click();
    await expect(page.locator('[data-lm-clubs]')).toContainText('club@example.test');
    await expect(page.locator('[data-lm-clubs]')).toContainText('Chris Club');

    await page.getByRole('button', { name: 'LM Captain' }).click();
    await expect(page.locator('[data-lm-captains]')).toContainText('Taylor Team');
    await expect(page.locator('[data-lm-captains]')).toContainText('taylor@example.test');

    await page.getByRole('button', { name: 'Roles' }).click();
    await expect(page.getByRole('heading', { name: 'Roles', exact: true })).toBeVisible();
    const roleList = page.locator('[data-roles]');
    for (const roleName of ['Admin', 'LM Club Captain', 'LM Team Captain', 'LM Player', 'SL Player', 'JC Player', 'Junior Organiser', 'BC Player', 'RB Player']) {
      await expect(roleList.getByRole('cell', { name: roleName, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Add an admin' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove admin' })).toHaveCount(0);
    await expect(roleList).not.toContainText('County Admin');
    await expect(roleList).not.toContainText('Sam Morris');
    await expect(roleList.getByRole('row', { name: 'Admin Admins' })).toBeVisible();
    await expect(roleList.getByRole('row', { name: 'LM Club Captain LM Club Captains' })).toBeVisible();

    await page.getByRole('button', { name: 'Users' }).click();
    await expect(page.getByRole('heading', { name: 'Add a person' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'People' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Admins' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Last login' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Groups' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Random' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Random email' })).toHaveCount(0);
    const adminRow = page.locator('[data-users] tr', { hasText: 'County Admin' });
    await expect(adminRow).toContainText('Default admin');
    await expect(adminRow).toContainText('Active');
    await expect(adminRow).toContainText('4 Oct 2026');
    await expect(adminRow).not.toContainText('admin@example.test');
    await expect(adminRow).toContainText('BSCA');
    await expect(adminRow.getByRole('button', { name: 'Set password' })).toHaveCount(0);
    await expect(adminRow.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(adminRow.getByRole('button', { name: 'Make inactive' })).toHaveCount(0);
    await expect(adminRow).not.toContainText('All clubs');
    const gail = page.locator('[data-users] tr', { hasText: 'Gail' });
    await expect(gail).toContainText('Admin');
    await expect(gail).not.toContainText('All clubs');
    await expect(gail).not.toContainText('Test Club');
    const samPeople = page.locator('[data-users] tr', { hasText: 'Sam Morris' });
    await expect(samPeople).toContainText('Test Club');
    await expect(samPeople).toContainText('Admins');
    await expect(samPeople).toContainText('LM Club Captains');
    await expect(samPeople).toContainText('LM Club Captain');
    await expect(samPeople).not.toContainText('All clubs');

    await page.getByRole('button', { name: 'Groups' }).click();
    const groupList = page.locator('[data-groups]');
    for (const groupName of ['Admins', 'LM Club Captains', 'LM Team Captains', 'LM Players', 'SL Players', 'JC Players', 'Junior Organisers', 'BC Players', 'RB Players']) {
      await expect(groupList.getByRole('cell', { name: groupName, exact: true })).toBeVisible();
    }
    const leaguePlayers = groupList.getByRole('row', { name: /LM Players/ });
    await expect(leaguePlayers).toContainText('Filled from League Master');
    await expect(leaguePlayers).toContainText('LM Player');
    await expect(groupList.getByRole('button', { name: /Add/ })).toHaveCount(0);
    const juniors = groupList.getByRole('row', { name: /JC Players/ });
    await expect(juniors).toContainText('Not filled yet');
    await expect(groupList).not.toContainText('Sam Morris');
    await expect(page.locator('[data-group-members]')).toContainText('Sam Morris');
    await expect(page.locator('[data-group-members]')).toContainText('LM Club Captains');
    await expect(page.getByRole('columnheader', { name: 'Place' })).toBeVisible();
    const clubGroup = groupList.getByRole('row', { name: /LM Club Captains/ });
    await expect(clubGroup).toContainText('Gives the LM Club Captain role.');

    await page.getByRole('button', { name: 'SL', exact: true }).click();
    const slZoe = page.locator('[data-site-sl] tr', { hasText: 'Zoe Player' });
    await expect(slZoe).toContainText('Linked');
    await expect(slZoe).toContainText('4,321');
    await expect(page.locator('[data-site-sl] tr', { hasText: 'Pat Player' })).not.toContainText('Linked');

    await page.getByRole('button', { name: 'Links' }).click();
    await expect(page.getByRole('heading', { name: 'Links', exact: true })).toBeVisible();
    const placedZoe = page.locator('[data-links] tr').filter({ hasText: 'Zoe Player' }).filter({ hasNot: page.locator('select') });
    await expect(placedZoe).toContainText('Pat Player · 4,321');
    await expect(placedZoe.getByRole('textbox', { name: 'SL' })).toHaveCount(0);
    const linkSam = page.locator('[data-links] tr', { has: page.locator('option[selected][value="Sam Morris"]') });
    await expect(linkSam.getByRole('combobox', { name: 'LM Player' })).toHaveValue('Sam Morris');
    await linkSam.getByRole('textbox', { name: 'SL' }).fill('Pat Player');
    await linkSam.getByRole('button', { name: 'Link' }).click();
    await expect(page.getByText('Link saved.')).toBeVisible();
    const linked = page.getByRole('row', { name: /Sam Morris.*4,321/ });
    await expect(linked).toBeVisible();
    await linked.getByRole('button', { name: 'Unlink' }).click();
    await expect(page.getByText('Link removed.')).toBeVisible();
    await expect(page.locator('[data-links] tr', { has: page.locator('option[selected][value="Sam Morris"]') }).getByRole('textbox', { name: 'SL' })).toBeVisible();

    await page.getByRole('button', { name: 'Team', exact: true }).click();
    const zoe = page.locator('[data-site-team] tr', { hasText: 'Zoe Player' });
    await expect(zoe.getByRole('combobox', { name: 'SquashLevels for Zoe Player' })).toBeVisible();
    await zoe.getByRole('combobox', { name: 'SquashLevels for Zoe Player' }).selectOption({ label: 'Pat Player' });
    await expect(zoe).toContainText('4,321');
    await expect(zoe.getByRole('combobox')).toHaveCount(0);
    const patTeam = page.getByRole('row', { name: /Pat Player Pat Player 4,321/ });
    await expect(patTeam).toHaveCount(1);
    await expect(patTeam.getByRole('combobox')).toHaveCount(0);
    await expect(patTeam.getByRole('cell', { name: 'P', exact: true })).toBeVisible();
    await expect(page.locator('[data-site-team] tr', { hasText: 'Sam Morris' }).getByRole('cell', { name: 'A;C;T;P', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Traffic' }).click();
    await expect(page.getByRole('heading', { name: 'Sign-ins (30 days)' })).toBeVisible();
    await expect(page.locator('[data-traffic-sign-ins]')).toContainText('Pat Player');
    await expect(page.locator('[data-kpi="signins-7"]')).toHaveText('1');

    await page.goto('juniors/', { waitUntil: 'domcontentloaded' });
    const adminMenu = page.locator('[data-junior-admin]');
    await expect(adminMenu).toBeVisible();
    await adminMenu.getByRole('button', { name: 'Junior admin' }).click();
    await expect(adminMenu.getByRole('menuitem', { name: 'County Closed entries' })).toBeVisible();

    await page.goto('captains/admin/minigame/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Minigame mk2 scores' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Disallowed initials' })).toBeVisible();
    await expect(page.locator('[data-pager]')).toContainText('1–15 of 16');
    await expect(page.getByRole('cell', { name: 'Philip Jenkins' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'P14' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('[data-pager]')).toContainText('16–16 of 16');
    await expect(page.getByRole('cell', { name: 'P14' })).toBeVisible();
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByRole('cell', { name: 'Philip Jenkins' })).toBeVisible();
    await page.locator('tr', { hasText: 'Philip Jenkins' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('dialog')).toContainText('Philip Jenkins');
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByRole('cell', { name: 'Philip Jenkins' })).toBeVisible();
    await page.locator('tr', { hasText: 'Philip Jenkins' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Remove it' }).click();
    await expect(page.getByText('Removed from the board.')).toBeVisible();
    await expect(page.getByText('No scores on the board.')).toBeVisible();
  });

  test('a player sees their next match, last result, level and uploads', async ({ page }) => {
    await signIn(page, 'team_player');
    await page.goto('captains/you/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Your squash' })).toBeVisible();
    await expect(page.getByText('Signed in as Pat Player')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Test Team 1 v Visitors' })).toBeVisible();
    await expect(page.getByText('Visitors 4–1 Test Team 1')).toBeVisible();
    await expect(page.getByText('4,321')).toBeVisible();
    await expect(page.getByText('Club night')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();
  });
});

test.describe('Junior admin stays off the public juniors pages', () => {
  for (const role of ['club_captain', 'team_captain', 'team_player'] as const) {
    test(`${role.replaceAll('_', ' ')} does not see the junior admin menu`, async ({ page }) => {
      await signIn(page, role);
      const profiles = page.waitForResponse((res) => res.url().includes('/rest/v1/profiles'));
      await page.goto('juniors/', { waitUntil: 'domcontentloaded' });
      await profiles;
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-junior-admin]')).toBeHidden();
      await expect(page.getByRole('link', { name: 'County Closed entries' })).toHaveCount(0);

      const profilesAgain = page.waitForResponse((res) => res.url().includes('/rest/v1/profiles'));
      await page.goto('juniors/closed/', { waitUntil: 'domcontentloaded' });
      await profilesAgain;
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('link', { name: 'Organisers' })).toHaveCount(0);
      await expect(page.locator('[data-junior-admin]')).toBeHidden();
    });
  }
});

async function signIn(page: Page, role: RoleName) {
  const person = PEOPLE[role];
  const players: Player[] = [
    { id: 1, squad_id: 10, display_name: 'Pat Player', email: PEOPLE.team_player.email, phone: null },
    { id: 2, squad_id: 10, display_name: 'Sam Spare', email: 'sam.spare@example.test', phone: null },
    { id: 8, squad_id: 10, display_name: 'Taylor Team', email: 'taylor@example.test', phone: '07000111111' },
    { id: 9, squad_id: 10, display_name: 'Chris Club', email: 'club.captain@example.test', phone: null },
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
      ? [{ role, club_slug: 'test-club', team_id: null, teams: null }]
      : [{ role, club_slug: 'test-club', team_id: 5, teams: { name: 'Test Team 1' } }];

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
  const earlier = {
    id: 90,
    starts_at: '2026-01-14T18:00:00.000Z',
    status: 'played',
    home_points: 4,
    away_points: 1,
    home_games: null,
    away_games: null,
    divisions: { name: 'Division 1', scoring: 'PAR 11' },
    home: { id: 21, name: 'Visitors', club_slug: 'other-club', team_id: 6 },
    away: { id: 20, name: 'Test Team 1', club_slug: 'test-club', team_id: 5 },
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
      const payload = body?.data;
      const next = payload && typeof payload === 'object' && 'display_name' in payload ? payload.display_name : undefined;
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
        { slug: 'test-club', name: 'Test Club', contact_name: 'Chris Club', contact_email: 'club.captain@example.test' },
        { slug: 'other-club', name: 'Other Club' },
      ]);
    }
    if (path.endsWith('/captain_squads')) {
      const select = url.searchParams.get('select') ?? '';
      const withPlayers = select.includes('squad_players');
      const squads = [
        { id: 10, name: 'Test Team 1', team_id: 5, squad_players: players },
        ...(select.includes('team_id') && withPlayers
          ? [
              {
                id: 11,
                name: 'Test Team 2',
                team_id: 6,
                squad_players: [{ id: 3, display_name: 'Sam Squad', email: 'sam.squad@example.test', phone: null, england_squash_id: null }],
              },
              {
                id: 12,
                name: 'Other Team',
                team_id: 8,
                squad_players: [{ id: 4, display_name: 'Away Player', email: null, phone: null, england_squash_id: null }],
              },
            ]
          : []),
      ];
      return send(withPlayers ? squads : squads.map(({ id, name, team_id }) => ({ id, name, team_id })));
    }
    if (path.endsWith('/teams')) {
      return send([
        { id: 5, club_slug: 'test-club', name: 'Test Team 1', division: 'Division 1', captain_name: 'Taylor Team', captain_email: 'taylor@example.test' },
        { id: 6, club_slug: 'test-club', name: 'Test Team 2', division: 'Division 2', captain_name: 'Sam Captain', captain_email: 'sam@example.test' },
        { id: 8, club_slug: 'other-club', name: 'Other Team', division: 'Division 1', captain_name: 'Alex Captain', captain_email: 'alex@example.test' },
      ]);
    }
    if (path.endsWith('/squashlevels_players')) {
      const rows = [
        { id: 90, display_name: 'Pat Player', current_level: 4321, updated_at: '2026-09-01' },
        { id: 91, display_name: 'Sam Spare', current_level: 2100, updated_at: '2026-08-01' },
        { id: 92, display_name: 'Sam Squad', current_level: 3000, updated_at: '2026-07-01' },
        { id: 93, display_name: 'Away Player', current_level: 1500, updated_at: '2026-06-01' },
      ];
      const name = url.searchParams.get('display_name') ?? '';
      const wanted = name.replace(/^ilike\./i, '').replaceAll('*', '').trim().toLowerCase();
      const matched = wanted ? rows.filter((row) => row.display_name.toLowerCase() === wanted) : rows;
      return send(single ? (matched[0] ?? null) : matched);
    }
    if (path.endsWith('/squashlevels_ratings')) {
      return send([
        { recorded_on: '2026-01-10', level: 4200, kind: 'after', squashlevels_match_id: 'a' },
        { recorded_on: '2026-06-10', level: 4321, kind: 'after', squashlevels_match_id: 'b' },
      ]);
    }
    if (path.endsWith('/squad_players')) return answerSquadPlayers(route, method, url, body, players, () => nextId++);
    if (path.endsWith('/availability')) return answerAvailability(route, method, url, body, availability, () => nextId++);
    if (path.endsWith('/selections')) return answerSelections(route, method, url, body, selections, () => nextId++);
    if (path.endsWith('/league_seasons')) {
      return send([
        { id: 2, name: '2026-27', starts_on: '2026-09-01' },
        { id: 1, name: '2025-26', starts_on: '2025-09-01' },
      ]);
    }
    if (path.endsWith('/league_teams')) {
      return send([
        { id: 20, name: 'Test Team 1', club_slug: 'test-club', team_id: 5 },
        { id: 21, name: 'Visitors', club_slug: 'other-club', team_id: 6 },
      ]);
    }
    if (path.endsWith('/fixtures')) return send([fixture, earlier]);
    if (path.endsWith('/contributions')) {
      return send([
        {
          id: 'c1',
          kind: 'photo',
          title: null,
          caption: 'Club night',
          status: 'pending',
          created_at: '2026-10-01T12:00:00.000Z',
          credit: 'Pat Player',
          submitted_by: person.id,
        },
      ]);
    }
    if (path.endsWith('/nominations')) {
      const season = url.searchParams.get('season') ?? '';
      if (season.includes('Winter')) {
        return send([{ team_id: 5, player_name: 'Pat Player', period: 1, position: 1, season: 'Winter 2026/27' }]);
      }
      return send([]);
    }
    if (path.endsWith('/rubbers')) return send([]);
    return send([]);
  });

  return { players };
}

function answerSquadPlayers(route: Route, method: string, url: URL, body: Record<string, unknown> | null, players: Player[], id: () => number) {
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
  if (method === 'PATCH' && body) {
    const target = url.searchParams.get('id') ?? '';
    const row = players.find((item) => `eq.${item.id}` === target);
    if (row && 'email' in body) row.email = body.email ? String(body.email) : null;
    if (row && 'phone' in body) row.phone = body.phone ? String(body.phone) : null;
    if (row && 'england_squash_id' in body) row.england_squash_id = body.england_squash_id ? String(body.england_squash_id) : null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row ? [row] : []) });
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
