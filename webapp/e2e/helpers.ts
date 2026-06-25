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
// whose title text is the cipher's decrypted name.
export function vaultRow(page: Page, name: string) {
  return page.locator('.list-item', { hasText: name });
}

export async function selectVaultItem(page: Page, name: string): Promise<void> {
  await vaultRow(page, name).first().click();
  // The detail pane renders the item's name in its title.
  await expect(page.locator('.detail-title', { hasText: name }).first()).toBeVisible();
}
