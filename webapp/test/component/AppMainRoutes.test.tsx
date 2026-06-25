import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { createWouterMock } from './helpers/wouterMock';

// Real wouter resolves its internal `react` import to the real React under the
// jsdom test config (no renderer -> crash), so we swap it for a faithful preact
// implementation that preserves Switch/Route/Link semantics. See the helper.
vi.mock('wouter', () => createWouterMock());

// AppMainRoutes wires wouter <Route>s to lazily-imported page components. We mock
// every page component with a lightweight marker that echoes a few of the props it
// receives, so these tests focus purely on the shell's own orchestration: which
// page renders for a given route, the admin/profile conditional branches, and that
// the right props thread through. The real pages (and their heavy dependency trees)
// are never loaded, which also sidesteps the Suspense/lazy boundaries.

vi.mock('@/components/VaultPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="vault-page" data-loading={String(p.loading)} data-error={String(p.error)} data-email={String(p.emailForReprompt)} />
  ),
}));
vi.mock('@/components/SendsPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="sends-page" data-loading={String(p.loading)} data-count={String((p.sends as unknown[]).length)} />
  ),
}));
vi.mock('@/components/TotpCodesPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="totp-page" data-loading={String(p.loading)} data-count={String((p.ciphers as unknown[]).length)} />
  ),
}));
vi.mock('@/components/SettingsPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="settings-page" data-totp={String(p.totpEnabled)} />
  ),
}));
vi.mock('@/components/DomainRulesPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="domain-rules-page" data-loading={String(p.loading)} />
  ),
}));
vi.mock('@/components/SecurityDevicesPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="security-devices-page" data-count={String((p.devices as unknown[]).length)} />
  ),
}));
vi.mock('@/components/AdminPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="admin-page" data-current={String(p.currentUserId)} data-users={String((p.users as unknown[]).length)} />
  ),
}));
vi.mock('@/components/LogCenterPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="log-center-page" data-mobile={String(p.mobileLayout)} />
  ),
}));
vi.mock('@/components/BackupCenterPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="backup-center-page" data-current={String(p.currentUserId)} />
  ),
}));
vi.mock('@/components/ImportPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="import-page" data-keys={p.accountKeys ? 'yes' : 'no'} data-folders={String((p.folders as unknown[]).length)} />
  ),
}));

import AppMainRoutes from '@/components/AppMainRoutes';
import type { AppMainRoutesProps } from '@/components/AppMainRoutes';
import type { Cipher, Folder as VaultFolder, Profile, SessionState } from '@/lib/types';

const adminProfile: Profile = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  key: 'enc-key',
  masterPasswordHint: '',
  role: 'admin',
};

const userProfile: Profile = { ...adminProfile, id: 'user-1', email: 'user@example.com', role: 'user' };

const session: SessionState = {
  email: 'user@example.com',
  symEncKey: 'enc-b64',
  symMacKey: 'mac-b64',
} as unknown as SessionState;

function makeCipher(id: string): Cipher {
  return { id, type: 1, name: id } as unknown as Cipher;
}
function makeFolder(id: string): VaultFolder {
  return { id, name: id } as unknown as VaultFolder;
}

// A no-op async function reused for every Promise-returning callback.
const asyncNoop = async () => undefined as never;

