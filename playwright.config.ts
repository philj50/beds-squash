import { defineConfig, devices } from '@playwright/test';

const port = 4322;
const basePath = process.env.SITE_BASE?.replace(/\/+$/, '') || '/beds-squash';
const baseURL = `${(process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}${basePath}`).replace(/\/+$/, '')}/`;
const useLocalPreview =
  !process.env.PLAYWRIGHT_BASE_URL || /127\.0\.0\.1|localhost/i.test(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    navigationTimeout: 60_000,
  },
  expect: {
    timeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: useLocalPreview
    ? {
        command: `npm run build && npx astro preview --host 127.0.0.1 --port ${port}`,
        url: `${baseURL}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : undefined,
});
