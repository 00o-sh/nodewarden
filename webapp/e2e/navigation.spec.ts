import { expect, test } from '@playwright/test';
import { login, vaultRow } from './helpers';

// Folder filtering, folder creation, top-level navigation between pages, admin,
// settings, theme toggle and lock/logout — the "can the user move around the
// app and reach every area" journeys.

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('folder filter narrows the list to that folder', async ({ page }) => {
  // The "Personal" folder holds Netflix/Amazon/PayPal but not GitHub (Work).
  await page.locator('.sidebar .tree-btn', { hasText: 'Personal' }).click();
  await expect(vaultRow(page, 'Netflix').first()).toBeVisible();
  await expect(vaultRow(page, 'GitHub')).toHaveCount(0);
});

test('the favorites filter narrows the list to favorited items', async ({ page }) => {
  await page.locator('.sidebar .tree-btn', { hasText: 'Favorites' }).click();
  // GitHub is a seeded favorite; the non-favorite Microsoft 365 is hidden.
  await expect(vaultRow(page, 'GitHub').first()).toBeVisible();
  await expect(vaultRow(page, 'Microsoft 365')).toHaveCount(0);
});

test('creating a folder adds it to the sidebar', async ({ page }) => {
  await page.locator('.folder-add-btn').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input').fill('E2E Folder');
  await dialog.locator('[data-dialog-confirm]').click();

  await expect(page.locator('.sidebar .tree-btn', { hasText: 'E2E Folder' })).toBeVisible({ timeout: 10_000 });
});

test('navigates to Settings which renders account settings', async ({ page }) => {
  await page.getByRole('link', { name: 'Account Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/account/);
  // The settings page renders its known modules.
  await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /session timeout/i })).toBeVisible();
});

test('navigates to Admin which renders users and invites', async ({ page }) => {
  // Demo user is an admin, so the Admin Panel nav link is present.
  await page.getByRole('link', { name: 'Admin Panel' }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invites' })).toBeVisible();
  // Seeded admin data renders in the tables.
  await expect(page.getByText('viewer@example.com')).toBeVisible();
  await expect(page.getByText('DEMO-INVITE-2026')).toBeVisible();
});

test('toggling the theme switch updates the document theme', async ({ page }) => {
  const root = page.locator('html');
  const before = await root.getAttribute('data-theme');
  // Toggle via the header theme switch label (the input is visually covered).
  await page.locator('.theme-switch').first().click();
  await expect
    .poll(async () => root.getAttribute('data-theme'))
    .not.toBe(before);
});

test('Lock returns the user to the unlock screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Lock' }).first().click();
  // The standalone unlock screen shows the unlock action.
  await expect(page.getByRole('button', { name: /^unlock$/i }).first()).toBeVisible({ timeout: 10_000 });
});

test('Sign Out returns the user to the login screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign Out' }).first().click();
  // Sign Out asks for confirmation; confirm in the dialog.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-dialog-confirm]').click();
  // Back on the login form: the Log In submit button is shown again.
  await expect(page.getByRole('button', { name: /^log in$/i }).first()).toBeVisible({ timeout: 10_000 });
});
