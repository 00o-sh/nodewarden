import { expect, test } from '@playwright/test';
import { login, selectVaultItem, vaultRow } from './helpers';

// Vault management journeys beyond basic CRUD: copying credentials, reveal/hide,
// live TOTP, folder rename/delete, bulk archive, single archive + the archive
// filter, and restoring from trash. Demo mode persists these mutations in-memory
// for the page, and each test logs in fresh for a clean vault.

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('copy the username from an item detail', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await selectVaultItem(page, 'GitHub');

  const usernameRow = page.locator('.kv-row', { hasText: 'Username' });
  await usernameRow.getByRole('button', { name: /^copy$/i }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('demo@nodewarden.app');
});

test('reveal then hide the password toggle in detail', async ({ page }) => {
  await selectVaultItem(page, 'GitHub');

  // Starts masked.
  await expect(page.getByText('correct-horse-battery-staple')).toHaveCount(0);
  // Reveal shows the value and flips the button to Hide.
  await page.getByRole('button', { name: /^reveal$/i }).first().click();
  await expect(page.getByText('correct-horse-battery-staple')).toBeVisible();
  // Hide masks it again.
  await page.getByRole('button', { name: /^hide$/i }).first().click();
  await expect(page.getByText('correct-horse-battery-staple')).toHaveCount(0);
});

test('TOTP code renders and can be copied from detail', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await selectVaultItem(page, 'GitHub');

  // The TOTP row shows a 6-digit code (rendered as "123 456").
  const totpRow = page.locator('.kv-row', { hasText: 'TOTP' });
  await expect(totpRow.locator('.totp-inline strong')).toHaveText(/\d{3}\s?\d{3}/, { timeout: 10_000 });
  await totpRow.getByRole('button', { name: /^copy$/i }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/^\d{6}$/);
});

test('create, rename, then delete a folder', async ({ page }) => {
  // Create.
  await page.locator('.folder-add-btn').click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('input').fill('Lifecycle Folder');
  await dialog.locator('[data-dialog-confirm]').click();
  const folderRow = page.locator('.sidebar .folder-row', { hasText: 'Lifecycle Folder' });
  await expect(folderRow).toBeVisible({ timeout: 10_000 });

  // Rename via the folder row pencil button.
  await folderRow.locator('.folder-edit-btn').click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const renameInput = dialog.locator('input');
  await renameInput.fill('Renamed Folder');
  await dialog.locator('[data-dialog-confirm]').click();
  await expect(page.locator('.sidebar .folder-row', { hasText: 'Renamed Folder' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.sidebar .folder-row', { hasText: 'Lifecycle Folder' })).toHaveCount(0);

  // Delete via the folder row X button.
  await page.locator('.sidebar .folder-row', { hasText: 'Renamed Folder' }).locator('.folder-delete-btn').last().click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-dialog-confirm]').click();
  await expect(page.locator('.sidebar .folder-row', { hasText: 'Renamed Folder' })).toHaveCount(0, { timeout: 10_000 });
});

test('bulk-select multiple items and archive them', async ({ page }) => {
  // Tick two seeded rows' checkboxes to enter selection mode.
  await vaultRow(page, 'Netflix').first().locator('.row-check').check();
  await vaultRow(page, 'Amazon').first().locator('.row-check').check();

  // The selection toolbar exposes "Archive" (archive selected).
  await page.locator('.list-head.selection-mode').getByRole('button', { name: /^archive$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-dialog-confirm]').click();

  // Both leave the active list (now archived).
  await expect(vaultRow(page, 'Netflix')).toHaveCount(0, { timeout: 10_000 });
  await expect(vaultRow(page, 'Amazon')).toHaveCount(0);

  // They appear under the Archive filter.
  await page.locator('.sidebar .tree-btn', { hasText: 'Archive' }).click();
  await expect(vaultRow(page, 'Netflix').first()).toBeVisible();
  await expect(vaultRow(page, 'Amazon').first()).toBeVisible();
});

test('archive a single item then unarchive it from the archive view', async ({ page }) => {
  await selectVaultItem(page, 'Microsoft 365');
  // The detail action archives via a confirm dialog.
  await page.locator('.detail-actions').getByRole('button', { name: /^archive$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-dialog-confirm]').click();
  await expect(vaultRow(page, 'Microsoft 365')).toHaveCount(0, { timeout: 10_000 });

  // View the archive filter; the item is there and is marked Archived.
  await page.locator('.sidebar .tree-btn', { hasText: 'Archive' }).click();
  await selectVaultItem(page, 'Microsoft 365');
  await expect(page.locator('.archive-badge')).toBeVisible();

  // Unarchive it from detail, and it returns to the active vault.
  await page.locator('.detail-actions').getByRole('button', { name: /^unarchive$/i }).click();
  await expect(vaultRow(page, 'Microsoft 365')).toHaveCount(0, { timeout: 10_000 });
  await page.locator('.sidebar .tree-btn', { hasText: 'All Items' }).click();
  await expect(vaultRow(page, 'Microsoft 365').first()).toBeVisible();
});

test('restore an item from trash', async ({ page }) => {
  // Amazon is a plain (non-reprompt) login; trash it then restore it.
  await selectVaultItem(page, 'Amazon');
  await page.locator('.detail-actions').getByRole('button', { name: /^delete$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-dialog-confirm]').click();
  await expect(vaultRow(page, 'Amazon')).toHaveCount(0, { timeout: 10_000 });

  // Open the Trash filter, select the item, and restore it from detail.
  await page.locator('.sidebar .tree-btn', { hasText: 'Trash' }).click();
  await selectVaultItem(page, 'Amazon');
  await page.locator('.detail-actions').getByRole('button', { name: /^restore$/i }).click();
  await expect(vaultRow(page, 'Amazon')).toHaveCount(0, { timeout: 10_000 });

  // Back in the active vault it is present again.
  await page.locator('.sidebar .tree-btn', { hasText: 'All Items' }).click();
  await expect(vaultRow(page, 'Amazon').first()).toBeVisible();
});

test('the TOTP codes page lists verification codes', async ({ page }) => {
  await page.getByRole('link', { name: 'Verification Code' }).first().click();
  await expect(page).toHaveURL(/\/vault\/totp/);
  await expect(page.getByRole('heading', { name: 'Verification Code' })).toBeVisible();

  // Several seeded ciphers carry a TOTP secret, so code rows render with codes.
  const rows = page.locator('.totp-code-row');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  expect(await rows.count()).toBeGreaterThan(1);
  await expect(page.locator('.totp-code-row', { hasText: 'GitHub' }).first().locator('.totp-code-main strong'))
    .toHaveText(/\d{3}\s?\d{3}/, { timeout: 10_000 });
});
