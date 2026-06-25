import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke tests run against the DEMO build of the webapp, which stubs
// out the backend (any credentials unlock a fixed demo vault). This keeps E2E
// deterministic and network-free while still exercising the real, fully
// wired-together Preact app — routing, auth screens, vault rendering — in a
// real browser. Critical user journeys live in webapp/e2e/.
//
// Chromium is pre-installed in the execution environment; PLAYWRIGHT_BROWSERS_PATH
// points Playwright at it, so no `playwright install` is needed.
const PORT = 5174;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './webapp/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Allow pointing at a pre-installed Chromium (e.g. a managed execution
    // environment) instead of Playwright's bundled build. Unset in standard CI,
    // where `npx playwright install chromium` provides the matching browser.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev:demo',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
