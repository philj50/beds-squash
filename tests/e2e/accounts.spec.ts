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
    await expect(page).toHaveURL(/\/captains\/profile\/$/);
    await expect(page.locator('[data-email]')).toHaveText('county-admin@players.invalid');
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
    expect(await next.evaluate((input: HTMLInputElement) => input.validationMessage)).toMatch(/12/);

    await next.fill('abcdefghijkl');
    await form.locator('input[name="confirm_password"]').fill('abcdefghijkl');
    await form.locator('input[name="current_password"]').fill('CurrentPass1!');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.locator('[data-password-status]')).toHaveText('Password needs: an uppercase letter.');

    await next.fill(email);
    await form.locator('input[name="confirm_password"]').fill(email);
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
    });
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
