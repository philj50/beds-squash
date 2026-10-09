import { expect, test, type Page, type Route } from '@playwright/test';

/** Private pages need an active account, an email, and a role. Supabase is stubbed. */

const SUPABASE = 'https://klxyjmwiaivvqjbhxzak.supabase.co';

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

function send(route: Route, payload: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'beds_cookies', value: 'essential', url: baseURL! }]);
});

async function signIn(
  page: Page,
  options: {
    id: string;
    email: string;
    name: string;
    active?: boolean;
    admin?: boolean;
    group?: string | null;
    membership?: boolean;
  },
) {
  const session = sessionFor(options.id, options.email, options.name);
  const calls: string[] = [];
  await page.addInitScript((stored) => {
    localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
  }, session);
  await page.route(`${SUPABASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/rpc/record_my_sign_in')) {
      calls.push('record_my_sign_in');
      await send(route, null);
      return;
    }
    if (path.endsWith('/rpc/my_account_status')) {
      await send(route, { active: options.active !== false, has_email: true });
      return;
    }
    if (path.startsWith('/auth/v1/')) {
      await send(route, path.endsWith('/user') ? session.user : session);
      return;
    }
    if (path.endsWith('/profiles')) {
      const row = { id: options.id, display_name: options.name, email: options.email, is_admin: Boolean(options.admin) };
      const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json') || url.searchParams.get('select') === 'is_admin';
      await send(route, single ? row : [row]);
      return;
    }
    if (path.endsWith('/group_members')) {
      const row = options.group
        ? [{ profile_id: options.id, person_name: options.name, place: 'Test Club / Test Team 1', group_slug: options.group, groups: { name: options.group, position: 4, roles: { name: 'LM Player' } } }]
        : [];
      const single = (route.request().headers().accept ?? '').includes('application/vnd.pgrst.object+json');
      await send(route, single ? row[0] ?? null : row);
      return;
    }
    if (path.endsWith('/memberships')) {
      await send(
        route,
        options.membership ? [{ role: 'team_player', club_slug: null, team_id: 5, teams: { name: 'Test Team 1' } }] : [],
      );
      return;
    }
    await send(route, []);
  });
  return calls;
}

test('an inactive account cannot open Your squash', async ({ page }) => {
  const calls = await signIn(page, {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'pat.player@example.test',
    name: 'Pat Player',
    active: false,
    group: 'lm_players',
  });
  await page.goto('captains/you/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('This account is inactive.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next matches' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  expect(calls).not.toContain('record_my_sign_in');
});

test('a login without an email cannot open Matches', async ({ page }) => {
  await signIn(page, {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'p-abcdefgh@players.invalid',
    name: 'Pat Player',
    membership: true,
  });
  await page.goto('captains/matches/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('This account needs an email address')).toBeVisible();
  await expect(page.locator('[data-layout]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('a login with no role cannot open the squad', async ({ page }) => {
  await signIn(page, {
    id: '55555555-5555-4555-8555-555555555555',
    email: 'visitor@example.test',
    name: 'Visitor',
  });
  await page.goto('captains/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('This account does not have a role for this.')).toBeVisible();
  await expect(page.locator('[data-squads]')).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('using Your squash records activity after the password sign-in', async ({ page }) => {
  const calls = await signIn(page, {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'pat.player@example.test',
    name: 'Pat Player',
    group: 'lm_players',
  });
  await page.goto('captains/you/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Next matches' })).toBeVisible();
  await expect.poll(() => calls.includes('record_my_sign_in')).toBe(true);
});

test('an inactive admin cannot open Users', async ({ page }) => {
  await signIn(page, {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'admin@example.test',
    name: 'Ada Admin',
    admin: true,
    active: false,
    group: 'admins',
  });
  await page.goto('captains/admin/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('This account is inactive.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});
