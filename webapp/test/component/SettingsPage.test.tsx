import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/preact';
import type {
  AccountPasskeyCredential,
  Profile,
  TwoFactorPasskeySettings,
  YubiKeyOtpSettings,
} from '@/lib/types';

// Mock i18n: keep real t()/getLocale (English) but stub setLocale so changeLocale
// does not perform a real async locale swap. window.location.reload is stubbed below.
vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/lib/i18n')>('@/lib/i18n');
  return { ...actual, setLocale: vi.fn(async () => {}) };
});

import SettingsPage from '@/components/SettingsPage';
import { setLocale, t } from '@/lib/i18n';

const profile: Profile = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Test User',
  key: 'enc-key',
  masterPasswordHint: 'my hint',
  role: 'user',
};

function yubiSettings(overrides: Partial<YubiKeyOtpSettings> = {}): YubiKeyOtpSettings {
  return {
    enabled: false,
    keys: ['', '', '', '', ''],
    nfc: false,
    yubicoConfigured: false,
    yubicoCanManage: false,
    yubicoClientId: '',
    yubicoSecretKey: '',
    ...overrides,
  } as YubiKeyOtpSettings;
}

function passkeySettings(overrides: Partial<TwoFactorPasskeySettings> = {}): TwoFactorPasskeySettings {
  return { enabled: false, keys: [], ...overrides };
}

function buildProps(overrides: Partial<Parameters<typeof SettingsPage>[0]> = {}) {
  const callbacks = {
    onThemePreferenceChange: vi.fn(),
    onVerifyMasterPassword: vi.fn(async () => {}),
    onChangePassword: vi.fn(async () => {}),
    onSavePasswordHint: vi.fn(async () => {}),
    onEnableTotp: vi.fn(async () => {}),
    onOpenDisableTotp: vi.fn(),
    onGetYubiKeySettings: vi.fn(async () => yubiSettings()),
    onSaveYubiKeySettings: vi.fn(async (keys: string[], nfc: boolean) =>
      yubiSettings({ enabled: true, keys: keys as any, nfc, yubicoConfigured: true }),
    ),
    onSaveYubiKeyApiCredentials: vi.fn(async (clientId: string, secretKey: string) =>
      yubiSettings({ yubicoConfigured: true, yubicoClientId: clientId, yubicoSecretKey: secretKey }),
    ),
    onBootstrapYubiKeyApiCredentials: vi.fn(async () => yubiSettings({ yubicoConfigured: true })),
    onDisableYubiKey: vi.fn(async () => {}),
    onGetTwoFactorPasskeySettings: vi.fn(async () => passkeySettings()),
    onCreateTwoFactorPasskey: vi.fn(async () => passkeySettings()),
    onDeleteTwoFactorPasskey: vi.fn(async () => passkeySettings()),
    onDisableTwoFactorPasskeys: vi.fn(async () => {}),
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
    yubikeyEnabled: false,
    passkey2faEnabled: false,
    themePreference: 'system' as const,
    lockTimeoutMinutes: 15 as const,
    sessionTimeoutAction: 'lock' as const,
    ...callbacks,
    ...overrides,
  };
  render(<SettingsPage {...(props as any)} />);
  return { ...callbacks, ...overrides };
}

