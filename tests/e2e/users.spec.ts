import { expect, test, type Page, type Route } from '@playwright/test';

/** Administration → Users, with Supabase stubbed. This does not touch live accounts. */

const SUPABASE = 'https://klxyjmwiaivvqjbhxzak.supabase.co';
const adminId = '44444444-4444-4444-8444-444444444444';
const samId = '66666666-6666-4666-8666-666666666666';
const countyId = '77777777-7777-4777-8777-777777777777';

type Hooks = {
  refuseActive: boolean;
  requireClub: boolean;
  squadWrites: number;
  actions: string[];
  bodies: Record<string, unknown>[];
};

const hooks: Hooks = { refuseActive: false, requireClub: false, squadWrites: 0, actions: [], bodies: [] };

test.beforeEach(async ({ context, baseURL, page }) => {
  hooks.refuseActive = false;
  hooks.requireClub = false;
  hooks.squadWrites = 0;
  hooks.actions = [];
  hooks.bodies = [];
  await context.addCookies([{ name: 'beds_cookies', value: 'essential', url: baseURL! }]);
  await installAdmin(page);
});

async function openUsers(page: Page) {
  await page.goto('captains/admin/#users', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
}

test.describe('Users', () => {
  test('an email that is not a real address is marked and is not saved', async ({ page }) => {
    await openUsers(page);
    const email = page.getByRole('textbox', { name: 'Email for Pat Player' });
    await email.fill('not-an-email');
    await page.getByRole('searchbox', { name: 'Search' }).click();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-status]')).toHaveText('Enter a valid email address.');
    expect(hooks.squadWrites).toBe(0);
  });

  test('password on a row with no email says to add one', async ({ page }) => {
    await openUsers(page);
    await page.getByRole('button', { name: 'Password for Alex Away' }).click();
    await expect(page.locator('[data-status]')).toHaveText('Add an email address.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(hooks.actions).not.toContain('create');
  });

  test('password on a row with an invalid email is refused', async ({ page }) => {
    await openUsers(page);
    await page.getByRole('button', { name: 'Password for Zoe Player' }).click();
    await expect(page.locator('[data-status]')).toHaveText('Enter a valid email address.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('password opens a dialog, generates a password, and sets it', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openUsers(page);
    await page.getByRole('button', { name: 'Password for Pat Player' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Pat Player');
    await expect(dialog.locator('[data-password-dialog-login]')).toHaveText('pat.player@example.test');
    await expect(dialog.locator('[data-password-must-change]')).toBeChecked();
    await dialog.getByRole('button', { name: 'Generate' }).click();
    const value = dialog.locator('[data-password-dialog-value]');
    await expect(value).toHaveValue(/\S{12,}/);
    await dialog.getByRole('button', { name: 'Copy details' }).click();
    await expect(dialog.locator('[data-password-dialog-error]')).toHaveText('Player, login and password copied. Paste them into an email.');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('Player: Pat Player');
    expect(copied).toContain('Login: pat.player@example.test');
    expect(copied).toContain(`Password: ${await value.inputValue()}`);
    expect(copied).toContain('Please change this password the next time you sign in.');
    await dialog.getByRole('button', { name: 'Set password' }).click();
    await expect(dialog.locator('[data-password-dialog-error]')).toHaveText('Password set. Copy the player, login and password. Nothing was emailed.');
    expect(hooks.bodies.find((body) => body.action === 'create')?.must_change_password).toBe(true);
  });

  test('a password for someone with no login retries when the account service asks for a club', async ({ page }) => {
    hooks.requireClub = true;
    await openUsers(page);
    await page.getByRole('button', { name: 'Password for Pat Player' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Generate' }).click();
    await dialog.getByRole('button', { name: 'Set password' }).click();
    await expect(dialog.locator('[data-password-dialog-error]')).toHaveText('Password set. Copy the player, login and password. Nothing was emailed.');
    const creates = hooks.bodies.filter((body) => body.action === 'create');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.role).toBe('team_player');
    expect([5, 6]).toContain(creates[1]?.team_id);
  });

  test('roles open on every row and the choice is still there after it saves', async ({ page }) => {
    await openUsers(page);
    await page.getByRole('button', { name: 'Roles for Sam Morris' }).click();
    await expect(page.locator('[data-role-pop]')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Admin' })).toBeEnabled();
    await expect(page.getByRole('checkbox', { name: 'LM Player' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'LM Player' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'JC Player' })).toBeDisabled();
    await page.getByRole('heading', { name: 'Users', exact: true }).click();

    await page.getByRole('button', { name: 'Roles for Pat Player' }).click();
    await expect(page.getByRole('checkbox', { name: 'Admin' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'LM Club Captain' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'LM Team Captain' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'LM Player' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'JC Player' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'RB Player' }).check();
    await page.getByRole('heading', { name: 'Users', exact: true }).click();
    await expect(page.locator('[data-status]')).toHaveText('Roles saved for Pat Player.');
    const patRoles = page.getByRole('button', { name: 'Roles for Pat Player' });
    await expect(patRoles).toHaveText('RB Player');
    await patRoles.click();
    await expect(page.getByRole('checkbox', { name: 'RB Player' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'LM Player' })).toBeDisabled();
  });

  test('Active is green, turns red, and stays red if the next account check fails', async ({ page }) => {
    await openUsers(page);
    const active = page.getByRole('button', { name: 'Active for Sam Morris' });
    await expect(active).toHaveCSS('background-color', 'rgb(21, 128, 61)');
    let confirmed = false;
    page.on('dialog', async (dialog) => {
      confirmed = true;
      await dialog.dismiss();
    });
    await active.click();
    const inactive = page.getByRole('button', { name: 'Inactive for Sam Morris' });
    await expect(inactive).toBeVisible();
    await expect(inactive).toHaveCSS('background-color', 'rgb(185, 28, 28)');
    await expect(page.locator('[data-status]')).toHaveText('Sam Morris is inactive.');
    expect(confirmed).toBe(false);
  });

  test('Active stays green when the account service refuses the change', async ({ page }) => {
    hooks.refuseActive = true;
    await openUsers(page);
    const active = page.getByRole('button', { name: 'Active for Sam Morris' });
    await active.click();
    await expect(page.locator('[data-status]')).toHaveText('That account stays active.');
    await expect(page.locator('[data-users] tr', { hasText: 'Sam Morris' })).toContainText('That account stays active.');
    await expect(active).toHaveCSS('background-color', 'rgb(21, 128, 61)');
    await expect(page.getByRole('button', { name: 'Inactive for Sam Morris' })).toHaveCount(0);
  });

  test('Delete removes the login and leaves the League Master player', async ({ page }) => {
    await openUsers(page);
    const sam = page.locator('[data-users] tr', { hasText: 'Sam Morris' });
    await expect(sam.getByRole('button', { name: 'Delete Sam Morris' })).toHaveAttribute(
      'title',
      'Deletes the login only. The League Master record stays.',
    );
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Delete the login for Sam Morris? Their League Master record stays.');
      await dialog.accept();
    });
    await sam.getByRole('button', { name: 'Delete Sam Morris' }).click();
    await expect(page.locator('[data-users] tr', { hasText: 'Sam Morris' })).toContainText('No login');
    await expect(page.getByRole('button', { name: 'Delete Sam Morris' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Sam Morris', exact: true })).toBeVisible();
  });

  test('Place shows each team name without the division', async ({ page }) => {
    await openUsers(page);
    const pat = page.locator('[data-users] tr', { hasText: 'Pat Player' });
    await expect(pat.locator('td').nth(1)).toHaveText('Test Team 1; Test Team 2');
    await expect(page.locator('[data-users-pager]')).toBeHidden();
  });

  test('Group and Place narrow the list, and a login outside League Master keeps its sign-in', async ({ page }) => {
    await openUsers(page);
    const ada = page.locator('[data-users] tr', { hasText: 'Ada Admin' });
    await expect(ada).toContainText(/4 Oct 2026/);
    await page.getByLabel('Group').selectOption({ label: 'Admin' });
    await expect(ada).toBeVisible();
    await expect(page.locator('[data-users] tr', { hasText: 'Pat Player' })).toHaveCount(0);
    await page.getByLabel('Group').selectOption({ label: 'All groups' });
    await page.getByLabel('Place').selectOption({ label: 'Other Team' });
    await expect(page.locator('[data-users] tr', { hasText: 'Alex Away' })).toBeVisible();
    await expect(page.locator('[data-users] tr', { hasText: 'Pat Player' })).toHaveCount(0);
    await expect(ada).toHaveCount(0);
  });

  test('search finds a player by team and by email, and a miss says so', async ({ page }) => {
    await openUsers(page);
    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.fill('other team');
    await expect(page.locator('[data-users]')).toContainText('Alex Away');
    await expect(page.locator('[data-users]')).not.toContainText('Pat Player');
    await search.fill('pat.player@example.test');
    await expect(page.locator('[data-users]')).toContainText('Pat Player');
    await expect(page.locator('[data-users]')).not.toContainText('Alex Away');
    await search.fill('no-such-player');
    await expect(page.getByText('No players match that search.')).toBeVisible();
  });

  test('a junior entry is listed as a JC Player', async ({ page }) => {
    await openUsers(page);
    await page.getByLabel('Group').selectOption({ label: 'JC Player' });
    const jamie = page.locator('[data-users] tr', { hasText: 'Jamie Junior' });
    await expect(jamie).toBeVisible();
    await expect(jamie.locator('td').nth(1)).toHaveText('Test Club');
    await expect(jamie.getByRole('textbox', { name: 'Email for Jamie Junior' })).toHaveValue('guardian@example.test');
    await expect(jamie.getByRole('textbox', { name: 'Mobile for Jamie Junior' })).toHaveValue('07000999999');
    await expect(page.locator('[data-users] tr', { hasText: 'Pat Player' })).toHaveCount(0);
    await jamie.getByRole('button', { name: 'Roles for Jamie Junior' }).click();
    await expect(page.getByRole('checkbox', { name: 'JC Player' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'JC Player' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'LM Player' })).not.toBeChecked();
  });

  test('the county row stays locked', async ({ page }) => {
    await openUsers(page);
    const county = page.locator('[data-users] tr', { hasText: 'County Keeper' });
    await expect(county).toContainText('BSCA');
    await expect(county).toContainText('Default admin');
    await expect(county.getByRole('textbox')).toHaveCount(0);
    await expect(county.getByRole('button', { name: 'Password for County Keeper' })).toHaveCount(0);
    await expect(county.getByRole('button', { name: 'Active for County Keeper' })).toHaveCount(0);
    await expect(county.getByRole('button', { name: 'Delete County Keeper' })).toHaveCount(0);
  });
});

function jwt(payload: Record<string, unknown>) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.simulated`;
}

async function installAdmin(page: Page) {
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
      user_metadata: { display_name: 'Ada Admin' },
      identities: [],
      created_at: '2026-10-02T00:00:00Z',
      updated_at: '2026-10-02T00:00:00Z',
    },
  };
  await page.addInitScript((stored) => {
    localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
  }, session);

  const profiles = [
    { id: adminId, display_name: 'Ada Admin', email: 'admin@example.test', is_admin: true },
    { id: samId, display_name: 'Sam Morris', email: 'sam.morris@example.test', is_admin: true },
    { id: countyId, display_name: 'County Keeper', email: 'county-admin@players.invalid', is_admin: false },
  ];
  const groupMembers: { profile_id: string | null; person_name: string; place: string | null; group_slug: string }[] = [
    { profile_id: adminId, person_name: 'Ada Admin', place: null, group_slug: 'admins' },
    { profile_id: samId, person_name: 'Sam Morris', place: 'Test Club / Test Team 1', group_slug: 'admins' },
    { profile_id: samId, person_name: 'Sam Morris', place: 'Test Club / Test Team 1', group_slug: 'lm_players' },
    { profile_id: null, person_name: 'Pat Player', place: 'Test Club / Test Team 1', group_slug: 'lm_players' },
    { profile_id: null, person_name: 'Zoe Player', place: 'Test Club / Test Team 1', group_slug: 'lm_players' },
    { profile_id: null, person_name: 'Sam Squad', place: 'Test Club / Test Team 2', group_slug: 'lm_players' },
    { profile_id: null, person_name: 'Alex Away', place: 'Other Club / Other Team', group_slug: 'lm_players' },
    { profile_id: countyId, person_name: 'County Keeper', place: null, group_slug: 'lm_players' },
  ];
  const active = new Map<string, boolean>([
    [adminId, true],
    [samId, true],
    [countyId, true],
  ]);
  let statesDown = false;

  await page.route(`${SUPABASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const respond = (payload: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (path.startsWith('/auth/v1/')) {
      await respond(path.endsWith('/user') ? session.user : session);
      return;
    }
    if (path.endsWith('/functions/v1/manage-accounts')) {
      const payload = route.request().postDataJSON() as {
        action?: string;
        user_id?: string;
        active?: boolean;
        member?: boolean;
        group_slug?: string;
        person_name?: string;
        role?: string;
      } | null;
      const action = payload?.action ?? '';
      hooks.actions.push(action);
      hooks.bodies.push((payload ?? {}) as Record<string, unknown>);
      if (action === 'create' && hooks.requireClub && !payload?.role) {
        await respond({ error: 'Choose a club.' });
        return;
      }
      if (action === 'states') {
        if (statesDown) {
          await respond({ error: 'down' });
          return;
        }
        await respond({
          accounts: [...active.entries()].map(([id, on]) => ({ id, last_sign_in_at: '2026-10-04T09:30:00.000Z', active: on })),
        });
        return;
      }
      if (action === 'set-active') {
        if (hooks.refuseActive) {
          await respond({ error: 'That account stays active.' });
          return;
        }
        if (payload?.user_id) active.set(payload.user_id, Boolean(payload.active));
        statesDown = true;
        await respond({ ok: true });
        return;
      }
      if (action === 'set-group' && payload?.member && payload.group_slug && payload.person_name) {
        const userId = typeof payload.user_id === 'string' ? payload.user_id : null;
        if (!groupMembers.some((row) => row.person_name === payload.person_name && row.group_slug === payload.group_slug)) {
          groupMembers.push({ profile_id: userId, person_name: payload.person_name, place: null, group_slug: payload.group_slug });
        }
      }
      if (action === 'delete' && payload?.user_id) {
        const index = profiles.findIndex((person) => person.id === payload.user_id);
        if (index >= 0) profiles.splice(index, 1);
        for (const row of groupMembers) {
          if (row.profile_id === payload.user_id) row.profile_id = null;
        }
        active.delete(payload.user_id);
      }
      await respond({ user_id: payload?.user_id || adminId });
      return;
    }
    if (path.endsWith('/profiles')) {
      const select = url.searchParams.get('select') ?? '';
      const id = url.searchParams.get('id') ?? '';
      const wanted = id.startsWith('eq.') ? id.slice(3) : '';
      const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
      if (select === 'is_admin') {
        await respond({ is_admin: Boolean(profiles.find((person) => person.id === wanted)?.is_admin) });
        return;
      }
      if (wanted) {
        const row = profiles.find((person) => person.id === wanted) ?? null;
        await respond(single ? row : row ? [row] : []);
        return;
      }
      await respond(profiles);
      return;
    }
    if (path.endsWith('/group_members')) {
      const profile = url.searchParams.get('profile_id');
      const slug = url.searchParams.get('group_slug');
      let rows = groupMembers;
      if (profile?.startsWith('eq.')) rows = rows.filter((row) => row.profile_id === profile.slice(3));
      if (slug?.startsWith('eq.')) rows = rows.filter((row) => row.group_slug === slug.slice(3));
      const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
      const shaped = rows.map((row) => ({ ...row, groups: { name: row.group_slug, position: 1, roles: { name: row.group_slug } } }));
      await respond(single ? shaped[0] ?? null : shaped);
      return;
    }
    if (path.endsWith('/clubs')) {
      await respond([
        { slug: 'test-club', name: 'Test Club', contact_name: 'Chris Club', contact_email: 'club@example.test' },
        { slug: 'other-club', name: 'Other Club', contact_name: 'Olivia Other', contact_email: 'other@example.test' },
      ]);
      return;
    }
    if (path.endsWith('/teams')) {
      await respond([
        { id: 5, club_slug: 'test-club', name: 'Test Team 1', division: 'Division 1', captain_name: 'Taylor Team', captain_email: 'taylor@example.test', last_season: 'Winter 2026/27' },
        { id: 6, club_slug: 'test-club', name: 'Test Team 2', division: 'Division 2', captain_name: 'Sam Captain', captain_email: 'sam@example.test', last_season: 'Winter 2026/27' },
        { id: 7, club_slug: 'other-club', name: 'Other Team', division: 'Division 1', captain_name: 'Alex Captain', captain_email: 'alex@example.test', last_season: 'Winter 2026/27' },
      ]);
      return;
    }
    if (path.endsWith('/captain_squads')) {
      await respond([
        {
          id: 10,
          name: 'Test Team 1',
          team_id: 5,
          squad_players: [
            { id: 1, display_name: 'Pat Player', email: 'pat.player@example.test', phone: '07000000000', england_squash_id: '123456' },
            { id: 2, display_name: 'Zoe Player', email: 'not-an-email', phone: null, england_squash_id: null },
            { id: 5, display_name: 'Sam Morris', email: 'sam.morris@example.test', phone: '07000111111', england_squash_id: null },
          ],
        },
        {
          id: 11,
          name: 'Test Team 2',
          team_id: 6,
          squad_players: [
            { id: 6, display_name: 'Pat Player', email: 'pat.player@example.test', phone: '07000000000', england_squash_id: '123456' },
            { id: 3, display_name: 'Sam Squad', email: 'sam.squad@example.test', phone: null, england_squash_id: null },
          ],
        },
        {
          id: 12,
          name: 'Other Team',
          team_id: 7,
          squad_players: [{ id: 4, display_name: 'Alex Away', email: null, phone: null, england_squash_id: null }],
        },
      ]);
      return;
    }
    if (path.endsWith('/nominations')) {
      await respond([
        { team_id: 5, player_name: 'Pat Player', period: 1, position: 1, season: 'Winter 2026/27' },
        { team_id: 6, player_name: 'Pat Player', period: 1, position: 1, season: 'Winter 2026/27' },
        { team_id: 5, player_name: 'Zoe Player', period: 1, position: 2, season: 'Winter 2026/27' },
        { team_id: 5, player_name: 'Sam Morris', period: 1, position: 3, season: 'Winter 2026/27' },
        { team_id: 6, player_name: 'Sam Squad', period: 1, position: 1, season: 'Winter 2026/27' },
        { team_id: 7, player_name: 'Alex Away', period: 1, position: 1, season: 'Winter 2026/27' },
      ]);
      return;
    }
    if (path.endsWith('/roles')) {
      await respond([
        { slug: 'admin', name: 'Admin', position: 1 },
        { slug: 'lm_club_captain', name: 'LM Club Captain', position: 2 },
        { slug: 'lm_team_captain', name: 'LM Team Captain', position: 3 },
        { slug: 'lm_player', name: 'LM Player', position: 4 },
        { slug: 'jc_player', name: 'JC Player', position: 6 },
        { slug: 'junior_organiser', name: 'Junior Organiser', position: 7 },
        { slug: 'bc_player', name: 'BC Player', position: 8 },
        { slug: 'rb_player', name: 'RB Player', position: 9 },
      ]);
      return;
    }
    if (path.endsWith('/groups')) {
      await respond([
        { slug: 'admins', name: 'Admins', role_slug: 'admin', source: 'account', managed: true, position: 1 },
        { slug: 'lm_club_captains', name: 'LM Club Captains', role_slug: 'lm_club_captain', source: 'leaguemaster', managed: true, position: 2 },
        { slug: 'lm_team_captains', name: 'LM Team Captains', role_slug: 'lm_team_captain', source: 'leaguemaster', managed: true, position: 3 },
        { slug: 'lm_players', name: 'LM Players', role_slug: 'lm_player', source: 'leaguemaster', managed: true, position: 4 },
        { slug: 'jc_players', name: 'JC Players', role_slug: 'jc_player', source: 'website', managed: false, position: 6 },
        { slug: 'junior_organisers', name: 'Junior Organisers', role_slug: 'junior_organiser', source: 'website', managed: false, position: 7 },
        { slug: 'bc_players', name: 'BC Players', role_slug: 'bc_player', source: 'website', managed: false, position: 8 },
        { slug: 'rb_players', name: 'RB Players', role_slug: 'rb_player', source: 'website', managed: false, position: 9 },
      ]);
      return;
    }
    if (path.endsWith('/rb_players')) {
      await respond([]);
      return;
    }
    if (path.endsWith('/junior_entries')) {
      await respond([
        {
          player_first_name: 'Jamie',
          player_last_name: 'Junior',
          date_of_birth: '2015-04-02',
          age_category: 'Under 11',
          draw: 'Girls',
          club: 'Test Club',
          guardian_name: 'Pat Guardian',
          guardian_email: 'guardian@example.test',
          guardian_phone: '07000999999',
          emergency_name: 'Sam Emergency',
          emergency_phone: '07000000001',
          notes: null,
        },
      ]);
      return;
    }
    if (path.endsWith('/squad_players') && route.request().method() !== 'GET') {
      hooks.squadWrites += 1;
    }
    await respond([]);
  });
}
