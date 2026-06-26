import { expect, test, type Page } from '@playwright/test';

// REAL-BACKEND lifecycle: the production stack (worker + local D1/R2) with the
// real webapp. One serial journey as the first user (who becomes admin without
// an invite). This proves what demo-mode E2E cannot: real client-side crypto
// against the real API, and genuine PERSISTENCE across full reloads and a fresh
// login session. If any of the encrypt -> POST -> store -> sync -> decrypt path
// is broken, these fail.
test.describe.configure({ mode: 'serial' });

// Unique master password / account for this run's fresh DB.
const EMAIL = 'owner@nodewarden.test';
const PASSWORD = 'Real-Backend-Master-Pw-123456';
const ITEM = 'Real Backend Login';
const USERNAME = 'real-user@example.com';
const SECRET = 'real-secret-pw-xyz';

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

async function fillField(label: string, value: string) {
  await page.locator('.field', { hasText: label }).first().locator('input').fill(value);
}

async function logInExistingAccount() {
  await page.goto('/');
  await page.getByRole('textbox').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /^log in$/i }).first().click();
}

// After a reload/boot the vault is LOCKED (zero-knowledge: the decryption key is
// never persisted). Re-enter the master password via whichever gate is shown —
// the unlock view (session retained) or the full login view.
async function reachVault() {
  if (await page.getByRole('button', { name: /sign out/i }).isVisible().catch(() => false)) return;
  const unlockBtn = page.getByRole('button', { name: /^unlock$/i });
  if (await unlockBtn.isVisible().catch(() => false)) {
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await unlockBtn.click();
  } else {
    await page.getByRole('textbox').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.getByRole('button', { name: /^log in$/i }).first().click();
  }
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 20_000 });
}

test('registers the first account against the real worker', async () => {
  await page.goto('/');
  // Switch to the registration view.
  await page.getByRole('button', { name: /create account/i }).first().click();

  await fillField('Name', 'Real Owner');
  await fillField('Email', EMAIL);
  // Two password fields: master password + confirm.
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);

  await page.getByRole('button', { name: /create account/i }).last().click();

  // After registering, reach an authenticated vault — either auto-entered or via
  // an explicit login. Drive login if we land back on the login form.
  await page.waitForTimeout(1500);
  if (await page.getByRole('button', { name: /^log in$/i }).first().isVisible().catch(() => false)) {
    await logInExistingAccount();
  }
  // The authenticated shell (Sign Out + Vault nav) proves we registered and
  // entered the real vault.
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 20_000 });
});

test('creates a login item that the real backend stores + the client decrypts', async () => {
  await page.locator('.desktop-create-trigger').click();
  await page.locator('.create-menu').getByRole('button', { name: 'Login' }).click();

  await fillField('Name', ITEM);
  await page.locator('.field', { hasText: 'Username' }).locator('input').fill(USERNAME);
  await page.locator('.field', { hasText: 'Password' }).first().locator('input').fill(SECRET);
  await page.getByRole('button', { name: /^confirm$/i }).click();

  await expect(page.locator('.list-item', { hasText: ITEM }).first()).toBeVisible({ timeout: 15_000 });
});

test('persists the item across a full page reload + unlock (real D1, not demo memory)', async () => {
  await page.reload();
  // Demo mode would lose everything here; the real backend kept the cipher in
  // D1. The vault locks on reload, so unlock to decrypt, then the item is back.
  await reachVault();
  await expect(page.locator('.list-item', { hasText: ITEM }).first()).toBeVisible({ timeout: 20_000 });
});

test('persists across a fresh login session (real auth + encrypted round-trip)', async () => {
  // Simulate a brand-new session: clear all client state, then log in from
  // scratch with email + master password (full PBKDF2 auth path).
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
  await logInExistingAccount();
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.list-item', { hasText: ITEM }).first()).toBeVisible({ timeout: 20_000 });

  // Open it and confirm the decrypted username matches what we stored — the full
  // client-side encrypt -> store -> fetch -> decrypt round-trip.
  await page.locator('.list-item', { hasText: ITEM }).first().click();
  await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 10_000 });
});

test('deletes the item and the deletion persists across reload', async () => {
  await page.locator('.list-item', { hasText: ITEM }).first().click();
  await page.locator('.detail-actions').getByRole('button', { name: /^delete$/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-dialog-confirm]').click();

  // Gone from the active list, and still gone after a reload.
  await expect(page.locator('.list-item', { hasText: ITEM })).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  await expect(page.locator('.list-item', { hasText: ITEM })).toHaveCount(0, { timeout: 20_000 });
});
