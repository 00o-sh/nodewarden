import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Sends journeys: navigating to the Sends area, seeing seeded sends, and
// creating a new text Send that then appears in the list.

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('navigates to Sends and shows seeded sends', async ({ page }) => {
  await page.getByRole('link', { name: 'Sends' }).first().click();
  await expect(page).toHaveURL(/\/sends/);
  // Seeded demo sends render in the list.
  await expect(page.locator('.list-item', { hasText: 'Onboarding note' }).first()).toBeVisible();
  await expect(page.locator('.list-item', { hasText: 'Design handoff.zip' }).first()).toBeVisible();
});

test('creates a text Send that appears in the list', async ({ page }) => {
  await page.getByRole('link', { name: 'Sends' }).first().click();
  await expect(page).toHaveURL(/\/sends/);

  // Open the create form via the Add button.
  await page.getByRole('button', { name: 'Add' }).first().click();
  await expect(page.getByRole('heading', { name: 'New Send' })).toBeVisible();

  // New Sends default to type "text"; fill the required name + text and save.
  await page.locator('.field', { hasText: 'Name' }).first().locator('input').fill('E2E Text Send');
  await page.locator('.field').filter({ has: page.locator('textarea') }).first().locator('textarea').fill('Hello from the E2E suite.');
  await page.getByRole('button', { name: 'Save' }).click();

  // It shows up as a new row in the sends list.
  await expect(page.locator('.list-item', { hasText: 'E2E Text Send' }).first()).toBeVisible({ timeout: 10_000 });
});
