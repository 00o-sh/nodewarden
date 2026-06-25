import { expect, test } from '@playwright/test';
import { login, selectVaultItem, vaultRow } from './helpers';

// Critical vault journeys exercised in a real browser against the demo build:
// seeing seeded items, searching, viewing detail (reveal + copy), and full
// create / edit / delete CRUD. Each test logs in fresh for a clean vault.

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('vault lists multiple seeded items', async ({ page }) => {
  // Several known demo ciphers should all be present in the active vault.
  for (const name of ['GitHub', 'Google Workspace', 'Cloudflare Dashboard', 'Microsoft 365']) {
    await expect(vaultRow(page, name).first()).toBeVisible();
  }
});

test('search narrows the list to a matching item', async ({ page }) => {
  const search = page.getByPlaceholder(/search within/i);
  await search.fill('Cloudflare');
  // The matching item stays; a non-matching seeded item is filtered out.
  await expect(vaultRow(page, 'Cloudflare Dashboard').first()).toBeVisible();
  await expect(vaultRow(page, 'GitHub')).toHaveCount(0);
});

test('selecting an item shows its detail, and password reveals + copies', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await selectVaultItem(page, 'GitHub');

  // Login credentials section renders with the seeded username.
  await expect(page.getByText('Login Credentials')).toBeVisible();
  await expect(page.getByText('demo@nodewarden.app').first()).toBeVisible();

  // Password starts masked; Reveal shows the real value.
  await expect(page.getByText('correct-horse-battery-staple')).toHaveCount(0);
  await page.getByRole('button', { name: /^reveal$/i }).first().click();
  await expect(page.getByText('correct-horse-battery-staple')).toBeVisible();

  // Copy the password and assert it landed on the clipboard.
  const passwordRow = page.locator('.kv-row', { hasText: 'Password' });
  await passwordRow.getByRole('button', { name: /^copy$/i }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('correct-horse-battery-staple');
});

test('create a new login item via the editor', async ({ page }) => {
  // Open the desktop create menu and pick "Login".
  await page.locator('.desktop-create-trigger').click();
  await page.locator('.create-menu').getByRole('button', { name: 'Login' }).click();

  // The editor opens with a Name field (required) plus Username/Password.
  await page.locator('.field', { hasText: 'Name' }).first().locator('input').fill('E2E New Login');
  await page.locator('.field', { hasText: 'Username' }).locator('input').fill('e2e-user@example.com');
  await page.locator('.field', { hasText: 'Password' }).first().locator('input').fill('e2e-secret-pw');

  await page.getByRole('button', { name: /^confirm$/i }).click();

  // The new item appears in the list.
  await expect(vaultRow(page, 'E2E New Login').first()).toBeVisible({ timeout: 10_000 });
});

test('edit an existing item changes its name', async ({ page }) => {
  await selectVaultItem(page, 'Netflix');
  await page.locator('.detail-actions').getByRole('button', { name: /^edit$/i }).click();

  const nameInput = page.locator('.field', { hasText: 'Name' }).first().locator('input');
  await expect(nameInput).toHaveValue('Netflix');
  await nameInput.fill('Netflix Renamed');
  await page.getByRole('button', { name: /^confirm$/i }).click();

  // The rename shows in both the list and the detail title.
  await expect(vaultRow(page, 'Netflix Renamed').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.detail-title', { hasText: 'Netflix Renamed' }).first()).toBeVisible();
});

test('deleting (trashing) an item removes it from the active list', async ({ page }) => {
  await selectVaultItem(page, 'Amazon');

  // The detail "Delete" button opens a confirm dialog; confirm via the dialog.
  await page.locator('.detail-actions').getByRole('button', { name: /^delete$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-dialog-confirm]').click();

  // It leaves the active vault (it moved to trash).
  await expect(vaultRow(page, 'Amazon')).toHaveCount(0, { timeout: 10_000 });
});