// Open the Two-step tab, click Manage on the given provider row, then verify the
// master password through the gate prompt so the provider's manage dialog opens.
function openProviderManage(rowText: string): void {
  openTab('Two-step login');
  const row = screen.getByText(rowText).closest('.two-step-provider-row') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Manage' }));
  const prompt = screen.getByRole('dialog');
  const pw = prompt.querySelector('input[type="password"]') as HTMLInputElement;
  fireEvent.input(pw, { target: { value: 'master-pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
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
    // v1.8.0 defaults the account-passkey mode toggle to direct-unlock (true).
    expect(onCreateAccountPasskey).toHaveBeenCalledWith(expect.any(String), 'master-pw', true);
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

  it('fires onThemePreferenceChange when the theme is changed', () => {
    const { onThemePreferenceChange } = buildProps();
    const select = screen.getByDisplayValue('Use system theme') as HTMLSelectElement;
    fireEvent.input(select, { target: { value: 'dark' } });
    expect(onThemePreferenceChange).toHaveBeenCalledWith('dark');
  });

  it('edits the master-password hint before saving it', () => {
    const { onSavePasswordHint } = buildProps();
    openTab('Master Password');
    const hintInput = screen.getByDisplayValue('my hint') as HTMLInputElement;
    fireEvent.input(hintInput, { target: { value: 'updated hint' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSavePasswordHint).toHaveBeenCalledWith('updated hint');
  });

  it('notifies an error when enabling TOTP fails in the manage dialog', async () => {
    const onEnableTotp = vi.fn(async () => {
      throw new Error('bad code');
    });
    const { onNotify } = buildProps({ onEnableTotp });
    await openTotpManageDialog();
    const codeInput = screen.getByText('Verification Code').closest('label')!.querySelector('input')!;
    fireEvent.input(codeInput, { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable TOTP' }));
    await waitFor(() => expect(onEnableTotp).toHaveBeenCalledWith(expect.any(String), '654321', 'master-pw'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'bad code'));
  });

  it('shows the enabled badges when providers are already enabled', () => {
    buildProps({ passkey2faEnabled: true, yubikeyEnabled: true });
    openTab('Two-step login');
    const passkeyRow = screen.getByText('Passkeys').closest('.two-step-provider-row') as HTMLElement;
    expect(within(passkeyRow).getByText('Enabled')).toBeInTheDocument();
    const yubiRow = screen.getByText('Yubico OTP security key').closest('.two-step-provider-row') as HTMLElement;
    expect(within(yubiRow).getByText('Enabled')).toBeInTheDocument();
  });

  it('refreshes two-factor status via the refresh-status button', async () => {
    const onRefreshTwoFactorStatus = vi.fn(async () => {});
    buildProps({ onRefreshTwoFactorStatus });
    openTab('Two-step login');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => expect(onRefreshTwoFactorStatus).toHaveBeenCalledTimes(1));
  });

  it('notifies an error when refreshing two-factor status fails', async () => {
    const onRefreshTwoFactorStatus = vi.fn(async () => {
      throw new Error('status failed');
    });
    const { onNotify } = buildProps({ onRefreshTwoFactorStatus });
    openTab('Two-step login');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'status failed'));
  });

  it('enables direct unlock for a login-only account passkey through the prompt', async () => {
    const passkey: AccountPasskeyCredential = {
      id: 'pk-2',
      name: 'Login Key',
      prfStatus: 1,
      creationDate: '2024-02-02T00:00:00Z',
    };
    const onEnableAccountPasskeyDirectUnlock = vi.fn(async () => {});
    buildProps({
      onListAccountPasskeys: vi.fn(async () => [passkey]),
      onEnableAccountPasskeyDirectUnlock,
    });
    openTab('Master Password');
    await screen.findByText('Login Key');
    fireEvent.click(screen.getByRole('button', { name: 'Enable direct unlock' }));
    const dialog = await screen.findByRole('dialog');
    const pw = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pw, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(onEnableAccountPasskeyDirectUnlock).toHaveBeenCalledWith('pk-2', 'master-pw'),
    );
  });

  it('creates an account passkey in login-only mode with a custom name', async () => {
    const created: AccountPasskeyCredential = {
      id: 'pk-new',
      name: 'Hardware Key',
      prfStatus: 0,
      creationDate: '2024-03-03T00:00:00Z',
    };
    const onCreateAccountPasskey = vi.fn(async () => created);
    const onListAccountPasskeys = vi.fn(async (): Promise<AccountPasskeyCredential[]> => []);
    buildProps({ onCreateAccountPasskey, onListAccountPasskeys });
    openTab('Master Password');
    fireEvent.click(screen.getByRole('button', { name: 'Add account passkey' }));
    const prompt = await screen.findByRole('dialog');
    fireEvent.input(prompt.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'master-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const nameDialog = (await screen.findByText('Passkey created. Name it to help you recognize it.'))
      .closest('[role="dialog"]') as HTMLElement;
    const nameInput = within(nameDialog).getByDisplayValue('Account passkey') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'Hardware Key' } });
    // The mode toggle now defaults to direct-unlock (checked); toggle it off to
    // switch to login-only mode, which swaps the help copy.
    const toggle = nameDialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(toggle);
    fireEvent.click(within(nameDialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onCreateAccountPasskey).toHaveBeenCalledWith('Hardware Key', 'master-pw', false),
    );
    // A returned credential triggers a passkey list refresh.
    await waitFor(() => expect(onListAccountPasskeys).toHaveBeenCalledTimes(2));
  });

  it('notifies an error when creating an account passkey fails', async () => {
    const onCreateAccountPasskey = vi.fn(async () => {
      throw new Error('passkey failed');
    });
    const { onNotify } = buildProps({ onCreateAccountPasskey });
    openTab('Master Password');
    fireEvent.click(screen.getByRole('button', { name: 'Add account passkey' }));
    const prompt = await screen.findByRole('dialog');
    fireEvent.input(prompt.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'master-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const nameDialog = (await screen.findByText('Passkey created. Name it to help you recognize it.'))
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(nameDialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'passkey failed'));
  });

  it('copies the recovery code and closes the dialog', async () => {
    buildProps();
    openTab('Two-step login');
    fireEvent.click(screen.getByRole('button', { name: 'View Recovery Code' }));
    const prompt = await screen.findByRole('dialog');
    fireEvent.input(prompt.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'master-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('RECOVERY-1234')).toBeInTheDocument();
    const copyBtn = screen.getByRole('button', { name: 'Copy Code' });
    fireEvent.click(copyBtn);
    // Close via the dialog X button.
    const codeDialog = screen.getByText('RECOVERY-1234').closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(codeDialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('RECOVERY-1234')).not.toBeInTheDocument());
  });

  // ---- YubiKey OTP provider ----

  it('bootstraps Yubico validation credentials when not configured', async () => {
    const onGetYubiKeySettings = vi.fn(async () => yubiSettings({ yubicoConfigured: false }));
    const onBootstrapYubiKeyApiCredentials = vi.fn(async () =>
      yubiSettings({ yubicoConfigured: true, yubicoCanManage: true, enabled: false }),
    );
    buildProps({ onGetYubiKeySettings, onBootstrapYubiKeyApiCredentials });
    openProviderManage('Yubico OTP security key');
    await waitFor(() => expect(onGetYubiKeySettings).toHaveBeenCalledWith('master-pw'));
    // The unconfigured panel is shown.
    const otpField = (await screen.findByText('Yubico validation is not configured'))
      .closest('.yubikey-config-panel')!
      .querySelector('input[type="password"]') as HTMLInputElement;
    // Whitespace/uppercase is normalised before submit.
    fireEvent.input(otpField, { target: { value: '  CCCC OTP  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get and save automatically' }));
    await waitFor(() =>
      expect(onBootstrapYubiKeyApiCredentials).toHaveBeenCalledWith('ccccotp', 'master-pw'),
    );
    // Once configured, the credentials panel replaces the bootstrap panel.
    expect(await screen.findByText('Yubico validation credentials')).toBeInTheDocument();
  });

  it('saves YubiKey keys and NFC, edits an empty slot, removes a stored key', async () => {
    const storedLong = 'a'.repeat(44);
    const onGetYubiKeySettings = vi.fn(async () =>
      yubiSettings({
        enabled: true,
        yubicoConfigured: true,
        yubicoCanManage: true,
        yubicoClientId: 'cid-1',
        yubicoSecretKey: 'secret-1',
        keys: [storedLong, 'short', '', '', ''],
        nfc: false,
      }),
    );
    const onSaveYubiKeySettings = vi.fn(async (keys: string[], nfc: boolean) =>
      yubiSettings({ enabled: true, yubicoConfigured: true, keys: keys as any, nfc }),
    );
    buildProps({ onGetYubiKeySettings, onSaveYubiKeySettings });
    openProviderManage('Yubico OTP security key');
    const dialog = (await screen.findByText('Yubico validation credentials'))
      .closest('[role="dialog"]') as HTMLElement;

    // Stored keys are shown as masked spans; the short one is padded to 44 chars.
    expect(within(dialog).getByText(storedLong)).toBeInTheDocument();
    expect(within(dialog).getByText(`short${'•'.repeat(39)}`)).toBeInTheDocument();

    // Fill an empty slot (YubiKey 3). Input is normalised (lowercased, no spaces).
    const key3Input = within(dialog)
      .getByText('YubiKey 3')
      .closest('label')!
      .querySelector('input') as HTMLInputElement;
    fireEvent.input(key3Input, { target: { value: 'DD DD' } });
    expect(key3Input.value).toBe('dddd');

    // Toggle NFC support on.
    const nfcCheckbox = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(nfcCheckbox);

    // Remove the stored short key via its trash button.
    const shortRow = within(dialog).getByText(`short${'•'.repeat(39)}`).closest('.yubikey-input-row') as HTMLElement;
    fireEvent.click(within(shortRow).getByRole('button', { name: 'Remove' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaveYubiKeySettings).toHaveBeenCalledTimes(1));
    const [keysArg, nfcArg, pwArg] = onSaveYubiKeySettings.mock.calls[0];
    expect(keysArg).toEqual([storedLong, '', 'dddd', '', '']);
    expect(nfcArg).toBe(true);
    expect(pwArg).toBe('master-pw');
  });

  it('views and saves Yubico validation credentials from the config panel', async () => {
    const onGetYubiKeySettings = vi.fn(async () =>
      yubiSettings({
        enabled: true,
        yubicoConfigured: true,
        yubicoCanManage: true,
        yubicoClientId: 'cid-1',
        yubicoSecretKey: 'secret-1',
        keys: ['', '', '', '', ''],
      }),
    );
    const onSaveYubiKeyApiCredentials = vi.fn(async (clientId: string, secretKey: string) =>
      yubiSettings({ enabled: true, yubicoConfigured: true, yubicoClientId: clientId, yubicoSecretKey: secretKey }),
    );
    buildProps({ onGetYubiKeySettings, onSaveYubiKeyApiCredentials });
    openProviderManage('Yubico OTP security key');
    const dialog = (await screen.findByText('Yubico validation credentials'))
      .closest('[role="dialog"]') as HTMLElement;

    // Reveal the credentials editor.
    fireEvent.click(within(dialog).getByRole('button', { name: 'View' }));
    const configPanel = within(dialog).getByText('Client ID').closest('.settings-vertical-fields') as HTMLElement;
    const clientIdInput = within(configPanel).getByDisplayValue('cid-1') as HTMLInputElement;
    fireEvent.input(clientIdInput, { target: { value: 'cid-2' } });
    fireEvent.click(within(configPanel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSaveYubiKeyApiCredentials).toHaveBeenCalledWith('cid-2', 'secret-1', 'master-pw'),
    );
  });

  it('disables all YubiKeys through the manage dialog', async () => {
    const onGetYubiKeySettings = vi.fn(async () =>
      yubiSettings({ enabled: true, yubicoConfigured: true, yubicoCanManage: true, yubicoClientId: 'cid-1', keys: ['', '', '', '', ''] }),
    );
    const onDisableYubiKey = vi.fn(async () => {});
    buildProps({ onGetYubiKeySettings, onDisableYubiKey });
    openProviderManage('Yubico OTP security key');
    const dialog = (await screen.findByText('Yubico validation credentials'))
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable all keys' }));
    await waitFor(() => expect(onDisableYubiKey).toHaveBeenCalledWith('master-pw'));
    // Disable button disappears once disabled.
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: 'Disable all keys' })).not.toBeInTheDocument(),
    );
  });

  it('notifies an error when saving YubiKey settings fails', async () => {
    const onGetYubiKeySettings = vi.fn(async () =>
      yubiSettings({ enabled: true, yubicoConfigured: true, yubicoCanManage: true, yubicoClientId: 'cid-1', keys: ['', '', '', '', ''] }),
    );
    const onSaveYubiKeySettings = vi.fn(async () => {
      throw new Error('yubi save failed');
    });
    const { onNotify } = buildProps({ onGetYubiKeySettings, onSaveYubiKeySettings });
    openProviderManage('Yubico OTP security key');
    const dialog = (await screen.findByText('Yubico validation credentials'))
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'yubi save failed'));
  });

  it('submits the YubiKey dialog form to bootstrap when unconfigured', async () => {
    const onGetYubiKeySettings = vi.fn(async () => yubiSettings({ yubicoConfigured: false }));
    const onBootstrapYubiKeyApiCredentials = vi.fn(async () => yubiSettings({ yubicoConfigured: true }));
    buildProps({ onGetYubiKeySettings, onBootstrapYubiKeyApiCredentials });
    openProviderManage('Yubico OTP security key');
    const otpField = (await screen.findByText('Yubico validation is not configured'))
      .closest('.yubikey-config-panel')!
      .querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(otpField, { target: { value: 'ccccbootstrap' } });
    const dialog = otpField.closest('[role="dialog"]') as HTMLElement;
    fireEvent.submit(dialog);
    await waitFor(() =>
      expect(onBootstrapYubiKeyApiCredentials).toHaveBeenCalledWith('ccccbootstrap', 'master-pw'),
    );
  });

  it('closes the YubiKey manage dialog via the close button', async () => {
    const onGetYubiKeySettings = vi.fn(async () =>
      yubiSettings({ enabled: false, yubicoConfigured: true, yubicoCanManage: true, yubicoClientId: 'cid-1', keys: ['', '', '', '', ''] }),
    );
    buildProps({ onGetYubiKeySettings });
    openProviderManage('Yubico OTP security key');
    const dialog = (await screen.findByText('Yubico validation credentials'))
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByText('Yubico validation credentials')).not.toBeInTheDocument(),
    );
  });

  // ---- Passkey two-step login provider ----

  it('registers, deletes, and disables two-step passkeys', async () => {
    const onGetTwoFactorPasskeySettings = vi.fn(async () =>
      passkeySettings({ enabled: true, keys: [{ id: 1, name: 'Key A' }, { id: 2, name: 'Key B' }] }),
    );
    const onCreateTwoFactorPasskey = vi.fn(async (name: string) =>
      passkeySettings({ enabled: true, keys: [{ id: 1, name: 'Key A' }, { id: 2, name: 'Key B' }, { id: 3, name }] }),
    );
    const onDeleteTwoFactorPasskey = vi.fn(async () =>
      passkeySettings({ enabled: true, keys: [{ id: 2, name: 'Key B' }] }),
    );
    const onDisableTwoFactorPasskeys = vi.fn(async () => {});
    buildProps({
      onGetTwoFactorPasskeySettings,
      onCreateTwoFactorPasskey,
      onDeleteTwoFactorPasskey,
      onDisableTwoFactorPasskeys,
    });
    openProviderManage('Passkeys');
    const dialog = (await screen.findByText('Manage passkeys used only for two-step login.'))
      .closest('[role="dialog"]') as HTMLElement;

    // Existing keys are listed.
    expect(within(dialog).getByText('Key A')).toBeInTheDocument();
    expect(within(dialog).getByText('Key B')).toBeInTheDocument();

    // Register a new passkey with a custom name.
    const nameInput = within(dialog).getByDisplayValue('Passkey') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'Backup Key' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(onCreateTwoFactorPasskey).toHaveBeenCalledWith('Backup Key', 'master-pw'));
    expect(await within(dialog).findByText('Backup Key')).toBeInTheDocument();

    // Delete the first key (id 1) — allowed because more than one key exists.
    const keyARow = within(dialog).getByText('Key A').closest('.account-passkey-row') as HTMLElement;
    fireEvent.click(within(keyARow).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleteTwoFactorPasskey).toHaveBeenCalledWith(1, 'master-pw'));

    // Disable all keys.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable all keys' }));
    await waitFor(() => expect(onDisableTwoFactorPasskeys).toHaveBeenCalledWith('master-pw'));
  });

  it('shows the empty two-step passkey list and closes via the close button', async () => {
    const onGetTwoFactorPasskeySettings = vi.fn(async () => passkeySettings({ enabled: false, keys: [] }));
    buildProps({ onGetTwoFactorPasskeySettings });
    openProviderManage('Passkeys');
    const dialog = (await screen.findByText('Manage passkeys used only for two-step login.'))
      .closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByText('No two-step passkeys')).toBeInTheDocument();
    // No disable button when passkeys are disabled.
    expect(within(dialog).queryByRole('button', { name: 'Disable all keys' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByText('Manage passkeys used only for two-step login.')).not.toBeInTheDocument(),
    );
  });

  it('notifies an error when registering a two-step passkey fails', async () => {
    const onGetTwoFactorPasskeySettings = vi.fn(async () => passkeySettings({ enabled: false, keys: [] }));
    const onCreateTwoFactorPasskey = vi.fn(async () => {
      throw new Error('register failed');
    });
    const { onNotify } = buildProps({ onGetTwoFactorPasskeySettings, onCreateTwoFactorPasskey });
    openProviderManage('Passkeys');
    const dialog = (await screen.findByText('Manage passkeys used only for two-step login.'))
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'register failed'));
  });

  // ---- Non-Error rejection fallbacks (the `instanceof Error ? … : fallback` else) ----

  it('uses the fallback message when loading account passkeys rejects with a non-Error', async () => {
    const { onNotify } = buildProps({
      onListAccountPasskeys: vi.fn(() => Promise.reject('list boom')),
    });
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith('error', t('txt_account_passkeys_load_failed')),
    );
  });

  it('surfaces the Error message when loading account passkeys rejects with an Error', async () => {
    const { onNotify } = buildProps({
      onListAccountPasskeys: vi.fn(async () => {
        throw new Error('list exploded');
      }),
    });
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'list exploded'));
  });

  it('surfaces the Error message when a gated action rejects, and a fallback for a non-Error', async () => {
    // Error path: recovery-code retrieval throws an Error.
    const onGetRecoveryCode = vi.fn(async () => {
      throw new Error('recovery exploded');
    });
    const { onNotify } = buildProps({ onGetRecoveryCode });
    openTab('Two-step login');
    fireEvent.click(screen.getByRole('button', { name: 'View Recovery Code' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.input(dialog.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'master-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'recovery exploded'));

    cleanup();
    vi.clearAllMocks();

    // Non-Error path: API-key retrieval rejects with a bare string.
    const { onNotify: onNotify2 } = buildProps({
      onGetApiKey: vi.fn(() => Promise.reject('nope')),
    });
    openTab('Keys');
    fireEvent.click(screen.getByRole('button', { name: 'View API Key' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.input(dialog.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'master-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(onNotify2).toHaveBeenCalledWith('error', t('txt_master_password_is_required_2')),
    );
  });

  it('uses the fallback message when saving YubiKey settings rejects with a non-Error', async () => {
    const onGetYubiKeySettings = vi.fn(async () =>
      yubiSettings({ enabled: true, yubicoConfigured: true, yubicoCanManage: true, yubicoClientId: 'cid-1', keys: ['', '', '', '', ''] }),
    );
    const onSaveYubiKeySettings = vi.fn(() => Promise.reject('bad'));
    const { onNotify } = buildProps({ onGetYubiKeySettings, onSaveYubiKeySettings });
    openProviderManage('Yubico OTP security key');
    const dialog = (await screen.findByText('Yubico validation credentials')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_yubikey_update_failed')));
  });

  it('reports Error and fallback messages when auto-configuring Yubico credentials fails', async () => {
    // Error path.
    const onGetYubiKeySettings = vi.fn(async () => yubiSettings({ yubicoConfigured: false }));
    const onBootstrapErr = vi.fn(async () => {
      throw new Error('bootstrap exploded');
    });
    const first = buildProps({ onGetYubiKeySettings, onBootstrapYubiKeyApiCredentials: onBootstrapErr });
    openProviderManage('Yubico OTP security key');
    let otpField = (await screen.findByText('Yubico validation is not configured'))
      .closest('.yubikey-config-panel')!
      .querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(otpField, { target: { value: 'ccccotp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get and save automatically' }));
    await waitFor(() => expect(first.onNotify).toHaveBeenCalledWith('error', 'bootstrap exploded'));

    cleanup();
    vi.clearAllMocks();

    // Non-Error path.
    const onBootstrapStr = vi.fn(() => Promise.reject('x'));
    const second = buildProps({
      onGetYubiKeySettings: vi.fn(async () => yubiSettings({ yubicoConfigured: false })),
      onBootstrapYubiKeyApiCredentials: onBootstrapStr,
    });
    openProviderManage('Yubico OTP security key');
    otpField = (await screen.findByText('Yubico validation is not configured'))
      .closest('.yubikey-config-panel')!
      .querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(otpField, { target: { value: 'ccccotp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get and save automatically' }));
    await waitFor(() =>
      expect(second.onNotify).toHaveBeenCalledWith('error', t('txt_yubikey_auto_config_failed')),
    );
  });

  it('does not auto-configure when the bootstrap OTP field is empty', async () => {
    const onGetYubiKeySettings = vi.fn(async () => yubiSettings({ yubicoConfigured: false }));
    const onBootstrapYubiKeyApiCredentials = vi.fn(async () => yubiSettings({ yubicoConfigured: true }));
    buildProps({ onGetYubiKeySettings, onBootstrapYubiKeyApiCredentials });
    openProviderManage('Yubico OTP security key');
    await screen.findByText('Yubico validation is not configured');
    // Clicking with no OTP typed hits the early-return guard.
    fireEvent.click(screen.getByRole('button', { name: 'Get and save automatically' }));
    await Promise.resolve();
    expect(onBootstrapYubiKeyApiCredentials).not.toHaveBeenCalled();
  });

  it('reports Error and fallback messages when saving Yubico credentials fails', async () => {
    const baseSettings = () =>
      yubiSettings({
        enabled: true,
        yubicoConfigured: true,
        yubicoCanManage: true,
        yubicoClientId: 'cid-1',
        yubicoSecretKey: 'secret-1',
        keys: ['', '', '', '', ''],
      });
    const errProps = buildProps({
      onGetYubiKeySettings: vi.fn(baseSettings),
      onSaveYubiKeyApiCredentials: vi.fn(async () => {
        throw new Error('cfg exploded');
      }),
    });
    openProviderManage('Yubico OTP security key');
    let dialog = (await screen.findByText('Yubico validation credentials')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'View' }));
    let panel = within(dialog).getByText('Client ID').closest('.settings-vertical-fields') as HTMLElement;
    // Also drive the secret-key field onInput while the panel is open.
    const secretInput = within(panel).getByDisplayValue('secret-1') as HTMLInputElement;
    fireEvent.input(secretInput, { target: { value: 'secret-2' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(errProps.onNotify).toHaveBeenCalledWith('error', 'cfg exploded'));

    cleanup();
    vi.clearAllMocks();

    const strProps = buildProps({
      onGetYubiKeySettings: vi.fn(baseSettings),
      onSaveYubiKeyApiCredentials: vi.fn(() => Promise.reject('x')),
    });
    openProviderManage('Yubico OTP security key');
    dialog = (await screen.findByText('Yubico validation credentials')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'View' }));
    panel = within(dialog).getByText('Client ID').closest('.settings-vertical-fields') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(strProps.onNotify).toHaveBeenCalledWith('error', t('txt_yubikey_config_update_failed')),
    );
  });

  it('reports Error and fallback messages when disabling all YubiKeys fails', async () => {
    const baseSettings = () =>
      yubiSettings({ enabled: true, yubicoConfigured: true, yubicoCanManage: true, yubicoClientId: 'cid-1', keys: ['', '', '', '', ''] });
    const errProps = buildProps({
      onGetYubiKeySettings: vi.fn(baseSettings),
      onDisableYubiKey: vi.fn(async () => {
        throw new Error('disable exploded');
      }),
    });
    openProviderManage('Yubico OTP security key');
    let dialog = (await screen.findByText('Yubico validation credentials')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable all keys' }));
    await waitFor(() => expect(errProps.onNotify).toHaveBeenCalledWith('error', 'disable exploded'));

    cleanup();
    vi.clearAllMocks();

    const strProps = buildProps({
      onGetYubiKeySettings: vi.fn(baseSettings),
      onDisableYubiKey: vi.fn(() => Promise.reject('x')),
    });
    openProviderManage('Yubico OTP security key');
    dialog = (await screen.findByText('Yubico validation credentials')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable all keys' }));
    await waitFor(() => expect(strProps.onNotify).toHaveBeenCalledWith('error', t('txt_disable_yubikey_failed')));
  });

  it('saves Yubico credentials via the dialog form submit when already configured', async () => {
    const onGetYubiKeySettings = vi.fn(async () =>
      yubiSettings({ enabled: true, yubicoConfigured: true, yubicoCanManage: true, yubicoClientId: 'cid-1', keys: ['', '', '', '', ''] }),
    );
    const onSaveYubiKeySettings = vi.fn(async (keys: string[], nfc: boolean) =>
      yubiSettings({ enabled: true, yubicoConfigured: true, keys: keys as any, nfc }),
    );
    buildProps({ onGetYubiKeySettings, onSaveYubiKeySettings });
    openProviderManage('Yubico OTP security key');
    const dialog = (await screen.findByText('Yubico validation credentials')).closest('[role="dialog"]') as HTMLElement;
    // Submitting the configured dialog routes onConfirm -> saveYubiKeyDialog.
    fireEvent.submit(dialog);
    await waitFor(() => expect(onSaveYubiKeySettings).toHaveBeenCalledTimes(1));
  });

  it('reconfigures Yubico credentials from the config panel via the OTP field', async () => {
    const onGetYubiKeySettings = vi.fn(async () =>
      yubiSettings({ enabled: true, yubicoConfigured: true, yubicoCanManage: true, yubicoClientId: 'cid-1', yubicoSecretKey: 'secret-1', keys: ['', '', '', '', ''] }),
    );
    const onBootstrapYubiKeyApiCredentials = vi.fn(async () =>
      yubiSettings({ enabled: true, yubicoConfigured: true, yubicoCanManage: true, yubicoClientId: 'cid-9', keys: ['', '', '', '', ''] }),
    );
    buildProps({ onGetYubiKeySettings, onBootstrapYubiKeyApiCredentials });
    openProviderManage('Yubico OTP security key');
    const dialog = (await screen.findByText('Yubico validation credentials')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'View' }));
    const panel = within(dialog).getByText('Client ID').closest('.settings-vertical-fields') as HTMLElement;
    const otpField = within(panel).getByText('OTP from YubiKey').closest('label')!.querySelector('input') as HTMLInputElement;
    fireEvent.input(otpField, { target: { value: 'CCCC REconfig' } });
    // Normalised to lowercase, no spaces.
    expect(otpField.value).toBe('ccccreconfig');
    fireEvent.click(within(panel).getByRole('button', { name: 'Get again automatically' }));
    await waitFor(() =>
      expect(onBootstrapYubiKeyApiCredentials).toHaveBeenCalledWith('ccccreconfig', 'master-pw'),
    );
  });

  it('reports Error and fallback messages when registering a two-step passkey fails (non-Error)', async () => {
    const onGetTwoFactorPasskeySettings = vi.fn(async () => passkeySettings({ enabled: false, keys: [] }));
    const onCreateTwoFactorPasskey = vi.fn(() => Promise.reject('x'));
    const { onNotify } = buildProps({ onGetTwoFactorPasskeySettings, onCreateTwoFactorPasskey });
    openProviderManage('Passkeys');
    const dialog = (await screen.findByText('Manage passkeys used only for two-step login.')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_passkey_setup_failed')));
  });

  it('reports Error and fallback messages when deleting a two-step passkey fails', async () => {
    const twoKeys = () =>
      passkeySettings({ enabled: true, keys: [{ id: 1, name: 'Key A' }, { id: 2, name: 'Key B' }] });
    const errProps = buildProps({
      onGetTwoFactorPasskeySettings: vi.fn(twoKeys),
      onDeleteTwoFactorPasskey: vi.fn(async () => {
        throw new Error('del exploded');
      }),
    });
    openProviderManage('Passkeys');
    let dialog = (await screen.findByText('Manage passkeys used only for two-step login.')).closest('[role="dialog"]') as HTMLElement;
    let row = within(dialog).getByText('Key A').closest('.account-passkey-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(errProps.onNotify).toHaveBeenCalledWith('error', 'del exploded'));

    cleanup();
    vi.clearAllMocks();

    const strProps = buildProps({
      onGetTwoFactorPasskeySettings: vi.fn(twoKeys),
      onDeleteTwoFactorPasskey: vi.fn(() => Promise.reject('x')),
    });
    openProviderManage('Passkeys');
    dialog = (await screen.findByText('Manage passkeys used only for two-step login.')).closest('[role="dialog"]') as HTMLElement;
    row = within(dialog).getByText('Key A').closest('.account-passkey-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(strProps.onNotify).toHaveBeenCalledWith('error', t('txt_delete_item_failed')));
  });

  it('does not delete the last remaining two-step passkey', async () => {
    const onDeleteTwoFactorPasskey = vi.fn(async () => passkeySettings());
    buildProps({
      onGetTwoFactorPasskeySettings: vi.fn(async () => passkeySettings({ enabled: true, keys: [{ id: 1, name: 'Only Key' }] })),
      onDeleteTwoFactorPasskey,
    });
    openProviderManage('Passkeys');
    const dialog = (await screen.findByText('Manage passkeys used only for two-step login.')).closest('[role="dialog"]') as HTMLElement;
    const row = within(dialog).getByText('Only Key').closest('.account-passkey-row') as HTMLElement;
    // The delete button is disabled for a single key; clicking hits the guard.
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await Promise.resolve();
    expect(onDeleteTwoFactorPasskey).not.toHaveBeenCalled();
  });

  it('reports Error and fallback messages when disabling all two-step passkeys fails', async () => {
    const enabledKeys = () =>
      passkeySettings({ enabled: true, keys: [{ id: 1, name: 'Key A' }, { id: 2, name: 'Key B' }] });
    const errProps = buildProps({
      onGetTwoFactorPasskeySettings: vi.fn(enabledKeys),
      onDisableTwoFactorPasskeys: vi.fn(async () => {
        throw new Error('disable2fa exploded');
      }),
    });
    openProviderManage('Passkeys');
    let dialog = (await screen.findByText('Manage passkeys used only for two-step login.')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable all keys' }));
    await waitFor(() => expect(errProps.onNotify).toHaveBeenCalledWith('error', 'disable2fa exploded'));

    cleanup();
    vi.clearAllMocks();

    const strProps = buildProps({
      onGetTwoFactorPasskeySettings: vi.fn(enabledKeys),
      onDisableTwoFactorPasskeys: vi.fn(() => Promise.reject('x')),
    });
    openProviderManage('Passkeys');
    dialog = (await screen.findByText('Manage passkeys used only for two-step login.')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable all keys' }));
    await waitFor(() =>
      expect(strProps.onNotify).toHaveBeenCalledWith('error', t('txt_disable_passkey_two_step_failed')),
    );
  });

  it('uses the fallback message when refreshing two-factor status rejects with a non-Error', async () => {
    const { onNotify } = buildProps({ onRefreshTwoFactorStatus: vi.fn(() => Promise.reject('x')) });
    openTab('Two-step login');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_load_failed')));
  });

  it('uses the fallback message when enabling TOTP from the manage dialog rejects with a non-Error', async () => {
    const { onNotify } = buildProps({ onEnableTotp: vi.fn(() => Promise.reject('x')) });
    await openTotpManageDialog();
    const codeInput = screen.getByText('Verification Code').closest('label')!.querySelector('input')!;
    fireEvent.input(codeInput, { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable TOTP' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_enable_totp_failed')));
  });

  it('uses the fallback message when creating an account passkey rejects with a non-Error', async () => {
    const { onNotify } = buildProps({ onCreateAccountPasskey: vi.fn(() => Promise.reject('x')) });
    openTab('Master Password');
    fireEvent.click(screen.getByRole('button', { name: 'Add account passkey' }));
    const prompt = await screen.findByRole('dialog');
    fireEvent.input(prompt.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'master-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const nameDialog = (await screen.findByText('Passkey created. Name it to help you recognize it.'))
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(nameDialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith('error', t('txt_account_passkeys_load_failed')),
    );
  });

  // ---- Misc guard / render branches ----

  it('does not reload when the selected locale matches the current one', async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    buildProps();
    const select = screen.getByDisplayValue('English') as HTMLSelectElement;
    // Selecting the already-active locale is a no-op.
    fireEvent.input(select, { target: { value: 'en' } });
    await Promise.resolve();
    expect(setLocale).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('clears legacy TOTP setup secrets from localStorage on mount', () => {
    window.localStorage.setItem('nodewarden.totp.secret.abc', 'legacy');
    window.localStorage.setItem('unrelated.key', 'keep');
    buildProps();
    expect(window.localStorage.getItem('nodewarden.totp.secret.abc')).toBeNull();
    expect(window.localStorage.getItem('unrelated.key')).toBe('keep');
  });

  it('starts with an empty hint when the profile has no master-password hint', () => {
    buildProps({ profile: { ...profile, masterPasswordHint: undefined } });
    openTab('Master Password');
    const hintInput = screen
      .getByText(t('txt_password_hint_optional'))
      .closest('label')!
      .querySelector('input') as HTMLInputElement;
    expect(hintInput.value).toBe('');
  });

  it('renders direct-unlock and prf-not-supported passkey statuses and dash dates', async () => {
    const passkeys: AccountPasskeyCredential[] = [
      { id: 'pk-direct', name: 'Direct Key', prfStatus: 0, creationDate: null as unknown as string },
      { id: 'pk-none', name: 'Legacy Key', prfStatus: 2, creationDate: 'not-a-real-date' },
    ];
    buildProps({ onListAccountPasskeys: vi.fn(async () => passkeys) });
    openTab('Master Password');
    expect(await screen.findByText('Direct Key')).toBeInTheDocument();
    // prfStatus 0 -> direct-unlock label; prfStatus 2 -> not-supported label.
    expect(screen.getByText(t('txt_direct_unlock'))).toBeInTheDocument();
    expect(screen.getByText(t('txt_prf_not_supported'))).toBeInTheDocument();
    // Both an absent and an invalid creation date render as the dash placeholder
    // inside the "Created: -" line.
    const createdDash = t('txt_created_value', { value: t('txt_dash') });
    expect(screen.getAllByText(createdDash).length).toBeGreaterThanOrEqual(2);
  });

  it('regenerates and edits the TOTP secret from the manage dialog', async () => {
    buildProps();
    await openTotpManageDialog();
    const secretInput = screen
      .getByText('Authenticator Key')
      .closest('label')!
      .querySelector('input') as HTMLInputElement;
    // Editing lower-cases input to upper-case.
    fireEvent.input(secretInput, { target: { value: 'abcдef'.replace('д', 'd') } });
    expect(secretInput.value).toBe('ABCDEF');

    const before = secretInput.value;
    fireEvent.click(screen.getByRole('button', { name: t('txt_regenerate') }));
    const after = (screen
      .getByText('Authenticator Key')
      .closest('label')!
      .querySelector('input') as HTMLInputElement).value;
    // Regenerate replaces the secret with a fresh 32-char base32 value.
    expect(after).toHaveLength(32);
    expect(after).not.toBe(before);

    // The copy-secret control is present and clickable.
    fireEvent.click(screen.getByRole('button', { name: t('txt_copy_secret') }));
  });

  it('opens the API key dialog and supports copy, focus-select and close', async () => {
    buildProps();
    openTab('Keys');
    fireEvent.click(screen.getByRole('button', { name: 'View API Key' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.input(dialog.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'master-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // The credentials dialog opens with the client-secret value visible.
    const keyDialog = (await screen.findByText(t('txt_oauth_client_credentials'))).closest('[role="dialog"]') as HTMLElement;
    const secretRow = within(keyDialog).getByDisplayValue('api-secret-key') as HTMLInputElement;
    fireEvent.focus(secretRow);
    // Copy one of the credential values.
    fireEvent.click(within(keyDialog).getAllByRole('button', { name: 'Copy' })[1]);
    // Close via the confirm ("Close") button.
    fireEvent.click(within(keyDialog).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByText(t('txt_oauth_client_credentials'))).not.toBeInTheDocument(),
    );
  });
});
