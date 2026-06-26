import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/preact';
import type { AccountPasskeyCredential, Profile } from '@/lib/types';

// Mock i18n: keep real t()/getLocale (English) but stub setLocale so changeLocale
// does not perform a real async locale swap. window.location.reload is stubbed below.
vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual<typeof import('@/lib/i18n')>('@/lib/i18n');
  return { ...actual, setLocale: vi.fn(async () => {}) };
});

// PendingAuthRequestsPanel is an unrelated child; render a marker so we can assert
// SettingsPage wires it in without pulling its internals into these tests.
vi.mock('@/components/PendingAuthRequestsPanel', () => ({
  default: () => <div data-testid="pending-auth-panel" />,
}));

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
    onRefreshPendingAuthRequests: vi.fn(async () => {}),
    onApproveAuthRequest: vi.fn(async () => {}),
    onDenyAuthRequest: vi.fn(async () => {}),
    onLockTimeoutChange: vi.fn(),
    onSessionTimeoutActionChange: vi.fn(),
    onNotify: vi.fn(),
  };
  const props = {
    profile,
    totpEnabled: false,
    lockTimeoutMinutes: 15 as const,
    sessionTimeoutAction: 'lock' as const,
    pendingAuthRequests: [],
    pendingAuthRequestsLoading: false,
    ...callbacks,
    ...overrides,
  };
  render(<SettingsPage {...props} />);
  return { ...callbacks, ...overrides };
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
    expect(screen.getByRole('heading', { name: 'Session timeout' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Change Master Password' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TOTP' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account passkeys' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recovery Code' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'API Key' })).toBeInTheDocument();
  });

  it('fires onLockTimeoutChange when the session timeout select changes', () => {
    const { onLockTimeoutChange } = buildProps();
    const select = screen.getByDisplayValue('15 minutes') as HTMLSelectElement;
    fireEvent.input(select, { target: { value: '30' } });
    expect(onLockTimeoutChange).toHaveBeenCalledWith(30);
  });

  it('fires onSessionTimeoutActionChange when the timeout action changes', () => {
    const { onSessionTimeoutActionChange } = buildProps();
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
    const inputs = document.querySelectorAll('input[type="password"]');
    fireEvent.input(inputs[0], { target: { value: 'old-pass' } });
    fireEvent.input(inputs[1], { target: { value: 'new-pass' } });
    fireEvent.input(inputs[2], { target: { value: 'new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(onChangePassword).toHaveBeenCalledWith('old-pass', 'new-pass', 'new-pass');
  });

  it('fires onSavePasswordHint with the hint value', () => {
    const { onSavePasswordHint } = buildProps();
    fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }));
    expect(onSavePasswordHint).toHaveBeenCalledWith('my hint');
  });

  it('opens the master-password prompt and calls onEnableTotp on confirm', async () => {
    const { onEnableTotp, onNotify } = buildProps();
    const codeInput = screen.getByText('Verification Code').closest('label')!.querySelector('input')!;
    fireEvent.input(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable TOTP' }));

    // Prompt dialog appears.
    const dialog = await screen.findByRole('dialog');
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onEnableTotp).toHaveBeenCalledTimes(1));
    expect(onEnableTotp).toHaveBeenCalledWith(expect.any(String), '123456', 'master-pw');
    expect(onNotify).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('notifies an error when enabling TOTP without a verification code', () => {
    const { onEnableTotp, onNotify } = buildProps();
    fireEvent.click(screen.getByRole('button', { name: 'Enable TOTP' }));
    expect(onEnableTotp).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('fires onOpenDisableTotp when TOTP is enabled and disable is clicked', () => {
    const { onOpenDisableTotp } = buildProps({ totpEnabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Disable TOTP' }));
    expect(onOpenDisableTotp).toHaveBeenCalledTimes(1);
  });

  it('calls onGetRecoveryCode through the master-password prompt', async () => {
    const { onGetRecoveryCode } = buildProps();
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
    fireEvent.click(screen.getByRole('button', { name: 'View API Key' }));
    const dialog = await screen.findByRole('dialog');
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onGetApiKey).toHaveBeenCalledWith('master-pw'));
  });

  it('requires confirmation before rotating the API key', async () => {
    const { onRotateApiKey } = buildProps();
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

  it('calls onCreateAccountPasskey through the prompt', async () => {
    const { onCreateAccountPasskey } = buildProps();
    fireEvent.click(screen.getByRole('button', { name: 'Add account passkey' }));
    const dialog = await screen.findByRole('dialog');
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'master-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
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
    expect(await screen.findByText('No account passkeys')).toBeInTheDocument();
  });

  it('refreshes account passkeys on initial load and via the refresh button', async () => {
    const onListAccountPasskeys = vi.fn(async (): Promise<AccountPasskeyCredential[]> => []);
    buildProps({ onListAccountPasskeys });
    await waitFor(() => expect(onListAccountPasskeys).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(onListAccountPasskeys).toHaveBeenCalledTimes(2));
  });
});