function buildProps(overrides: Partial<AppMainRoutesProps> = {}): AppMainRoutesProps {
  const props = {
    profile: userProfile,
    profileLoading: false,
    session,
    mobileLayout: false,
    mobileSidebarToggleKey: 0,
    importRoute: '/tools/import-export',
    settingsHomeRoute: '/settings',
    settingsAccountRoute: '/settings/account',
    decryptedCiphers: [makeCipher('c1'), makeCipher('c2')],
    decryptedFolders: [makeFolder('f1')],
    decryptedSends: [],
    vaultError: '',
    ciphersLoading: false,
    foldersLoading: false,
    sendsLoading: false,
    users: [],
    invites: [],
    adminLoading: false,
    adminError: '',
    totpEnabled: false,
    lockTimeoutMinutes: 15 as const,
    sessionTimeoutAction: 'lock' as const,
    authorizedDevices: [],
    authorizedDevicesLoading: false,
    authorizedDevicesError: '',
    domainRules: null,
    domainRulesLoading: false,
    domainRulesError: '',
    onNavigate: vi.fn(),
    onLogout: vi.fn(),
    onNotify: vi.fn(),
    onImport: vi.fn(asyncNoop),
    onImportEncryptedRaw: vi.fn(asyncNoop),
    onExport: vi.fn(asyncNoop),
    onCreateVaultItem: vi.fn(asyncNoop),
    onUpdateVaultItem: vi.fn(asyncNoop),
    onDeleteVaultItem: vi.fn(asyncNoop),
    onArchiveVaultItem: vi.fn(asyncNoop),
    onUnarchiveVaultItem: vi.fn(asyncNoop),
    onRestoreVaultItems: vi.fn(asyncNoop),
    onBulkDeleteVaultItems: vi.fn(asyncNoop),
    onBulkPermanentDeleteVaultItems: vi.fn(asyncNoop),
    onBulkRestoreVaultItems: vi.fn(asyncNoop),
    onBulkArchiveVaultItems: vi.fn(asyncNoop),
    onBulkUnarchiveVaultItems: vi.fn(asyncNoop),
    onBulkMoveVaultItems: vi.fn(asyncNoop),
    onVerifyMasterPassword: vi.fn(asyncNoop),
    onCreateFolder: vi.fn(asyncNoop),
    onRenameFolder: vi.fn(asyncNoop),
    onDeleteFolder: vi.fn(asyncNoop),
    onBulkDeleteFolders: vi.fn(asyncNoop),
    onDownloadVaultAttachment: vi.fn(asyncNoop),
    downloadingAttachmentKey: '',
    attachmentDownloadPercent: null,
    uploadingAttachmentName: '',
    attachmentUploadPercent: null,
    onRefreshVault: vi.fn(asyncNoop),
    onCreateSend: vi.fn(asyncNoop),
    onUpdateSend: vi.fn(asyncNoop),
    onDeleteSend: vi.fn(asyncNoop),
    onBulkDeleteSends: vi.fn(asyncNoop),
    uploadingSendFileName: '',
    sendUploadPercent: null,
    onChangePassword: vi.fn(asyncNoop),
    onSavePasswordHint: vi.fn(asyncNoop),
    onEnableTotp: vi.fn(asyncNoop),
    onOpenDisableTotp: vi.fn(),
    onGetRecoveryCode: vi.fn(async () => 'r'),
    onGetApiKey: vi.fn(async () => 'k'),
    onRotateApiKey: vi.fn(async () => 'k'),
    onListAccountPasskeys: vi.fn(async () => []),
    onCreateAccountPasskey: vi.fn(async () => null),
    onEnableAccountPasskeyDirectUnlock: vi.fn(asyncNoop),
    onDeleteAccountPasskey: vi.fn(asyncNoop),
    pendingAuthRequests: [],
    pendingAuthRequestsLoading: false,
    onRefreshPendingAuthRequests: vi.fn(asyncNoop),
    onApproveAuthRequest: vi.fn(asyncNoop),
    onDenyAuthRequest: vi.fn(asyncNoop),
    onLockTimeoutChange: vi.fn(),
    onSessionTimeoutActionChange: vi.fn(),
    onRefreshAuthorizedDevices: vi.fn(asyncNoop),
    onRefreshDomainRules: vi.fn(),
    onSaveDomainRules: vi.fn(asyncNoop),
    onRenameAuthorizedDevice: vi.fn(asyncNoop),
    onRevokeDeviceTrust: vi.fn(),
    onTrustDevicePermanently: vi.fn(),
    onRemoveDevice: vi.fn(),
    onRevokeAllDeviceTrust: vi.fn(),
    onRemoveAllDevices: vi.fn(),
    onCreateInvite: vi.fn(asyncNoop),
    onRefreshAdmin: vi.fn(),
    onDeleteAllInvites: vi.fn(asyncNoop),
    onToggleUserStatus: vi.fn(asyncNoop),
    onDeleteUser: vi.fn(asyncNoop),
    onRevokeInvite: vi.fn(asyncNoop),
    onLoadAuditLogs: vi.fn(asyncNoop),
    onLoadAuditLogSettings: vi.fn(asyncNoop),
    onSaveAuditLogSettings: vi.fn(asyncNoop),
    onClearAuditLogs: vi.fn(asyncNoop),
    onExportBackup: vi.fn(asyncNoop),
    onImportBackup: vi.fn(asyncNoop),
    onImportBackupAllowingChecksumMismatch: vi.fn(asyncNoop),
    onLoadBackupSettings: vi.fn(asyncNoop),
    onSaveBackupSettings: vi.fn(asyncNoop),
    onRunRemoteBackup: vi.fn(asyncNoop),
    onListRemoteBackups: vi.fn(asyncNoop),
    onDownloadRemoteBackup: vi.fn(asyncNoop),
    onInspectRemoteBackup: vi.fn(asyncNoop),
    onDeleteRemoteBackup: vi.fn(asyncNoop),
    onRestoreRemoteBackup: vi.fn(asyncNoop),
    onRestoreRemoteBackupAllowingChecksumMismatch: vi.fn(asyncNoop),
  } as unknown as AppMainRoutesProps;
  return { ...props, ...overrides };
}

