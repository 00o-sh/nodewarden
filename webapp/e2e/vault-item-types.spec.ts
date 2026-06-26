import { expect, test } from '@playwright/test';
import { login, selectVaultItem, vaultRow } from './helpers';

// Creating every non-login cipher type through the real editor, adding a custom
// field, and viewing the seeded Card / Identity / Note / SSH items in detail.
// Demo mode wires onCreateVaultItem to persist the draft in-memory, so each new
// item shows up in the list and its detail pane. Each test logs in fresh.

test.beforeEach(async ({ page }) => {
  await login(page);
});

// Open the desktop create menu and pick a type by its menu label.
async function startCreate(page: import('@playwright/test').Page, typeLabel: string) {
  await page.locator('.desktop-create-trigger').click();
  await page.locator('.create-menu').getByRole('button', { name: typeLabel }).click();
  // The editor card renders with a Name field.
  await expect(page.locator('.field', { hasText: 'Name' }).first().locator('input')).toBeVisible();
}

test('create a Card item and view its details', async ({ page }) => {
  await startCreate(page, 'Card');

  await page.locator('.field', { hasText: 'Name' }).first().locator('input').fill('E2E Travel Card');
  await page.locator('.field', { hasText: 'Cardholder Name' }).locator('input').fill('E2E Holder');
  await page.locator('.field', { hasText: 'Number' }).locator('input').fill('4242424242424242');
  await page.locator('.field', { hasText: 'Security Code (CVV)' }).locator('input').fill('321');

  await page.getByRole('button', { name: /^confirm$/i }).click();

  // The new card appears in the list and its detail shows the card section.
  await vaultRow(page, 'E2E Travel Card').first().click();
  await expect(page.locator('.detail-title', { hasText: 'E2E Travel Card' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Card Details' })).toBeVisible();
  await expect(page.getByText('E2E Holder')).toBeVisible();
});

test('create an Identity item and view its details', async ({ page }) => {
  await startCreate(page, 'Identity');

  await page.locator('.field', { hasText: 'Name' }).first().locator('input').fill('E2E Person Identity');
  await page.locator('.field', { hasText: 'First Name' }).locator('input').fill('Robin');
  await page.locator('.field', { hasText: 'Last Name' }).locator('input').fill('Banks');

  await page.getByRole('button', { name: /^confirm$/i }).click();

  await vaultRow(page, 'E2E Person Identity').first().click();
  await expect(page.locator('.detail-title', { hasText: 'E2E Person Identity' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Identity Details' })).toBeVisible();
  await expect(page.getByText('Robin Banks')).toBeVisible();
});

test('create a secure Note item and view its details', async ({ page }) => {
  await startCreate(page, 'Note');

  await page.locator('.field', { hasText: 'Name' }).first().locator('input').fill('E2E Secret Note');
  await page.locator('.field', { hasText: 'Notes' }).locator('textarea').fill('Remember to rotate the demo keys.');

  await page.getByRole('button', { name: /^confirm$/i }).click();

  await vaultRow(page, 'E2E Secret Note').first().click();
  await expect(page.locator('.detail-title', { hasText: 'E2E Secret Note' }).first()).toBeVisible();
  await expect(page.getByText('Remember to rotate the demo keys.')).toBeVisible();
});

test('add a custom field to a new login and see it in detail', async ({ page }) => {
  await startCreate(page, 'Login');

  await page.locator('.field', { hasText: 'Name' }).first().locator('input').fill('E2E Custom Field Login');

  // Custom fields are added through the "Add Field" modal.
  await page.getByRole('button', { name: /^add field$/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.field', { hasText: 'Field Label' }).locator('input').fill('License Key');
  await dialog.locator('.field', { hasText: 'Field Value' }).locator('textarea').fill('ABCD-1234-EFGH');
  await dialog.locator('[data-dialog-confirm]').click();

  // The field now shows inline in the editor before saving. Its label lives in
  // an input value (not text), so assert on the input value.
  await expect(
    page.locator('.custom-field-card .custom-field-label input').first()
  ).toHaveValue('License Key');

  await page.getByRole('button', { name: /^confirm$/i }).click();

  // In the saved item's detail the custom field renders under Custom Fields.
  await vaultRow(page, 'E2E Custom Field Login').first().click();
  await expect(page.getByRole('heading', { name: 'Custom Fields' })).toBeVisible();
  await expect(page.locator('.custom-field-label', { hasText: 'License Key' })).toBeVisible();
  await expect(page.getByText('ABCD-1234-EFGH')).toBeVisible();
});

test('seeded Card / Identity / Note / SSH items render their type detail', async ({ page }) => {
  // Company Visa is a seeded card cipher.
  await selectVaultItem(page, 'Company Visa');
  await expect(page.getByRole('heading', { name: 'Card Details' })).toBeVisible();

  // Travel Identity is a seeded identity cipher.
  await selectVaultItem(page, 'Travel Identity');
  await expect(page.getByRole('heading', { name: 'Identity Details' })).toBeVisible();

  // Release checklist is a seeded secure note.
  await selectVaultItem(page, 'Release checklist');
  await expect(page.getByText('Review build, dry-run deploy, and release notes before shipping.')).toBeVisible();

  // Production SSH key is a seeded SSH cipher with a reveal-able private key.
  await selectVaultItem(page, 'Production SSH key');
  await expect(page.getByRole('heading', { name: 'SSH Key', exact: true })).toBeVisible();
});
