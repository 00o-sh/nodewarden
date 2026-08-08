import { expect, type Page } from '@playwright/test';

// Shared helpers for the E2E suites. The app runs in DEMO mode (see
// webapp/src/lib/demo.ts): any email/password unlocks a fixed, in-memory vault
// seeded with known ciphers, folders, sends, users and invites. CRUD mutates
// that in-memory state for the lifetime of the page, so every test logs in fresh
// to get a clean, deterministic vault.

export async function login(page: Page): Promise<void> {
  await page.goto('/');
  // In demo mode any credentials work; the email field is the first textbox and
  // the master password is the only password input on the login form.
  await page.getByRole('textbox').first().fill('demo@nodewarden.app');
  await page.locator('input[type="password"]').first().fill('demo-password');
  await page.getByRole('button', { name: /^log in$/i }).first().click();
  // A known seeded cipher proves the vault decrypted and rendered.
  await expect(page.getByText('GitHub', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
}

// A single vault row keyed by its visible name. Rows are `.list-item` containers
// whose title text is the cipher's decrypted name. Match the title text exactly so
// a name that is a prefix of another (e.g. "Amazon" vs "Amazon Web Services", added
// by the v1.8.0 duplicate-detection demo data) does not resolve to multiple rows.
export function vaultRow(page: Page, name: string) {
  return page.locator('.list-item').filter({ has: page.getByText(name, { exact: true }) });
}

export async function selectVaultItem(page: Page, name: string): Promise<void> {
  await vaultRow(page, name).first().click();
  // The detail pane renders the item's name in its title.
  await expect(page.locator('.detail-title', { hasText: name }).first()).toBeVisible();
}

// The flat sidebar now exposes a single "Settings" link. On desktop /settings
// redirects straight to the categorized account-settings page (/settings/account)
// with its Appearance / Session timeout / Master Password / Two-step login / Keys
// tabs.
export async function openAccountSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect(page).toHaveURL(/\/settings\/account/);
}

// Domain Rules is no longer a flat side link. Switching the sidebar to the
// grouped layout exposes the Settings group's Domain Rules sub-link.
export async function openDomainRules(page: Page): Promise<void> {
  await page.locator('.nav-layout-trigger').click();
  await page.locator('.nav-layout-option', { hasText: /^Grouped$/ }).click();
  await page.getByRole('link', { name: 'Domain Rules' }).first().click();
  await expect(page).toHaveURL(/\/settings\/domain-rules/);
}

// Open one of the categorized settings tabs by its visible label.
export async function openSettingsTab(page: Page, label: string): Promise<void> {
  await page.locator('.settings-category-tab', { hasText: label }).click();
}