// wouter's default browser-location hook reads window.location.pathname; set the
// URL before render so the matching <Route> renders. findByTestId awaits the
// Suspense boundary resolving the (mocked) lazy page.
function navigate(path: string) {
  window.history.pushState(null, '', path);
}

beforeEach(() => {
  navigate('/');
});

afterEach(() => {
  navigate('/');
});

describe('AppMainRoutes', () => {
  it('renders the vault page at /vault and threads loading/error/email props', async () => {
    navigate('/vault');
    render(<AppMainRoutes {...buildProps({ vaultError: 'boom', ciphersLoading: true })} />);
    const page = await screen.findByTestId('vault-page');
    expect(page).toBeInTheDocument();
    // loading is the OR of ciphers/folders loading.
    expect(page).toHaveAttribute('data-loading', 'true');
    expect(page).toHaveAttribute('data-error', 'boom');
    expect(page).toHaveAttribute('data-email', 'user@example.com');
  });

  it('falls back to session email for the vault reprompt when profile is null', async () => {
    navigate('/vault');
    render(<AppMainRoutes {...buildProps({ profile: null })} />);
    const page = await screen.findByTestId('vault-page');
    expect(page).toHaveAttribute('data-email', 'user@example.com');
  });

  it('renders the sends page at /sends with the sends collection', async () => {
    navigate('/sends');
    render(<AppMainRoutes {...buildProps({ decryptedSends: [{ id: 's1' } as never], sendsLoading: true })} />);
    const page = await screen.findByTestId('sends-page');
    expect(page).toHaveAttribute('data-count', '1');
    expect(page).toHaveAttribute('data-loading', 'true');
  });

  it('renders the totp codes page at /vault/totp (not the vault page)', async () => {
    navigate('/vault/totp');
    render(<AppMainRoutes {...buildProps()} />);
    const page = await screen.findByTestId('totp-page');
    expect(page).toHaveAttribute('data-count', '2');
    expect(screen.queryByTestId('vault-page')).not.toBeInTheDocument();
  });

  it('renders settings page at the account route when a profile exists', async () => {
    navigate('/settings/account');
    render(<AppMainRoutes {...buildProps({ totpEnabled: true })} />);
    const page = await screen.findByTestId('settings-page');
    expect(page).toHaveAttribute('data-totp', 'true');
  });

  it('shows a loading skeleton (no settings page) when profile is null but loading', () => {
    navigate('/settings/account');
    render(<AppMainRoutes {...buildProps({ profile: null, profileLoading: true })} />);
    expect(screen.queryByTestId('settings-page')).not.toBeInTheDocument();
  });

  it('renders nothing for the account route when profile is null and not loading', () => {
    navigate('/settings/account');
    const { container } = render(<AppMainRoutes {...buildProps({ profile: null, profileLoading: false })} />);
    expect(screen.queryByTestId('settings-page')).not.toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('renders the mobile settings menu at /settings, with admin links only for admins', () => {
    navigate('/settings');
    const { rerender } = render(<AppMainRoutes {...buildProps({ profile: userProfile })} />);
    // Non-admin: admin panel / log center / backup links are absent.
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();

    rerender(<AppMainRoutes {...buildProps({ profile: adminProfile })} />);
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(screen.getByText('Log Center')).toBeInTheDocument();
  });

  it('fires onLogout from the mobile settings sign-out button', async () => {
    const { fireEvent } = await import('@testing-library/preact');
    navigate('/settings');
    const onLogout = vi.fn();
    render(<AppMainRoutes {...buildProps({ onLogout })} />);
    fireEvent.click(screen.getByText('Sign Out'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('renders the security devices page on both the canonical and legacy device routes', async () => {
    navigate('/security/devices');
    const { unmount } = render(<AppMainRoutes {...buildProps({ authorizedDevices: [{ id: 'd1' } as never] })} />);
    expect(await screen.findByTestId('security-devices-page')).toHaveAttribute('data-count', '1');
    unmount();

    navigate('/settings/security/device-management');
    render(<AppMainRoutes {...buildProps({ authorizedDevices: [{ id: 'd1' } as never, { id: 'd2' } as never] })} />);
    expect(await screen.findByTestId('security-devices-page')).toHaveAttribute('data-count', '2');
  });

  it('renders the domain rules page at /settings/domain-rules', async () => {
    navigate('/settings/domain-rules');
    render(<AppMainRoutes {...buildProps({ domainRulesLoading: true })} />);
    expect(await screen.findByTestId('domain-rules-page')).toHaveAttribute('data-loading', 'true');
  });

  it('renders the admin page at /admin regardless of role and threads currentUserId', async () => {
    navigate('/admin');
    render(<AppMainRoutes {...buildProps({ profile: adminProfile, users: [{ id: 'u' } as never] })} />);
    const page = await screen.findByTestId('admin-page');
    expect(page).toHaveAttribute('data-current', 'admin-1');
    expect(page).toHaveAttribute('data-users', '1');
  });

  it('gates the log center behind admin: renders for admin, nothing for a user', async () => {
    navigate('/logs');
    const { unmount } = render(<AppMainRoutes {...buildProps({ profile: adminProfile, mobileLayout: true })} />);
    expect(await screen.findByTestId('log-center-page')).toHaveAttribute('data-mobile', 'true');
    unmount();

    navigate('/logs');
    render(<AppMainRoutes {...buildProps({ profile: userProfile })} />);
    expect(screen.queryByTestId('log-center-page')).not.toBeInTheDocument();
  });

  it('gates the backup center behind admin', async () => {
    navigate('/backup');
    const { unmount } = render(<AppMainRoutes {...buildProps({ profile: adminProfile })} />);
    expect(await screen.findByTestId('backup-center-page')).toHaveAttribute('data-current', 'admin-1');
    unmount();

    navigate('/backup');
    render(<AppMainRoutes {...buildProps({ profile: userProfile })} />);
    expect(screen.queryByTestId('backup-center-page')).not.toBeInTheDocument();
  });

  it('renders the import page on the configured import route and threads account keys + folders', async () => {
    navigate('/tools/import-export');
    render(<AppMainRoutes {...buildProps()} />);
    const page = await screen.findByTestId('import-page');
    expect(page).toHaveAttribute('data-keys', 'yes');
    expect(page).toHaveAttribute('data-folders', '1');
  });

  it('passes null account keys to import when the session lacks sym keys', async () => {
    navigate('/import');
    render(<AppMainRoutes {...buildProps({ session: { email: 'x' } as unknown as SessionState })} />);
    const page = await screen.findByTestId('import-page');
    expect(page).toHaveAttribute('data-keys', 'no');
  });

  it('redirects the legacy /help route to /backup via onNavigate', () => {
    navigate('/help');
    const onNavigate = vi.fn();
    render(<AppMainRoutes {...buildProps({ onNavigate })} />);
    expect(onNavigate).toHaveBeenCalledWith('/backup');
  });

  it('renders nothing matchable for an unknown route', () => {
    navigate('/totally-unknown');
    const { container } = render(<AppMainRoutes {...buildProps()} />);
    expect(container.textContent).toBe('');
  });
});
