import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/preact';
import type { AccountPasskeyCredential, Profile } from '@/lib/types';

// Mock i18n: keep real t()/getLocale (English) but stub setLocale so changeLocale
// does not perform a real async locale swap. window.location.reload is stubbed below.
vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/lib/i18n')>('@/lib/i18n');
  return { ...actual, setLocale: vi.fn(async () => {}) };
});

import SettingsPage from '@/components/SettingsPage';
import { setLocale } from '@/lib/i18n';

const profile: Profile = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Test User',
  key: 'enc-key',
  masterPasswordHint: 'my hint',
  role: 'user',
};

function buildProps(overrides: Partial<Parameters<typeof SettingsPage>[0]> = {}) {
  const callbacks = {
    onThemePreferenceChange: vi.fn(),
    onVerifyMasterPassword: vi.fn(async () => {}),
    onChangePassword: vi.fn(async () => {}),
    onSavePasswordHint: vi.fn(async () => {}),
    onEnableTotp: vi.fn(async () => {}),
    onOpenDisableTotp: vi.fn(),
    onGetRecoveryCode: vi.fn(async () => 'RECOVERY-1234'),
    onGetApiKey: vi.fn(async () => 'api-secret-key'),
    onRotateApiKey: vi.fn(async () => 'rotated-secret-key'),
    onListAccountPasskeys: vi.fn(async (): Promise<AccountPasskeyCredential[]> => []),
    onCreateAccountPasskey: vi.fn(async () => null),
    onEnableAccountPasskeyDirectUnlock: vi.fn(async () => {}),
    onDeleteAccountPasskey: vi.fn(async () => {}),
    onRefreshTwoFactorStatus: vi.fn(async () => {}),
    onLockTimeoutChange: vi.fn(),
    onSessionTimeoutActionChange: vi.fn(),
    onNotify: vi.fn(),
  };
  const props = {
    profile,
    totpEnabled: false,
    themePreference: 'system' as const,
    lockTimeoutMinutes: 15 as const,
    sessionTimeoutAction: 'lock' as const,
    ...callbacks,
    ...overrides,
  };
  render(<SettingsPage {...(props as any)} />);
  return { ...callbacks, ...overrides };
}

