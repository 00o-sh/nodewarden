import { defineConfig, devices } from '@playwright/test';

// REAL-BACKEND E2E. Unlike playwright.config.ts (demo mode, stubbed backend),
// this drives the production stack: the actual worker (src/) serving the built
// webapp + API on one origin, backed by a real local D1/R2. It proves the true
// UI -> API -> storage path, including PERSISTENCE across reloads/sessions —
// the integration that demo mode cannot exercise. This is the strongest signal
// behind "green == safe to merge".
const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './webapp/e2e-real',
  // Real-backend journeys mutate one shared instance; keep them serial &
  // single-worker for determinism.
  fullyParallel: false,
  workers: 1,
  // Real client-side PBKDF2 (600k iters) + RSA keygen in-browser are genuinely
  // slow; give each step room so timeouts mean "broken", not "slow crypto".
  timeout: 90_000,
  forbidOnly: isCI,
  // Fail-closed: a flake must BLOCK (turn the gate red), never pass on retry.
  retries: 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bash scripts/e2e-real-server.sh',
    url: `${BASE_URL}/config`,
    // Always start a fresh-state server so registration/persistence assertions
    // are deterministic.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
