import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Settings (language persistence, 2FA section, password-change form), the Admin
// panel (invite create/revoke, user ban/unban), the Domain Rules editor, and
// deep-link routing. Demo mode is admin and wires the relevant handlers to
// mutate in-memory state. Each test logs in fresh.

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('changing the language persists across a reload', async ({ page }) => {
  await page.getByRole('link', { name: 'Account Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/account/);

  const languageSelect = page
    .locator('.settings-module', { hasText: 'Language' })
    .getByRole('combobox');
  // Switching locale persists to localStorage and reloads the app (which, in
  // demo mode, drops the in-memory session back to the login screen).
  await languageSelect.selectOption('es');

  // The re-mounted app applies the saved locale, setting <html lang="es">.
  // (Web-first assertion retries through the reload navigation.)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 15_000 });

  // The chosen locale was persisted to localStorage. expect.poll retries the
  // evaluate, so it tolerates any late navigation tearing down the context.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('nodewarden.locale')).catch(() => null), { timeout: 15_000 })
    .toBe('es');

  // An explicit second reload still reads back the persisted preference.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('nodewarden.locale')).catch(() => null), { timeout: 15_000 })
    .toBe('es');
});

test('the 2FA (TOTP) section shows the enabled state', async ({ page }) => {
  await page.getByRole('link', { name: 'Account Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/account/);

  // Demo enables TOTP, so the module shows an "Enabled" pill and an active
  // Disable button while the Enable button is locked.
  const totpModule = page.locator('.settings-module', { hasText: 'TOTP' }).first();
  await expect(totpModule.locator('.totp-status-pill')).toBeVisible();
  await expect(totpModule.getByRole('button', { name: /disable totp/i })).toBeEnabled();
});

test('the change-master-password form renders its fields', async ({ page }) => {
  await page.getByRole('link', { name: 'Account Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/account/);

  const module = page.locator('.settings-module', { hasText: 'Change Master Password' });
  await expect(module.getByRole('heading', { name: 'Change Master Password' })).toBeVisible();
  await expect(module.locator('input[type="password"]')).toHaveCount(3);
  await expect(module.getByRole('button', { name: 'Change Password' })).toBeVisible();
});

test('admin can create then revoke an invite', async ({ page }) => {
  await page.getByRole('link', { name: 'Admin Panel' }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole('heading', { name: 'Invites' })).toBeVisible();

  const inviteRowsBefore = await page.locator('.invite-table tbody tr').count();
  await page.getByRole('button', { name: 'Create Timed Invite' }).click();
  // A new active invite row is added (codes are generated as DEMO-XXXXXX).
  await expect.poll(async () => page.locator('.invite-table tbody tr').count())
    .toBeGreaterThan(inviteRowsBefore);

  // Revoke the seeded active invite.
  const seededRow = page.locator('.invite-table tbody tr', { hasText: 'DEMO-INVITE-2026' });
  await seededRow.getByRole('button', { name: 'Revoke' }).click();
  // After revoking, that row no longer offers a Revoke action (status flips).
  await expect(seededRow.getByRole('button', { name: 'Revoke' })).toHaveCount(0, { timeout: 10_000 });
});

test('admin can ban then unban a user', async ({ page }) => {
  await page.getByRole('link', { name: 'Admin Panel' }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  const userRow = page.locator('.table tbody tr', { hasText: 'viewer@example.com' });
  await expect(userRow.getByText('Active')).toBeVisible();
  await userRow.getByRole('button', { name: 'Ban' }).click();
  await expect(userRow.getByText('Banned')).toBeVisible({ timeout: 10_000 });

  // The action toggles to "Unban"; toggling back restores Active.
  await userRow.getByRole('button', { name: 'Unban' }).click();
  await expect(userRow.getByText('Active')).toBeVisible({ timeout: 10_000 });
});

test('domain rules: add a custom equivalent-domain rule', async ({ page }) => {
  await page.getByRole('link', { name: 'Domain Rules' }).first().click();
  await expect(page).toHaveURL(/\/settings\/domain-rules/);
  await expect(page.getByRole('heading', { name: 'Custom equivalent domains' })).toBeVisible();

  const customCard = page.locator('.domain-rules-custom');
  // Open the new-rule editor (the card's "Add" button).
  await customCard.getByRole('button', { name: 'Add' }).click();

  // Fill the two domain inputs and confirm.
  const newRow = page.locator('.domain-rule-new-row');
  const inputs = newRow.locator('.domain-rule-inline-input');
  await inputs.nth(0).fill('example.com');
  await inputs.nth(1).fill('example.net');
  await newRow.getByRole('button', { name: /^confirm$/i }).click();

  // The rule now appears as a row in the custom rules table.
  await expect(
    customCard.locator('.domain-rule-row', { hasText: 'example.com, example.net' }).first()
  ).toBeVisible({ timeout: 10_000 });
});

test('navigate across routes and use browser back/forward', async ({ page }) => {
  // NOTE: demo mode does not persist the session, so a hard navigation to a
  // protected URL lands on the login screen. Within an authenticated session,
  // client-side routing (links + history) is fully exercised here instead.

  // Go to Settings, then Sends, then the TOTP page via sidebar links.
  await page.getByRole('link', { name: 'Account Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/account/);
  await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible();

  await page.getByRole('link', { name: 'Sends' }).first().click();
  await expect(page).toHaveURL(/\/sends/);
  await expect(page.locator('.list-item', { hasText: 'Design handoff.zip' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Verification Code' }).first().click();
  await expect(page).toHaveURL(/\/vault\/totp/);
  await expect(page.getByRole('heading', { name: 'Verification Code' })).toBeVisible();

  // Browser Back returns to Sends; Forward returns to the TOTP page.
  await page.goBack();
  await expect(page).toHaveURL(/\/sends/);
  await page.goForward();
  await expect(page).toHaveURL(/\/vault\/totp/);

  // Navigate back to the vault via the sidebar link.
  await page.getByRole('link', { name: 'Vault', exact: true }).first().click();
  await expect(page).toHaveURL(/\/vault$/);
  await expect(page.getByText('GitHub', { exact: false }).first()).toBeVisible();
});