// The settings page is organised into category tabs; only the active section's
// content is in the DOM. Click a tab to reveal its panel.
function openTab(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

// Drive the master-password prompt that gates the TOTP manage dialog, then wait
// for the manage dialog (its verification-code field) to appear.
async function openTotpManageDialog(): Promise<void> {
  openTab('Two-step login');
  const authRow = screen.getByText('Authenticator app').closest('.two-step-provider-row') as HTMLElement;
  fireEvent.click(within(authRow).getByRole('button', { name: 'Manage' }));
  const prompt = await screen.findByRole('dialog');
  const pwInput = prompt.querySelector('input[type="password"]') as HTMLInputElement;
  fireEvent.input(pwInput, { target: { value: 'master-pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Verification Code');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('<SettingsPage>', () => {
  it('renders the main settings sections', () => {
    buildProps();
    // Category tabs for every settings section.
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session timeout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Master Password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Two-step login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keys' })).toBeInTheDocument();
    // Appearance is the default panel.
    expect(screen.getByText('Theme')).toBeInTheDocument();
    // Master-password panel exposes password change + account passkeys.
    openTab('Master Password');
    expect(screen.getByRole('heading', { name: 'Change Master Password' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account passkeys' })).toBeInTheDocument();
    // Two-step panel exposes the providers list.
    openTab('Two-step login');
    expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    // Keys panel exposes the API key.
    openTab('Keys');
    expect(screen.getByRole('heading', { name: 'API Key' })).toBeInTheDocument();
  });

  it('fires onLockTimeoutChange when the session timeout select changes', () => {
    const { onLockTimeoutChange } = buildProps();
    openTab('Session timeout');
    const select = screen.getByDisplayValue('15 minutes') as HTMLSelectElement;
    fireEvent.input(select, { target: { value: '30' } });
    expect(onLockTimeoutChange).toHaveBeenCalledWith(30);
  });

  it('fires onSessionTimeoutActionChange when the timeout action changes', () => {
    const { onSessionTimeoutActionChange } = buildProps();
    openTab('Session timeout');
    const select = screen.getByDisplayValue('Lock') as HTMLSelectElement;
    fireEvent.input(select, { target: { value: 'logout' } });
    expect(onSessionTimeoutActionChange).toHaveBeenCalledWith('logout');
  });

  it('changes the locale when a different language is selected', async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    buildProps();
    const select = screen.getByDisplayValue('English') as HTMLSelectElement;
    fireEvent.input(select, { target: { value: 'es' } });
    await waitFor(() => expect(setLocale).toHaveBeenCalledWith('es'));
    expect(reloadSpy).toHaveBeenCalled();
  });

  it('fires onChangePassword with the entered credentials', () => {
    const { onChangePassword } = buildProps();
    openTab('Master Password');
    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.input(inputs[0], { target: { value: 'old-pass' } });
    fireEvent.input(inputs[1], { target: { value: 'new-pass' } });
    fireEvent.input(inputs[2], { target: { value: 'new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(onChangePassword).toHaveBeenCalledWith('old-pass', 'new-pass', 'new-pass');
  });

  it('fires onSavePasswordHint with the hint value', () => {
    const { onSavePasswordHint } = buildProps();
    openTab('Master Password');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSavePasswordHint).toHaveBeenCalledWith('my hint');
  });

  it('enables TOTP through the manage dialog with the verified master password', async () => {
    const { onEnableTotp, onNotify } = buildProps();
    await openTotpManageDialog();
    const codeInput = screen.getByText('Verification Code').closest('label')!.querySelector('input')!;
    fireEvent.input(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable TOTP' }));

    await waitFor(() => expect(onEnableTotp).toHaveBeenCalledTimes(1));
    // Secret is the auto-generated base32 value; token + verified manage password flow through.
    expect(onEnableTotp).toHaveBeenCalledWith(expect.any(String), '123456', 'master-pw');
    expect(onNotify).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('notifies an error when enabling TOTP without a verification code', async () => {
    const { onEnableTotp, onNotify } = buildProps();
    await openTotpManageDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Enable TOTP' }));
    expect(onEnableTotp).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('fires onOpenDisableTotp when TOTP is enabled and disable is clicked', async () => {
    const { onOpenDisableTotp } = buildProps({ totpEnabled: true });
    await openTotpManageDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Disable TOTP' }));
    expect(onOpenDisableTotp).toHaveBeenCalledTimes(1);
  });

  it('calls onGetRecoveryCode through the master-password prompt', async () => {
    const { onGetRecoveryCode } = buildProps();
    openTab('Two-step login');
    fireEvent.click(screen.getByRole('button', { name: 'View Recovery Code' }));
    const dialog = await screen.findByRole('dialog');
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onGetRecoveryCode).toHaveBeenCalledWith('master-pw'));
    expect(await screen.findByText('RECOVERY-1234')).toBeInTheDocument();
  });

  it('calls onGetApiKey through the master-password prompt', async () => {
    const { onGetApiKey } = buildProps();
    openTab('Keys');
    fireEvent.click(screen.getByRole('button', { name: 'View API Key' }));
    const dialog = await screen.findByRole('dialog');
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onGetApiKey).toHaveBeenCalledWith('master-pw'));
  });

  it('requires confirmation before rotating the API key', async () => {
    const { onRotateApiKey } = buildProps();
    openTab('Keys');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate API Key' }));
    // Confirm the rotate warning dialog.
    const confirmBtn = await screen.findByRole('button', { name: 'Yes' });
    fireEvent.click(confirmBtn);
    // Then the master-password prompt opens.
    const dialog = await screen.findByRole('dialog');
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onRotateApiKey).toHaveBeenCalledWith('master-pw'));
  });

  it('calls onCreateAccountPasskey through the verify-then-name dialog', async () => {
    const { onCreateAccountPasskey } = buildProps();
    openTab('Master Password');
    fireEvent.click(screen.getByRole('button', { name: 'Add account passkey' }));
    // Verify master password first.
    const prompt = await screen.findByRole('dialog');
    const pwInput = prompt.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // The naming dialog opens; save creates the passkey with the verified password.
    const nameDialog = (await screen.findByText('Passkey created. Name it to help you recognize it.'))
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(nameDialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCreateAccountPasskey).toHaveBeenCalledTimes(1));
    expect(onCreateAccountPasskey).toHaveBeenCalledWith(expect.any(String), 'master-pw', false);
  });

  it('lists account passkeys and fires delete via the prompt', async () => {
    const passkey: AccountPasskeyCredential = {
      id: 'pk-1',
      name: 'My Passkey',
      prfStatus: 1,
      creationDate: '2024-01-01T00:00:00Z',
    };
    const onDeleteAccountPasskey = vi.fn(async () => {});
    buildProps({
      onListAccountPasskeys: vi.fn(async () => [passkey]),
      onDeleteAccountPasskey,
    });
    openTab('Master Password');
    expect(await screen.findByText('My Passkey')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onDeleteAccountPasskey).toHaveBeenCalledWith('pk-1', 'master-pw'));
  });

  it('shows the empty state when there are no account passkeys', async () => {
    buildProps();
    openTab('Master Password');
    expect(await screen.findByText('No account passkeys')).toBeInTheDocument();
  });

  it('refreshes account passkeys on initial load and via the refresh button', async () => {
    const onListAccountPasskeys = vi.fn(async (): Promise<AccountPasskeyCredential[]> => []);
    buildProps({ onListAccountPasskeys });
    await waitFor(() => expect(onListAccountPasskeys).toHaveBeenCalledTimes(1));
    openTab('Master Password');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(onListAccountPasskeys).toHaveBeenCalledTimes(2));
  });
});
