import { expect, test, type Page, type Route } from '@playwright/test';

const SUPABASE = 'https://klxyjmwiaivvqjbhxzak.supabase.co';

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'beds_cookies', value: 'essential', url: baseURL! }]);
});

function jwt(payload: Record<string, unknown>) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.simulated`;
}

function sessionFor(id: string, email: string, name: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  return {
    access_token: jwt({ sub: id, email, role: 'authenticated', exp: expiresAt }),
    refresh_token: 'simulated-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { display_name: name },
      identities: [],
      created_at: '2026-10-02T00:00:00Z',
      updated_at: '2026-10-02T00:00:00Z',
    },
  };
}

async function remember(page: Page, session: ReturnType<typeof sessionFor>) {
  await page.addInitScript((stored) => {
    localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
  }, session);
}

function send(route: Route, payload: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
}

test.describe('Login', () => {
  test('a wrong password stays on the login page', async ({ page }) => {
    await page.route(`${SUPABASE}/auth/v1/token**`, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid login credentials', msg: 'Invalid login credentials' }),
      });
    });
    await page.goto('login/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Email or login' }).fill('pat.player@example.test');
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('[data-status]')).toHaveText('Invalid login credentials');
    await expect(page).toHaveURL(/\/login\/$/);
    await expect(page.locator('form[data-form="sign-in"]')).toBeVisible();
  });

  test('BSCA is sent to the county account', async ({ page }) => {
    let emailed = '';
    const session = sessionFor('6e931b9e-298b-4289-b3e1-24a175bf964b', 'county-admin@players.invalid', 'County Admin');
    await page.clock.install({ time: new Date('2026-10-08T12:00:00Z') });
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/token')) {
        emailed = String((route.request().postDataJSON() as { email?: string } | null)?.email ?? '');
        await send(route, session);
        return;
      }
      if (url.pathname.endsWith('/user') || url.pathname.startsWith('/auth/v1/')) {
        await send(route, session.user);
        return;
      }
      if (url.pathname.endsWith('/profiles')) {
        const row = { id: session.user.id, display_name: 'County Admin', email: session.user.email, is_admin: false };
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(route, single ? row : [row]);
        return;
      }
      await send(route, []);
    });
    await page.goto('login/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Email or login' }).fill('BSCA');
    await page.getByLabel('Password').fill('TestPassword1!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('[data-status]')).toHaveText('Signed in. If Chrome asks to save the password, choose Save.');
    expect(emailed).toBe('county-admin@players.invalid');
    await page.clock.fastForward(4000);
    await expect(page).toHaveURL(/\/captains\/you\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My squash' })).toBeVisible();
  });

  test('a signed-out visit keeps the original page in the address', async ({ page }) => {
    for (const path of ['captains/', 'captains/profile/', 'captains/matches/', 'juniors/closed/entries/']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login\/\?next=/);
      const next = new URL(page.url()).searchParams.get('next') ?? '';
      expect(decodeURIComponent(next)).toContain(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
    }
  });
});

test.describe('Signed-in account', () => {
  test('sign out returns to the public site and locks the captain pages', async ({ page }) => {
    const session = sessionFor('33333333-3333-4333-8333-333333333333', 'pat.player@example.test', 'Pat Player');
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/logout')) {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      if (url.pathname.startsWith('/auth/v1/')) {
        await send(route, url.pathname.endsWith('/user') ? session.user : session);
        return;
      }
      if (url.pathname.endsWith('/profiles')) {
        const row = { id: session.user.id, display_name: 'Pat Player', email: session.user.email, is_admin: false };
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(route, single ? row : [row]);
        return;
      }
      await send(route, []);
    });
    await page.goto('captains/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((stored) => {
      localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
    }, session);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login\/\?next=/);
    await page.goto('captains/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login\/\?next=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  });

  test('a short password and the email address are refused', async ({ page }) => {
    const email = 'Pat.Player1@example.test';
    const session = sessionFor('33333333-3333-4333-8333-333333333333', email, 'Pat Player');
    await remember(page, session);
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/auth/v1/')) {
        await send(route, url.pathname.endsWith('/user') ? session.user : session);
        return;
      }
      if (url.pathname.endsWith('/profiles')) {
        const row = { id: session.user.id, display_name: 'Pat Player', email, is_admin: false };
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(route, single ? row : [row]);
        return;
      }
      await send(route, []);
    });
    await page.goto('captains/profile/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Change password' }).click();
    const form = page.locator('form[data-change-password]');
    const next = form.locator('input[name="password"]');
    await next.fill('short');
    await form.locator('input[name="confirm_password"]').fill('short');
    await page.getByRole('button', { name: 'Update password' }).click();
    expect(await next.evaluate((input: HTMLInputElement) => input.validationMessage)).toMatch(/8/);

    await next.fill(email);
    await form.locator('input[name="confirm_password"]').fill(email);
    await form.locator('input[name="current_password"]').fill('anything1');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.locator('[data-password-status]')).toHaveText('Do not use the email address as the password.');
  });

  test('the county login sees the league lists and not Users, Groups, or Roles', async ({ page }) => {
    const session = sessionFor('6e931b9e-298b-4289-b3e1-24a175bf964b', 'county-admin@players.invalid', 'County Admin');
    await remember(page, session);
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path.startsWith('/auth/v1/')) {
        await send(route, path.endsWith('/user') ? session.user : session);
        return;
      }
      if (path.endsWith('/profiles')) {
        const row = { id: session.user.id, display_name: 'County Admin', email: session.user.email, is_admin: false };
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(route, single || url.searchParams.get('select') === 'is_admin' ? row : [row]);
        return;
      }
      if (path.endsWith('/clubs')) {
        await send(route, [{ slug: 'test-club', name: 'Test Club', contact_name: 'Chris Club', contact_email: 'club@example.test' }]);
        return;
      }
      if (path.endsWith('/teams')) {
        await send(route, [
          {
            id: 5,
            club_slug: 'test-club',
            name: 'Test Team 1',
            division: 'Division 1',
            captain_name: 'Taylor Team',
            captain_email: 'taylor@example.test',
            last_season: 'Winter 2026/27',
          },
        ]);
        return;
      }
      if (path.endsWith('/captain_squads')) {
        await send(route, [
          {
            id: 10,
            name: 'Test Team 1',
            team_id: 5,
            squad_players: [{ id: 1, display_name: 'Pat Player', email: 'pat.player@example.test', phone: null, england_squash_id: null }],
          },
        ]);
        return;
      }
      if (path.endsWith('/nominations')) {
        await send(route, [{ team_id: 5, player_name: 'Pat Player', season: 'Winter 2026/27' }]);
        return;
      }
      await send(route, []);
    });
    await page.goto('captains/admin/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
    await expect(page.locator('[data-site-club]')).toContainText('Chris Club');
    await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Groups' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Roles', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Player', exact: true }).click();
    await expect(page.locator('[data-site-player-list]')).toContainText('Pat Player');
    await expect(page.locator('[data-site-player-list]').getByRole('textbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    await expect(page.locator('[data-site-team]')).toContainText('Taylor Team');
  });
});

test.describe('Junior County Closed', () => {
  test('a date of birth shows the age group, and Under 9 is Mixed', async ({ page }) => {
    await page.goto('juniors/closed/', { waitUntil: 'domcontentloaded' });
    const dob = page.locator('[name="date_of_birth"]');
    const category = page.locator('[data-category]');
    await dob.fill('2016-03-01');
    await expect(category).toHaveText('Choose Boys or Girls to see the age group.');
    await page.locator('[name="draw"]').selectOption('Girls');
    await expect(category).toHaveText('Age group: Girls U11');
    await expect(page.locator('[data-section]')).toBeVisible();

    await dob.fill('2018-01-15');
    await expect(category).toHaveText('Age group: Mixed U9');
    await expect(page.locator('[data-section]')).toBeHidden();
    await expect(page.getByRole('combobox', { name: 'Section' })).toHaveCount(0);
  });

  test('a date outside the age groups is refused', async ({ page }) => {
    await page.goto('juniors/closed/', { waitUntil: 'domcontentloaded' });
    await page.locator('[name="date_of_birth"]').evaluate((input) => {
      const field = input as HTMLInputElement;
      field.value = '2007-01-01';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('[data-category]')).toHaveText(
      'That date of birth is outside the junior age groups, so this player cannot be entered.',
    );
  });

  test('the form closes after 28 October', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
    await page.goto('juniors/closed/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-status]')).toHaveText('Entries closed on Wednesday 28th October.');
    await expect(page.locator('form[data-form]')).toBeHidden();
  });

  test('a complete entry is accepted and nothing is emailed', async ({ page }) => {
    let posted: Record<string, unknown> | null = null;
    await page.route(`${SUPABASE}/rest/v1/junior_entries**`, async (route) => {
      if (route.request().method() === 'POST') posted = route.request().postDataJSON() as Record<string, unknown>;
      await send(route, { id: 1 }, 201);
    });
    await page.goto('juniors/closed/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('checkbox', { name: /first name and surname initial/i })).not.toBeChecked();
    await fillEntry(page, '2016-03-01');
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.locator('[data-thanks]')).toHaveText('Entry received. The organiser has these details. Nothing has been emailed.');
    await expect(page.locator('form[data-form]')).toBeHidden();
    expect(posted).toMatchObject({
      player_first_name: 'Jamie',
      player_last_name: 'Junior',
      age_category: 'Under 11',
      draw: 'Girls',
      guardian_email: 'guardian@example.test',
      show_name: false,
    });
  });

  test('ticking the name box sends consent, and the public list shows only those names', async ({ page }) => {
    let posted: Record<string, unknown> | null = null;
    const groups = [
      { label: 'Mixed U9', count: 0, names: [] },
      { label: 'Girls U11', count: 2, names: ['Jamie J.'] },
      { label: 'Girls U13', count: 1, names: [] },
      { label: 'Girls U15', count: 0, names: [] },
      { label: 'Girls U17', count: 0, names: [] },
      { label: 'Girls U19', count: 0, names: [] },
      { label: 'Boys U11', count: 0, names: [] },
      { label: 'Boys U13', count: 0, names: [] },
      { label: 'Boys U15', count: 0, names: [] },
      { label: 'Boys U17', count: 0, names: [] },
      { label: 'Boys U19', count: 0, names: [] },
    ];
    await page.route(`${SUPABASE}/rest/v1/rpc/junior_public_entries**`, async (route) => {
      await send(route, groups);
    });
    await page.route(`${SUPABASE}/rest/v1/junior_entries**`, async (route) => {
      if (route.request().method() === 'POST') posted = route.request().postDataJSON() as Record<string, unknown>;
      await send(route, { id: 1 }, 201);
    });
    await page.goto('juniors/', { waitUntil: 'domcontentloaded' });
    const girls = page.locator('[data-entry-group="Girls U11"]');
    await expect(girls).toContainText('2 entries');
    await expect(girls.getByRole('listitem')).toHaveText('Jamie J.');
    await expect(page.locator('[data-entry-group="Mixed U9"]')).toContainText('0 entries');
    await expect(page.locator('[data-entry-group="Mixed U9"] li')).toHaveCount(0);
    await expect(page.locator('[data-entry-group="Girls U13"] li')).toHaveCount(0);
    await expect(page.getByText('A parent can take a name off this list at any time')).toBeVisible();

    await page.goto('juniors/closed/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-entry-group="Girls U11"]')).toContainText('Jamie J.');
    await fillEntry(page, '2016-03-01');
    await page.getByRole('checkbox', { name: /first name and surname initial/i }).check();
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.locator('[data-thanks]')).toBeVisible();
    expect(posted).toMatchObject({ show_name: true });
  });

  test('the same player entered twice is refused', async ({ page }) => {
    await page.route(`${SUPABASE}/rest/v1/junior_entries**`, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: '23505',
          message: 'duplicate key value violates unique constraint',
          details: null,
          hint: null,
        }),
      });
    });
    await page.goto('juniors/closed/', { waitUntil: 'domcontentloaded' });
    await fillEntry(page, '2016-03-01');
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.locator('[data-status]')).toHaveText('This player is already entered.');
    await expect(page.locator('form[data-form]')).toBeVisible();
  });

  test('the hidden company field does not create an entry', async ({ page }) => {
    let posts = 0;
    await page.route(`${SUPABASE}/rest/v1/junior_entries**`, async (route) => {
      if (route.request().method() === 'POST') posts += 1;
      await send(route, { id: 1 }, 201);
    });
    await page.goto('juniors/closed/', { waitUntil: 'domcontentloaded' });
    await fillEntry(page, '2016-03-01');
    await page.locator('[name="company"]').fill('Spam Ltd');
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.locator('[data-thanks]')).toBeVisible();
    expect(posts).toBe(0);
  });

  test('an organiser sees the entry and can remove it', async ({ page }) => {
    const session = sessionFor('55555555-5555-4555-8555-555555555555', 'gail@example.test', 'Gail Clarke');
    const entries = [
      {
        id: 4,
        player_first_name: 'Jamie',
        player_last_name: 'Junior',
        date_of_birth: '2015-04-02',
        age_category: 'Under 11',
        draw: 'Girls',
        club: 'Test Club',
        guardian_name: 'Pat Guardian',
        guardian_email: 'guardian@example.test',
        guardian_phone: '07000000000',
        emergency_name: 'Sam Emergency',
        emergency_phone: '07000000001',
        notes: 'Needs a spare racket',
        created_at: '2026-10-01T12:00:00Z',
      },
    ];
    await remember(page, session);
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path.startsWith('/auth/v1/')) {
        await send(route, path.endsWith('/user') ? session.user : session);
        return;
      }
      if (path.endsWith('/profiles')) {
        await send(route, { id: session.user.id, display_name: 'Gail Clarke', is_admin: false });
        return;
      }
      if (path.endsWith('/group_members')) {
        const row = { profile_id: session.user.id, group_slug: 'junior_organisers', groups: { name: 'Junior Organisers', position: 7, roles: { name: 'Junior Organiser' } } };
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(route, single ? row : [row]);
        return;
      }
      if (path.endsWith('/junior_entries')) {
        if (route.request().method() === 'DELETE') {
          entries.length = 0;
          await send(route, []);
          return;
        }
        await send(route, entries);
        return;
      }
      await send(route, []);
    });
    await page.goto('juniors/closed/entries/', { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: 'Jamie Junior' });
    await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(row).toContainText('Pat Guardian');
    await expect(row).toContainText('guardian@example.test');
    await expect(row).toContainText('Sam Emergency');
    await expect(row).toContainText('07000000001');
    await expect(row).toContainText('Needs a spare racket');
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('Remove Jamie Junior from the entry list?');
      void dialog.accept();
    });
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('cell', { name: 'Jamie Junior' })).toHaveCount(0);
    await expect(page.getByText('No entries.').first()).toBeVisible();
  });

  test('an admin can correct every field on a junior entry', async ({ page }) => {
    const session = sessionFor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin@example.test', 'Ada Admin');
    const entries = [
      {
        id: 4,
        player_first_name: 'Pat',
        player_last_name: 'Guardian',
        date_of_birth: '2015-04-02',
        age_category: 'Under 11',
        draw: 'Girls',
        club: 'Test Club',
        guardian_name: 'Pat Guardian',
        guardian_email: 'guardian@example.test',
        guardian_phone: '07000000000',
        emergency_name: 'Sam Emergency',
        emergency_phone: '07000000001',
        notes: 'Needs a spare racket',
        show_name: false,
        created_at: '2026-10-01T12:00:00Z',
      },
    ];
    let saved: Record<string, unknown> | null = null;
    await remember(page, session);
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path.startsWith('/auth/v1/')) {
        await send(route, path.endsWith('/user') ? session.user : session);
        return;
      }
      if (path.endsWith('/profiles')) {
        await send(route, { id: session.user.id, display_name: 'Ada Admin', is_admin: true });
        return;
      }
      if (path.endsWith('/rpc/edit_junior_entry') && route.request().method() === 'POST') {
        saved = route.request().postDataJSON() as Record<string, unknown>;
        const entry = entries[0];
        entry.player_first_name = String(saved.p_first_name);
        entry.player_last_name = String(saved.p_last_name);
        entry.date_of_birth = String(saved.p_date_of_birth);
        entry.draw = String(saved.p_draw);
        entry.club = String(saved.p_club);
        entry.guardian_name = String(saved.p_guardian_name);
        entry.guardian_email = String(saved.p_guardian_email);
        entry.guardian_phone = String(saved.p_guardian_phone);
        entry.emergency_name = String(saved.p_emergency_name);
        entry.emergency_phone = String(saved.p_emergency_phone);
        entry.notes = String(saved.p_notes ?? '');
        entry.show_name = Boolean(saved.p_show_name);
        entry.age_category = 'Under 13';
        await send(route, null);
        return;
      }
      if (path.endsWith('/junior_entries')) {
        await send(route, entries);
        return;
      }
      await send(route, []);
    });
    await page.goto('juniors/closed/entries/', { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: 'Pat Guardian' }).first();
    await row.getByRole('button', { name: 'Edit' }).click();
    const editor = page.locator('form[data-editor="4"]');
    await expect(editor).toBeVisible();
    await editor.locator('[name="player_first_name"]').fill('Alex');
    await editor.getByLabel('Last name').fill('Player');
    await editor.getByLabel('Date of birth').fill('2014-06-01');
    await editor.getByLabel('Section').selectOption('Boys');
    await editor.getByLabel('Club').fill('New Club');
    await editor.getByLabel('Parent name').fill('Pat Guardian');
    await editor.getByLabel('Parent email').fill('pat@example.test');
    await editor.getByLabel('Parent phone').fill('07111111111');
    await editor.getByLabel('Emergency name').fill('Sam Contact');
    await editor.getByLabel('Emergency phone').fill('07222222222');
    await editor.getByLabel('Notes').fill('Bring kit');
    const consent = editor.getByRole('checkbox', { name: /first name and surname initial/i });
    await expect(consent).not.toBeChecked();
    await consent.check();
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(editor).toBeHidden();
    await expect(page.locator('[data-status]')).toHaveText('Saved.');
    await expect(page.getByRole('cell', { name: 'Alex Player' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Pat Guardian' })).toBeVisible();
    expect(saved).toMatchObject({
      p_id: 4,
      p_first_name: 'Alex',
      p_last_name: 'Player',
      p_date_of_birth: '2014-06-01',
      p_draw: 'Boys',
      p_club: 'New Club',
      p_guardian_name: 'Pat Guardian',
      p_guardian_email: 'pat@example.test',
      p_guardian_phone: '07111111111',
      p_emergency_name: 'Sam Contact',
      p_emergency_phone: '07222222222',
      p_notes: 'Bring kit',
      p_show_name: true,
    });
  });

  test('a captain who is not an organiser cannot see entries', async ({ page }) => {
    const session = sessionFor('11111111-1111-4111-8111-111111111111', 'club.captain@example.test', 'Chris Club');
    await remember(page, session);
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path.startsWith('/auth/v1/')) {
        await send(route, path.endsWith('/user') ? session.user : session);
        return;
      }
      if (path.endsWith('/profiles')) {
        await send(route, { is_admin: false });
        return;
      }
      if (path.endsWith('/group_members')) {
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(route, single ? null : []);
        return;
      }
      await send(route, []);
    });
    await page.goto('juniors/closed/entries/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This account cannot see entries.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });

  test('a junior organiser does not see Users or Delete', async ({ page }) => {
    const session = sessionFor('55555555-5555-4555-8555-555555555555', 'gail@example.test', 'Gail Clarke');
    await remember(page, session);
    await page.route(`${SUPABASE}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (path.startsWith('/auth/v1/')) {
        await send(route, path.endsWith('/user') ? session.user : session);
        return;
      }
      if (path.endsWith('/profiles')) {
        const row = { id: session.user.id, display_name: 'Gail Clarke', email: session.user.email, is_admin: false };
        const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
        await send(route, single || url.searchParams.get('select') === 'is_admin' ? row : [row]);
        return;
      }
      if (path.endsWith('/group_members')) {
        await send(route, [
          {
            profile_id: session.user.id,
            person_name: 'Gail Clarke',
            place: null,
            group_slug: 'junior_organisers',
            groups: { name: 'Junior Organisers', position: 7, roles: { name: 'Junior Organiser' } },
          },
        ]);
        return;
      }
      await send(route, []);
    });
    await page.goto('captains/admin/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Juniors', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });
});

async function fillEntry(page: Page, dateOfBirth: string) {
  await page.locator('[name="player_first_name"]').fill('Jamie');
  await page.locator('[name="player_last_name"]').fill('Junior');
  await page.locator('[name="date_of_birth"]').fill(dateOfBirth);
  await page.locator('[name="draw"]').selectOption('Girls');
  await page.locator('[name="club"]').fill('Test Club');
  await page.locator('[name="guardian_name"]').fill('Pat Guardian');
  await page.locator('[name="guardian_email"]').fill('guardian@example.test');
  await page.locator('[name="guardian_phone"]').fill('07000000000');
  await page.locator('[name="emergency_name"]').fill('Sam Emergency');
  await page.locator('[name="emergency_phone"]').fill('07000000001');
  await page.locator('[name="notes"]').fill('Needs a spare racket');
  await page.getByRole('checkbox', { name: /parent or guardian/ }).check();
}
