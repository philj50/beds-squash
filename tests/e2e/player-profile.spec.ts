import { expect, test, type Page, type Route } from '@playwright/test';

/** A player profile opens only after sign-in. Supabase is stubbed. */

const SUPABASE = 'https://klxyjmwiaivvqjbhxzak.supabase.co';

function jwt(payload: Record<string, unknown>) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.simulated`;
}

function send(route: Route, payload: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'beds_cookies', value: 'essential', url: baseURL! }]);
});

async function signIn(page: Page) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const session = {
    access_token: jwt({ sub: '33333333-3333-4333-8333-333333333333', email: 'pat.player@example.test', role: 'authenticated', exp: expiresAt }),
    refresh_token: 'simulated-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id: '33333333-3333-4333-8333-333333333333',
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
  await page.addInitScript((stored) => {
    localStorage.setItem('sb-klxyjmwiaivvqjbhxzak-auth-token', JSON.stringify(stored));
  }, session);
  await page.route(`${SUPABASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.startsWith('/auth/v1/')) {
      await send(route, path.endsWith('/user') ? session.user : session);
      return;
    }
    if (path.endsWith('/squashlevels_players')) {
      await send(route, [{ id: 90, display_name: 'Gbenga Adeyi', current_level: 4321, updated_at: '2026-09-01' }]);
      return;
    }
    if (path.endsWith('/squashlevels_ratings')) {
      await send(route, [{ recorded_on: '2026-09-01', level: 4321 }]);
      return;
    }
    if (path.endsWith('/rubbers')) {
      await send(route, [
        {
          home_player: 'Gbenga Adeyi',
          away_player: 'Pat Player',
          score: '3-0',
          fixtures: { starts_at: '2026-02-02T18:00:00.000Z' },
        },
      ]);
      return;
    }
    await send(route, []);
  });
}

test('a signed-out visitor is asked to log in before a profile opens', async ({ page }) => {
  await page.goto('players/#Gbenga%20Adeyi', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gbenga Adeyi');
  await expect(page.getByText("Sign in to see this player's profile.")).toBeVisible();
  await expect(page.locator('[data-open]')).toBeHidden();
  await expect(page.locator('[data-login-link]')).toHaveAttribute('href', /\/login\/\?next=.*players/);
});

test('the draw keeps the sign-in note until there is a login', async ({ page }) => {
  await page.goto('events/2026-01-beds-closed/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.draw-note')).toBeVisible();
  await expect(page.locator('.draw-note')).toContainText("Sign in to open a player's profile.");
  const profile = page.locator('.champion a').first();
  await expect(profile).toHaveAttribute('href', /\/players\/#/);
});

test('a signed-in player sees the profile and the draw note is gone', async ({ page }) => {
  await signIn(page);
  await page.goto('players/#Gbenga%20Adeyi', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-locked]')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'County Closed' })).toBeVisible();
  await expect(page.locator('[data-closed]')).toContainText('Steven Davies');
  await expect(page.locator('[data-level]')).toContainText('4,321');
  await expect(page.locator('[data-league]')).toContainText('Pat Player');
  await expect(page.locator('[data-league]')).toContainText('3-0');

  await page.goto('events/2026-01-beds-closed/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.draw-note')).toBeHidden();
});
