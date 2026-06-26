import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Sends (file + text with options, delete) and the Import flow driven through a
// real file upload. Demo mode persists send mutations in-memory and stubs the
// import handler to return a summary, so the full import journey completes.

test.beforeEach(async ({ page }) => {
  await login(page);
});

function sendRow(page: import('@playwright/test').Page, name: string) {
  return page.locator('.list-item', { hasText: name });
}

test('create a FILE send that appears in the list', async ({ page }) => {
  await page.getByRole('link', { name: 'Sends' }).first().click();
  await expect(page).toHaveURL(/\/sends/);

  await page.getByRole('button', { name: 'Add' }).first().click();
  await expect(page.getByRole('heading', { name: 'New Send' })).toBeVisible();

  // Switch the type radio to "File" and attach a file.
  await page.locator('.send-options').getByText('File', { exact: true }).click();
  await page.locator('.field', { hasText: 'Name' }).first().locator('input').fill('E2E File Send');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'handoff.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('demo file send contents'),
  });

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(sendRow(page, 'E2E File Send').first()).toBeVisible({ timeout: 10_000 });
});

test('create a text send with deletion + max-access options', async ({ page }) => {
  await page.getByRole('link', { name: 'Sends' }).first().click();
  await expect(page).toHaveURL(/\/sends/);

  await page.getByRole('button', { name: 'Add' }).first().click();
  await expect(page.getByRole('heading', { name: 'New Send' })).toBeVisible();

  await page.locator('.field', { hasText: 'Name' }).first().locator('input').fill('E2E Options Send');
  await page.locator('.field').filter({ has: page.locator('textarea') }).first().locator('textarea')
    .fill('Send with custom options.');
  // Tweak deletion days and max access count.
  await page.locator('.field', { hasText: 'Deletion' }).locator('input').fill('3');
  await page.locator('.field', { hasText: 'Max Access Count' }).locator('input').fill('5');
  // Toggle "Disable this Send".
  await page.locator('.send-options').getByText('Disable this Send').click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(sendRow(page, 'E2E Options Send').first()).toBeVisible({ timeout: 10_000 });

  // Reopen it and confirm the detail pane shows the saved name + access count.
  await sendRow(page, 'E2E Options Send').first().click();
  await expect(page.locator('.detail-title', { hasText: 'E2E Options Send' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Send Details' })).toBeVisible();
});

test('delete a seeded send removes it from the list', async ({ page }) => {
  await page.getByRole('link', { name: 'Sends' }).first().click();
  await expect(page).toHaveURL(/\/sends/);

  // Select the seeded text send and delete it from its detail pane.
  await sendRow(page, 'Onboarding note').first().click();
  await expect(page.locator('.detail-title', { hasText: 'Onboarding note' }).first()).toBeVisible();
  await page.locator('.detail-delete-btn').click();

  await expect(sendRow(page, 'Onboarding note')).toHaveCount(0, { timeout: 10_000 });
});

test('import a NodeWarden JSON fixture completes with a summary', async ({ page }) => {
  await page.getByRole('link', { name: 'Import & Export' }).first().click();
  await expect(page).toHaveURL(/import/);
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();

  // Choose the NodeWarden (json) source by value.
  const importPanel = page.locator('.import-export-panel', { hasText: 'Import' }).first();
  await importPanel.locator('select').first().selectOption('nodewarden_json');

  // Upload a minimal valid Bitwarden/NodeWarden export payload.
  const fixture = JSON.stringify({ encrypted: false, folders: [], items: [] });
  await importPanel.locator('input[type="file"]').setInputFiles({
    name: 'nodewarden-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixture),
  });

  await importPanel.getByRole('button', { name: 'Import', exact: true }).click();

  // The demo import handler resolves and the summary dialog appears.
  const summary = page.getByRole('dialog', { name: 'Import successful' });
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await summary.getByRole('button', { name: /^confirm$/i }).click();
  await expect(summary).toHaveCount(0);
});
