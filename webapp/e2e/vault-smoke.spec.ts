import { expect, test } from '@playwright/test';

// Demo mode: any credentials unlock a fixed in-memory vault. These smoke tests
// assert the app boots, the auth screen wires up, and a login lands the user in
// a populated vault — the critical "can a user actually get in and see their
// items" journey, exercised in a real browser against the fully built app.

test('boots and renders the login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/NodeWarden/i);
  // The login form is present (email field + a primary submit button).
  await expect(page.getByRole('button', { name: /log in/i }).first()).toBeVisible();
});

test('logging in reveals the demo vault contents', async ({ page }) => {
  await page.goto('/');

  // Fill the email + master password fields. In demo mode any value works.
  await page.getByRole('textbox').first().fill('demo@nodewarden.app');
  await page.locator('input[type="password"]').first().fill('demo-password');

  await page.getByRole('button', { name: /^log in$/i }).first().click();

  // A known demo cipher should be listed once the vault loads.
  await expect(page.getByText('GitHub', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});
