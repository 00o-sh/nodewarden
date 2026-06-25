import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Import and Settings journeys: the Import/Export page renders and a format can
// be chosen from the source list; the Settings page renders and the language
// selector offers multiple locales.

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('Import page renders and a source format can be selected', async ({ page }) => {
  await page.getByRole('link', { name: 'Import & Export' }).first().click();
  await expect(page).toHaveURL(/import/);
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();

  // The import source list is a combobox; switch it to a different format and
  // assert the selection takes effect.
  const formatSelect = page.locator('.import-export-panel').first().getByRole('combobox').first();
  await expect(formatSelect).toBeVisible();
  const options = await formatSelect.locator('option:not([disabled])').allInnerTexts();
  expect(options.length).toBeGreaterThan(1);

  // Pick the second available (non-default) source by its index.
  const targetValue = await formatSelect.locator('option:not([disabled])').nth(1).getAttribute('value');
  await formatSelect.selectOption(targetValue);
  await expect(formatSelect).toHaveValue(targetValue as string);
});

test('Settings renders the language selector with multiple locales', async ({ page }) => {
  await page.getByRole('link', { name: 'Account Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/account/);
  await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible();

  // The language module exposes a select with more than one locale option.
  const languageSelect = page
    .locator('.settings-module', { hasText: 'Language' })
    .getByRole('combobox');
  await expect(languageSelect).toBeVisible();
  const localeCount = await languageSelect.locator('option').count();
  expect(localeCount).toBeGreaterThan(1);
});
