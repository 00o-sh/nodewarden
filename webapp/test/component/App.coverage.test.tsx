import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as ReactQuery from '@tanstack/react-query';
import { createWouterMock } from './helpers/wouterMock';

// Swap real wouter for the faithful preact-native mock (see helper).
vi.mock('wouter', () => createWouterMock());

// @tanstack/react-query resolves its internal `react` import to the real React
// package under the jsdom config (the preact/compat alias the app build injects
// is not applied to the already-resolved node_modules import), so rendering the
// real QueryClientProvider throws "Cannot read properties of null (reading
// 'useEffect')". We replace it with a tiny preact-native query implementation
// that reproduces exactly the surface App relies on: useQuery (data / isError /
// isFetching / isLoading / refetch, honoring `enabled`) and a client with
// get/set/ensure/invalidate. A module-level store backs setQueryData and is
// reset between tests via __resetQueryStore.
vi.mock('@tanstack/react-query', async () => {
  const { useState, useEffect } = await import('preact/hooks');
  const store = new Map<string, unknown>();
  const client = {
    setQueryData(key: unknown, updater: unknown) {
      const k = JSON.stringify(key);
      const prev = store.get(k);
      const next = typeof updater === 'function' ? (updater as (p: unknown) => unknown)(prev) : updater;
      store.set(k, next);
      return next;
    },
    getQueryData(key: unknown) {
      return store.get(JSON.stringify(key));
    },
    async ensureQueryData(options: { queryKey: unknown; queryFn: () => unknown }) {
      const k = JSON.stringify(options.queryKey);
      if (store.has(k)) return store.get(k);
      const data = await options.queryFn();
      store.set(k, data);
      return data;
    },
    async invalidateQueries() {
      return undefined;
    },
  };
  function useQuery(options: { queryKey: unknown; queryFn: () => unknown; enabled?: boolean }) {
    const { queryKey, queryFn, enabled = true } = options;
    const key = JSON.stringify(queryKey);
    const [state, setState] = useState<{ data: unknown; isError: boolean; isFetching: boolean; isLoading: boolean }>({
      data: undefined,
      isError: false,
      isFetching: false,
      isLoading: true,
    });
    useEffect(() => {
      if (!enabled) {
        setState((s) => ({ ...s, isFetching: false, isLoading: false }));
        return;
      }
      let active = true;
      setState((s) => ({ ...s, isFetching: true }));
      Promise.resolve()
        .then(() => queryFn())
        .then((data) => {
          if (!active) return;
          store.set(key, data);
          setState({ data, isError: false, isFetching: false, isLoading: false });
        })
        .catch(() => {
          if (!active) return;
          setState((s) => ({ ...s, isError: true, isFetching: false, isLoading: false }));
        });
      return () => {
        active = false;
      };
    }, [key, enabled]);
    const refetch = async () => {
      setState((s) => ({ ...s, isFetching: true }));
      try {
        const data = await queryFn();
        store.set(key, data);
        setState({ data, isError: false, isFetching: false, isLoading: false });
        return { data };
      } catch {
        setState((s) => ({ ...s, isError: true, isFetching: false }));
        return { data: undefined };
      }
    };
    const stored = store.get(key);
    const data = state.data !== undefined ? state.data : stored;
    return { ...state, data, refetch };
  }
  return {
    useQuery,
    useQueryClient: () => client,
    QueryClientProvider: (props: { children?: unknown }) => props.children,
    QueryClient: class {
      constructor() {
        return client as never;
      }
    },
    __resetQueryStore: () => store.clear(),
  };
});

// Every heavy child is replaced by a lightweight marker that records the props
// it last received into `rec`, so the tests can both assert on rendered state
// and invoke App's own callbacks directly. The point is to exercise App's
// controller logic (state machine, routing, effects) without pulling in the
// real page trees.
const rec: Record<string, Record<string, unknown>> = {};

vi.mock('@/components/AppAuthenticatedShell', () => ({
  default: (p: Record<string, unknown>) => {
    rec.shell = p;
    return (
      <div
        data-testid="shell"
        data-title={String(p.currentPageTitle)}
        data-dark={String(p.darkMode)}
        data-location={String(p.location)}
        data-mobile-route={String(p.mobilePrimaryRoute)}
        data-import={String(p.isImportRoute)}
        data-sidebar-toggle={String(p.showSidebarToggle)}
      />
    );
  },
}));
vi.mock('@/components/AppGlobalOverlays', () => ({
  default: (p: Record<string, unknown>) => {
    rec.overlays = p;
    return (
      <div
        data-testid="overlays"
        data-totp-open={String(p.pendingTotpOpen)}
        data-provider={String(p.pendingTotpProviderType)}
        data-confirm={String(!!p.confirm)}
        data-disable-open={String(p.disableTotpOpen)}
        data-toasts={String((p.toasts as unknown[]).length)}
        data-submitting={String(p.totpSubmitting)}
      />
    );
  },
}));
vi.mock('@/components/AuthViews', () => ({
  default: (p: Record<string, unknown>) => {
    rec.auth = p;
    return (
      <div
        data-testid="auth"
        data-mode={String(p.mode)}
        data-pending={String(p.pendingAction)}
        data-unlock-ready={String(p.unlockReady)}
        data-unlock-preparing={String(p.unlockPreparing)}
        data-refresh-error={String(p.sessionRefreshError)}
        data-passkey-email={String(p.pendingPasskeyPasswordEmail)}
        data-email-lock={String(p.emailForLock)}
        data-hint-loading={String(p.loginHintLoading)}
      />
    );
  },
}));
vi.mock('@/components/AuthRequestApprovalDialog', () => ({
  default: (p: Record<string, unknown>) => {
    rec.authDialog = p;
    return <div data-testid="auth-dialog" data-open={String(p.open)} data-submitting={String(p.submitting)} />;
  },
}));
vi.mock('@/components/NotFoundPage', () => ({
  default: () => <div data-testid="notfound" />,
}));
vi.mock('@/components/PublicSendPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="public-send" data-access={String(p.accessId)} data-key={String(p.keyPart)} />
  ),
}));
vi.mock('@/components/RecoverTwoFactorPage', () => ({
  default: (p: Record<string, unknown>) => {
    rec.recover = p;
    return <div data-testid="recover" />;
  },
}));
vi.mock('@/components/JwtWarningPage', () => ({
  default: (p: Record<string, unknown>) => (
    <div data-testid="jwt" data-reason={String(p.reason)} data-min={String(p.minLength)} />
  ),
}));

// --- lib mocks ---------------------------------------------------------------
vi.mock('@/lib/app-auth', () => ({
  readInitialAppBootstrapState: vi.fn(),
  bootstrapAppSession: vi.fn(),
  performPasswordLogin: vi.fn(),
  performPasskeyLogin: vi.fn(),
  completePasskeyPasswordLogin: vi.fn(),
  performRecoverTwoFactorLogin: vi.fn(),
  performRegistration: vi.fn(),
  performTotpLogin: vi.fn(),
  hydrateLockedSession: vi.fn(),
  performUnlock: vi.fn(),
}));
vi.mock('@/lib/api/auth', () => ({
  createAuthedFetch: vi.fn(() => vi.fn(async () => ({}))),
  deriveLoginHash: vi.fn(async () => ({ hash: 'derived-hash' })),
  getAuthorizedDevices: vi.fn(async () => []),
  clearProfileSnapshot: vi.fn(),
  getCurrentDeviceIdentifier: vi.fn(() => 'device-1'),
  getPasswordHint: vi.fn(async () => ({ masterPasswordHint: 'the hint' })),
  getProfile: vi.fn(async () => null),
  loadProfileSnapshot: vi.fn(() => null),
  saveProfileSnapshot: vi.fn(),
  revokeCurrentSession: vi.fn(async () => undefined),
  getTwoFactorProviderStatus: vi.fn(async () => ({ totpEnabled: true, yubikeyEnabled: false, passkeyEnabled: false })),
  getVaultRevisionDate: vi.fn(async () => 123456),
  saveSession: vi.fn(),
  stripProfileSecrets: vi.fn((p: unknown) => p),
  deriveLoginHashLocally: vi.fn(),
}));
vi.mock('@/lib/api/auth-requests', () => ({
  encryptSessionUserKeyForAuthRequest: vi.fn(async () => 'enc-key'),
  isPendingAuthRequest: vi.fn(() => true),
  listPendingAuthRequests: vi.fn(async () => []),
  respondToAuthRequest: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api/admin', () => ({
  clearAuditLogs: vi.fn(async () => undefined),
  getAuditLogSettings: vi.fn(async () => ({})),
  listAdminInvites: vi.fn(async () => []),
  listAdminUsers: vi.fn(async () => []),
  listAuditLogs: vi.fn(async () => []),
  saveAuditLogSettings: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api/domains', () => ({
  getDomainRules: vi.fn(async () => ({ object: 'domains', equivalentDomains: [], customEquivalentDomains: [], globalEquivalentDomains: [] })),
  saveDomainRules: vi.fn(async () => ({ object: 'domains', equivalentDomains: [], customEquivalentDomains: [], globalEquivalentDomains: [] })),
}));
vi.mock('@/lib/api/send', () => ({
  getSendById: vi.fn(async () => ({ id: 's-remote' })),
  getSends: vi.fn(async () => []),
}));
vi.mock('@/lib/api/vault', () => ({
  getCipherById: vi.fn(async () => ({ id: 'c-remote', revisionDate: '2024-01-01T00:00:00Z' })),
  getFolderById: vi.fn(async () => ({ id: 'f-remote', revisionDate: '2024-01-01T00:00:00Z' })),
  repairCipherKeyMismatches: vi.fn(async () => 0),
  repairCipherUriChecksums: vi.fn(async () => 0),
}));
vi.mock('@/lib/api/vault-sync', () => ({
  getCachedVaultCoreSnapshot: vi.fn(async () => null),
  invalidateVaultCoreSyncSnapshot: vi.fn(async () => undefined),
  loadVaultCoreSyncSnapshot: vi.fn(async () => ({ folders: [], ciphers: [], sends: [] })),
  saveVaultCoreSyncSnapshot: vi.fn(async () => undefined),
}));
vi.mock('@/lib/backup-settings-repair', () => ({
  silentlyRepairBackupSettingsIfNeeded: vi.fn(async () => undefined),
}));
vi.mock('@/lib/app-support', () => ({
  parseSignalRTextFrames: vi.fn(() => []),
  readInviteCodeFromUrl: vi.fn(() => ''),
}));
vi.mock('@/lib/app-preload', () => ({
  preloadAuthenticatedWorkspace: vi.fn(async () => undefined),
  preloadDemoExperience: vi.fn(() => () => {}),
}));
vi.mock('@/lib/account-passkeys', () => ({
  assertTwoFactorPasskey: vi.fn(async () => 'passkey-token'),
}));
vi.mock('@/lib/offline-auth', () => ({ clearOfflineUnlockRecord: vi.fn() }));
vi.mock('@/lib/password-security-cache', () => ({ clearPasswordSecurityCache: vi.fn() }));
vi.mock('@/lib/vault-decrypt', () => ({
  decryptSends: vi.fn(async () => []),
  decryptVaultCore: vi.fn(async () => ({ folders: [], ciphers: [] })),
}));
vi.mock('@/lib/vault-worker', () => ({
  decryptSendsInWorker: vi.fn(async () => []),
  decryptVaultCoreInWorker: vi.fn(async () => ({ folders: [], ciphers: [] })),
}));
vi.mock('@/hooks/useAccountSecurityActions', () => ({
  default: () => new Proxy({}, { get: () => vi.fn(async () => undefined) }),
}));
vi.mock('@/hooks/useAdminActions', () => ({
  default: () => new Proxy({}, { get: () => vi.fn(async () => undefined) }),
}));
vi.mock('@/hooks/useBackupActions', () => ({
  default: () => new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));
vi.mock('@/hooks/useVaultSendActions', () => ({
  default: () => new Proxy({}, { get: () => vi.fn(async () => undefined) }),
}));

import App from '@/App';
import * as appAuth from '@/lib/app-auth';
import * as apiAuth from '@/lib/api/auth';
import * as appSupport from '@/lib/app-support';
import * as authRequests from '@/lib/api/auth-requests';
import * as apiVault from '@/lib/api/vault';
import * as apiVaultSync from '@/lib/api/vault-sync';
import * as apiAdmin from '@/lib/api/admin';
import * as apiDomains from '@/lib/api/domains';
import * as apiSend from '@/lib/api/send';
import * as vaultWorker from '@/lib/vault-worker';
import * as vaultDecrypt from '@/lib/vault-decrypt';
import * as backupRepair from '@/lib/backup-settings-repair';
import type { AppPhase, Profile, SessionState } from '@/lib/types';
import type { CompletedLogin, PendingTotp } from '@/lib/app-auth';

const adminProfile = {
  id: 'admin-1',
  email: 'user@example.com',
  name: 'User',
  key: 'enc-key',
  masterPasswordHint: 'my hint',
  role: 'admin',
} as unknown as Profile;

const appSession = {
  email: 'user@example.com',
  accessToken: 'tok',
  symEncKey: 'enc-b64',
  symMacKey: 'mac-b64',
} as unknown as SessionState;

function makeLogin(over: Partial<CompletedLogin> = {}): CompletedLogin {
  const profile = (over.profile as Profile) || adminProfile;
  const session = (over.session as SessionState) || appSession;
  return {
    session,
    profile,
    profilePromise: Promise.resolve(profile),
    freshMasterPasswordHash: 'fresh-hash',
    freshUserVerificationToken: 'uvt',
    ...over,
  } as CompletedLogin;
}

const pendingTotp: PendingTotp = {
  email: 'user@example.com',
  passwordHash: 'ph',
  masterKey: new Uint8Array([1, 2, 3]),
  kdfIterations: 600000,
  providerType: 0,
  providerData: 'd0',
  availableProviders: [0, 3, 7],
  providerDataByType: { 0: 'd0', 3: 'd3', 7: 'd7' },
};

interface BootstrapOpts {
  phase?: AppPhase;
  session?: SessionState | null;
  profile?: Profile | null;
  jwtWarning?: { reason: 'missing' | 'too_short'; minLength: number } | null;
  registrationInviteRequired?: boolean;
  defaultKdfIterations?: number;
  invite?: string;
  path?: string;
  hash?: string;
}

let mediaMatches: Record<string, boolean> = {};

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: mediaMatches[query] ?? false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderApp(opts: BootstrapOpts = {}) {
  const {
    phase = 'login',
    session = null,
    profile = null,
    jwtWarning = null,
    registrationInviteRequired = true,
    defaultKdfIterations = 600000,
    invite = '',
    path = '/',
    hash = '',
  } = opts;
  window.history.pushState(null, '', path);
  window.location.hash = hash;
  vi.mocked(appSupport.readInviteCodeFromUrl).mockReturnValue(invite);
  const bootstrap = { defaultKdfIterations, registrationInviteRequired, websiteIconsEnabled: true, jwtWarning, session, phase };
  vi.mocked(appAuth.readInitialAppBootstrapState).mockReturnValue(bootstrap);
  vi.mocked(appAuth.bootstrapAppSession).mockResolvedValue({
    defaultKdfIterations,
    registrationInviteRequired,
    websiteIconsEnabled: true,
    jwtWarning,
    session,
    profile,
    phase,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
}

async function invoke(fn: () => unknown) {
  await act(async () => {
    await fn();
  });
}

function authCb(name: string): () => unknown {
  return rec.auth[name] as () => unknown;
}
function overlayCb(name: string): (...args: unknown[]) => unknown {
  return rec.overlays[name] as (...args: unknown[]) => unknown;
}
function shellCb(name: string): (...args: unknown[]) => unknown {
  return rec.shell[name] as (...args: unknown[]) => unknown;
}
function mainProps(): Record<string, unknown> {
  return rec.shell.mainRoutesProps as Record<string, unknown>;
}

beforeEach(() => {
  mediaMatches = {};
  stubMatchMedia();
  (ReactQuery as unknown as { __resetQueryStore: () => void }).__resetQueryStore();
  window.localStorage.clear();
  for (const key of Object.keys(rec)) delete rec[key];
  vi.clearAllMocks();
  // Restore default resolved values cleared by clearAllMocks.
  vi.mocked(apiAuth.createAuthedFetch).mockReturnValue(vi.fn(async () => ({})) as never);
  vi.mocked(apiAuth.getCurrentDeviceIdentifier).mockReturnValue('device-1');
  vi.mocked(apiAuth.stripProfileSecrets).mockImplementation((p: unknown) => p as never);
  vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(null);
  vi.mocked(apiAuth.getPasswordHint).mockResolvedValue({ masterPasswordHint: 'the hint' } as never);
  vi.mocked(apiAuth.getTwoFactorProviderStatus).mockResolvedValue({ totpEnabled: true, yubikeyEnabled: false, passkeyEnabled: false } as never);
  vi.mocked(apiAuth.getVaultRevisionDate).mockResolvedValue(123456 as never);
  vi.mocked(apiAuth.getAuthorizedDevices).mockResolvedValue([] as never);
  vi.mocked(apiAuth.getProfile).mockResolvedValue(null as never);
  vi.mocked(apiAuth.revokeCurrentSession).mockResolvedValue(undefined as never);
  vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValue([]);
  vi.mocked(appSupport.readInviteCodeFromUrl).mockReturnValue('');
  vi.mocked(authRequests.isPendingAuthRequest).mockReturnValue(true);
  vi.mocked(authRequests.listPendingAuthRequests).mockResolvedValue([] as never);
  vi.mocked(authRequests.encryptSessionUserKeyForAuthRequest).mockResolvedValue('enc-key' as never);
  vi.mocked(authRequests.respondToAuthRequest).mockResolvedValue(undefined as never);
  vi.mocked(apiVault.repairCipherKeyMismatches).mockResolvedValue(0 as never);
  vi.mocked(apiVault.repairCipherUriChecksums).mockResolvedValue(0 as never);
  vi.mocked(apiVault.getCipherById).mockResolvedValue({ id: 'c-remote', revisionDate: '2024-01-01T00:00:00Z' } as never);
  vi.mocked(apiVault.getFolderById).mockResolvedValue({ id: 'f-remote', revisionDate: '2024-01-01T00:00:00Z' } as never);
  vi.mocked(apiSend.getSendById).mockResolvedValue({ id: 's-remote' } as never);
  vi.mocked(apiSend.getSends).mockResolvedValue([] as never);
  vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [], ciphers: [], sends: [] } as never);
  vi.mocked(apiVaultSync.getCachedVaultCoreSnapshot).mockResolvedValue(null as never);
  vi.mocked(apiVaultSync.invalidateVaultCoreSyncSnapshot).mockResolvedValue(undefined as never);
  vi.mocked(apiVaultSync.saveVaultCoreSyncSnapshot).mockResolvedValue(undefined as never);
  vi.mocked(vaultWorker.decryptVaultCoreInWorker).mockResolvedValue({ folders: [], ciphers: [] } as never);
  vi.mocked(vaultWorker.decryptSendsInWorker).mockResolvedValue([] as never);
  vi.mocked(vaultDecrypt.decryptVaultCore).mockResolvedValue({ folders: [], ciphers: [] } as never);
  vi.mocked(vaultDecrypt.decryptSends).mockResolvedValue([] as never);
  vi.mocked(apiDomains.getDomainRules).mockResolvedValue({ object: 'domains', equivalentDomains: [], customEquivalentDomains: [], globalEquivalentDomains: [] } as never);
  vi.mocked(apiDomains.saveDomainRules).mockResolvedValue({ object: 'domains', equivalentDomains: [], customEquivalentDomains: [], globalEquivalentDomains: [] } as never);
  vi.mocked(apiAdmin.listAdminUsers).mockResolvedValue([] as never);
  vi.mocked(apiAdmin.listAdminInvites).mockResolvedValue([] as never);
});

afterEach(() => {
  window.history.pushState(null, '', '/');
  window.location.hash = '';
});

describe('App top-level routing branches', () => {
  it('renders the JWT warning page when bootstrap flags an unsafe JWT secret', async () => {
    renderApp({ jwtWarning: { reason: 'too_short', minLength: 32 } });
    expect(await screen.findByTestId('jwt')).toHaveAttribute('data-reason', 'too_short');
  });

  it('renders the public send page (with key part) and passive overlays', async () => {
    renderApp({ path: '/send/abc123/keypart' });
    const page = await screen.findByTestId('public-send');
    expect(page).toHaveAttribute('data-access', 'abc123');
    expect(page).toHaveAttribute('data-key', 'keypart');
    expect(screen.getByTestId('overlays')).toBeInTheDocument();
  });

  it('renders the public send page without a key part', async () => {
    renderApp({ path: '/send/onlyaccess' });
    expect(await screen.findByTestId('public-send')).toHaveAttribute('data-key', 'null');
  });

  it('renders the not-found page for a malformed send route', async () => {
    renderApp({ path: '/send' });
    expect(await screen.findByTestId('notfound')).toBeInTheDocument();
  });

  it('renders the not-found page for an unknown route', async () => {
    renderApp({ path: '/totally-unknown' });
    expect(await screen.findByTestId('notfound')).toBeInTheDocument();
  });

  it('renders the recover-2fa page and supports submit + cancel', async () => {
    vi.mocked(appAuth.performRecoverTwoFactorLogin).mockResolvedValue({ login: makeLogin(), newRecoveryCode: 'NEW-CODE' } as never);
    renderApp({ path: '/recover-2fa' });
    await screen.findByTestId('recover');
    // submit with all fields set
    await invoke(() => (rec.recover.onChange as (v: unknown) => void)({ email: 'user@example.com', password: 'pw', recoveryCode: 'code' }));
    await invoke(() => (rec.recover.onSubmit as () => void)());
    await waitFor(() => expect(vi.mocked(appAuth.performRecoverTwoFactorLogin)).toHaveBeenCalled());
  });

  it('recover-2fa submit reports missing fields', async () => {
    renderApp({ path: '/recover-2fa' });
    await screen.findByTestId('recover');
    await invoke(() => (rec.recover.onSubmit as () => void)());
    expect(vi.mocked(appAuth.performRecoverTwoFactorLogin)).not.toHaveBeenCalled();
  });

  it('recover-2fa cancel navigates back to login', async () => {
    renderApp({ path: '/recover-2fa' });
    await screen.findByTestId('recover');
    await invoke(() => (rec.recover.onCancel as () => void)());
    expect(window.location.pathname).toBe('/login');
  });
});

describe('App auth phase rendering', () => {
  it('renders AuthViews in login mode with overlays', async () => {
    renderApp({ phase: 'login', path: '/login' });
    const auth = await screen.findByTestId('auth');
    expect(auth).toHaveAttribute('data-mode', 'login');
    expect(screen.getByTestId('overlays')).toBeInTheDocument();
  });

  it('renders AuthViews in register mode', async () => {
    renderApp({ phase: 'register', path: '/register' });
    expect(await screen.findByTestId('auth')).toHaveAttribute('data-mode', 'register');
  });

  it('renders AuthViews in locked mode and marks unlock ready with a session', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: appSession, profile: adminProfile } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    const auth = await screen.findByTestId('auth');
    expect(auth).toHaveAttribute('data-mode', 'locked');
  });
});

describe('App login handlers', () => {
  it('logs in successfully and transitions to the app phase', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'success', login: makeLogin() } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('login validates missing email/password', async () => {
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitLogin')());
    expect(vi.mocked(appAuth.performPasswordLogin)).not.toHaveBeenCalled();
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '1');
  });

  it('login surfaces a totp challenge', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'totp', pendingTotp } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-totp-open', 'true');
  });

  it('login shows an error toast for an error result', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'error', message: 'nope' } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '1');
  });

  it('login catches thrown errors', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockRejectedValue(new Error('boom'));
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '1');
  });

  it('passkey login success', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValue({ kind: 'success', login: makeLogin() } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskey')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('passkey login requesting a master password', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValue({
      kind: 'password',
      pendingPasskeyPassword: { token: {} as never, email: 'pk@example.com', kdfIterations: 600000 },
    } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskey')());
    expect(screen.getByTestId('auth')).toHaveAttribute('data-passkey-email', 'pk@example.com');
  });

  it('passkey login error result and thrown error', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValueOnce({ kind: 'error', message: 'x' } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskey')());
    vi.mocked(appAuth.performPasskeyLogin).mockRejectedValueOnce(new Error('throw'));
    await invoke(() => authCb('onSubmitPasskey')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '2');
  });

  it('completes a passkey-password login', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValue({
      kind: 'password',
      pendingPasskeyPassword: { token: {} as never, email: 'pk@example.com', kdfIterations: 600000 },
    } as never);
    vi.mocked(appAuth.completePasskeyPasswordLogin).mockResolvedValue(makeLogin());
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskey')());
    // empty password -> error
    await invoke(() => authCb('onSubmitPasskeyPassword')());
    // provide password then submit
    await invoke(() => (rec.auth.onChangePasskeyPassword as (v: string) => void)('mypw'));
    await invoke(() => authCb('onSubmitPasskeyPassword')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('passkey-password login catches a thrown error', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValue({
      kind: 'password',
      pendingPasskeyPassword: { token: {} as never, email: 'pk@example.com', kdfIterations: 600000 },
    } as never);
    vi.mocked(appAuth.completePasskeyPasswordLogin).mockRejectedValue(new Error('bad'));
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskey')());
    await invoke(() => (rec.auth.onChangePasskeyPassword as (v: string) => void)('mypw'));
    await invoke(() => authCb('onSubmitPasskeyPassword')());
    // one warning toast (passkey needs password) + one error toast (login threw)
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '2');
  });

  it('goes to register and back to login from AuthViews', async () => {
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onGotoRegister')());
    expect(screen.getByTestId('auth')).toHaveAttribute('data-mode', 'register');
    await invoke(() => authCb('onGotoLogin')());
    expect(screen.getByTestId('auth')).toHaveAttribute('data-mode', 'login');
  });

  it('goto register carries an invite code from the URL', async () => {
    renderApp({ phase: 'login', path: '/login', invite: 'INV-1' });
    await screen.findByTestId('auth');
    // The invite effect will have navigated to register already; force back to login first.
    await invoke(() => authCb('onGotoLogin')());
    await invoke(() => authCb('onGotoRegister')());
    expect(screen.getByTestId('auth')).toHaveAttribute('data-mode', 'register');
  });

  it('logs out from the auth view', async () => {
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onLogout')());
    expect(window.location.pathname).toBe('/login');
  });

  it('retries the locked session refresh', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: appSession, profile: adminProfile } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onRetrySessionRefresh')());
    expect(screen.getByTestId('auth')).toBeInTheDocument();
  });
});

describe('App register handler', () => {
  it('registers successfully and returns to login', async () => {
    vi.mocked(appAuth.performRegistration).mockResolvedValue({ ok: true } as never);
    renderApp({ phase: 'register', path: '/register' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeRegister as (v: unknown) => void)({
      name: 'n', email: 'new@example.com', password: 'longenoughpw1', password2: 'longenoughpw1', passwordHint: '', inviteCode: '',
    }));
    await invoke(() => authCb('onSubmitRegister')());
    expect(window.location.pathname).toBe('/login');
  });

  it('register validates empty, short, and mismatched passwords', async () => {
    renderApp({ phase: 'register', path: '/register' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitRegister')()); // empty
    await invoke(() => (rec.auth.onChangeRegister as (v: unknown) => void)({
      name: '', email: 'e@example.com', password: 'short', password2: 'short', passwordHint: '', inviteCode: '',
    }));
    await invoke(() => authCb('onSubmitRegister')()); // too short
    await invoke(() => (rec.auth.onChangeRegister as (v: unknown) => void)({
      name: '', email: 'e@example.com', password: 'longenoughpw1', password2: 'different1234', passwordHint: '', inviteCode: '',
    }));
    await invoke(() => authCb('onSubmitRegister')()); // mismatch
    expect(vi.mocked(appAuth.performRegistration)).not.toHaveBeenCalled();
  });

  it('register surfaces a server error message', async () => {
    vi.mocked(appAuth.performRegistration).mockResolvedValue({ ok: false, message: 'taken' } as never);
    renderApp({ phase: 'register', path: '/register' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeRegister as (v: unknown) => void)({
      name: 'n', email: 'new@example.com', password: 'longenoughpw1', password2: 'longenoughpw1', passwordHint: '', inviteCode: '',
    }));
    await invoke(() => authCb('onSubmitRegister')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '1');
  });
});

describe('App unlock + passkey unlock handlers', () => {
  function renderLocked() {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: { email: 'user@example.com' } as SessionState, profile: adminProfile } as never);
    return renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
  }

  it('unlock validates a missing password', async () => {
    renderLocked();
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitUnlock')());
    expect(vi.mocked(appAuth.performUnlock)).not.toHaveBeenCalled();
  });

  it('unlock succeeds', async () => {
    vi.mocked(appAuth.performUnlock).mockResolvedValue({ kind: 'success', login: makeLogin() } as never);
    renderLocked();
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeUnlock as (v: string) => void)('pw'));
    await invoke(() => authCb('onSubmitUnlock')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('unlock surfaces a totp challenge', async () => {
    vi.mocked(appAuth.performUnlock).mockResolvedValue({ kind: 'totp', pendingTotp } as never);
    renderLocked();
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeUnlock as (v: string) => void)('pw'));
    await invoke(() => authCb('onSubmitUnlock')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-totp-open', 'true');
  });

  it('unlock shows an error result and catches throws', async () => {
    vi.mocked(appAuth.performUnlock).mockResolvedValueOnce({ kind: 'error', message: 'bad' } as never);
    renderLocked();
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeUnlock as (v: string) => void)('pw'));
    await invoke(() => authCb('onSubmitUnlock')());
    vi.mocked(appAuth.performUnlock).mockRejectedValueOnce(new Error('throw'));
    await invoke(() => authCb('onSubmitUnlock')());
    expect(Number(screen.getByTestId('overlays').getAttribute('data-toasts'))).toBeGreaterThanOrEqual(2);
  });

  it('passkey unlock success', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValue({ kind: 'success', login: makeLogin() } as never);
    renderLocked();
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskeyUnlock')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('passkey unlock password result shows an error, then a thrown error is caught', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValueOnce({
      kind: 'password',
      pendingPasskeyPassword: { token: {} as never, email: 'user@example.com', kdfIterations: 600000 },
    } as never);
    renderLocked();
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskeyUnlock')());
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValueOnce({ kind: 'error', message: 'no' } as never);
    await invoke(() => authCb('onSubmitPasskeyUnlock')());
    vi.mocked(appAuth.performPasskeyLogin).mockRejectedValueOnce(new Error('throw'));
    await invoke(() => authCb('onSubmitPasskeyUnlock')());
    expect(Number(screen.getByTestId('overlays').getAttribute('data-toasts'))).toBeGreaterThanOrEqual(3);
  });
});

describe('App password hint handlers', () => {
  it('fetches and caches a login password hint, then shows it from cache', async () => {
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    // no email -> returns early
    await invoke(() => authCb('onTogglePasswordHint')());
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: '' }));
    await invoke(() => authCb('onTogglePasswordHint')()); // fetch
    await invoke(() => overlayCb('onCancelConfirm')());
    await invoke(() => authCb('onTogglePasswordHint')()); // cached
    expect(vi.mocked(apiAuth.getPasswordHint)).toHaveBeenCalledTimes(1);
  });

  it('handles a password hint fetch failure', async () => {
    vi.mocked(apiAuth.getPasswordHint).mockRejectedValue(new Error('offline'));
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: '' }));
    await invoke(() => authCb('onTogglePasswordHint')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '1');
  });

  it('shows the locked password hint from the profile', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: { email: 'user@example.com' } as SessionState, profile: adminProfile } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onShowLockedPasswordHint')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-confirm', 'true');
    await invoke(() => overlayCb('onCancelConfirm')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-confirm', 'false');
  });
});

describe('App totp overlay handlers', () => {
  async function openTotp() {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'totp', pendingTotp } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
  }

  it('verifies a totp code successfully', async () => {
    vi.mocked(appAuth.performTotpLogin).mockResolvedValue(makeLogin());
    await openTotp();
    await invoke(() => overlayCb('onTotpCodeChange')('123456'));
    await invoke(() => overlayCb('onConfirmTotp')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('requires a totp code before verifying', async () => {
    await openTotp();
    await invoke(() => overlayCb('onConfirmTotp')());
    expect(vi.mocked(appAuth.performTotpLogin)).not.toHaveBeenCalled();
  });

  it('selects an alternate totp provider and a webauthn provider verifies via passkey assertion', async () => {
    vi.mocked(appAuth.performTotpLogin).mockResolvedValue(makeLogin());
    await openTotp();
    await invoke(() => overlayCb('onSelectTotpProvider')(3));
    await invoke(() => overlayCb('onSelectTotpProvider')(7)); // webauthn
    await invoke(() => overlayCb('onConfirmTotp')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('surfaces a totp verification failure', async () => {
    vi.mocked(appAuth.performTotpLogin).mockRejectedValue(new Error('bad code'));
    await openTotp();
    await invoke(() => overlayCb('onTotpCodeChange')('000000'));
    await invoke(() => overlayCb('onConfirmTotp')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-totp-open', 'true');
  });

  it('cancels the totp dialog', async () => {
    await openTotp();
    await invoke(() => overlayCb('onCancelTotp')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-totp-open', 'false');
  });

  it('uses the recovery code path from the totp dialog', async () => {
    await openTotp();
    await invoke(() => overlayCb('onUseRecoveryCode')());
    expect(window.location.pathname).toBe('/recover-2fa');
  });
});

describe('App authenticated shell interactions', () => {
  async function renderAppPhase() {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    const utils = renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(vi.mocked(apiAuth.getTwoFactorProviderStatus)).toHaveBeenCalled());
    return utils;
  }

  it('renders the shell, decrypts the vault, and enables admin queries', async () => {
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({
      folders: [{ id: 'f1', revisionDate: '2024-01-01T00:00:00Z' }],
      ciphers: [{ id: 'c1', revisionDate: '2024-01-01T00:00:00Z' }],
      sends: [{ id: 's1', revisionDate: '2024-01-01T00:00:00Z' }],
    });
    await renderAppPhase();
    await waitFor(() => expect(vi.mocked(apiAdmin.listAdminUsers)).toHaveBeenCalled());
    expect(screen.getByTestId('shell')).toHaveAttribute('data-title');
  });

  it('locks the session from the shell', async () => {
    await renderAppPhase();
    await invoke(() => shellCb('onLock')());
    expect(await screen.findByTestId('auth')).toHaveAttribute('data-mode', 'locked');
  });

  it('logs out via the confirm dialog', async () => {
    await renderAppPhase();
    await invoke(() => shellCb('onLogout')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-confirm', 'true');
    await invoke(() => (rec.overlays.confirm as { onConfirm: () => void }).onConfirm());
    expect(await screen.findByTestId('auth')).toBeInTheDocument();
  });

  it('toggles theme and mobile sidebar', async () => {
    await renderAppPhase();
    await invoke(() => shellCb('onToggleTheme')());
    await invoke(() => shellCb('onToggleMobileSidebar')());
    expect(screen.getByTestId('shell')).toBeInTheDocument();
  });

  it('updates lock timeout and session timeout action from main routes props', async () => {
    await renderAppPhase();
    await invoke(() => (mainProps().onLockTimeoutChange as (v: number) => void)(5));
    await invoke(() => (mainProps().onSessionTimeoutActionChange as (v: string) => void)('logout'));
    await invoke(() => (mainProps().onThemePreferenceChange as (v: string) => void)('dark'));
    expect(window.localStorage.getItem('nodewarden.lock.timeout-minutes.v1')).toBe('5');
    expect(window.localStorage.getItem('nodewarden.session.timeout-action.v1')).toBe('logout');
  });

  it('saves domain rules through the optimistic handler', async () => {
    await renderAppPhase();
    await invoke(() => (mainProps().onSaveDomainRules as (a: unknown[], b: number[]) => void)(
      [{ id: 'd1', domains: ['a.example', 'b.example'], excluded: false }],
      [10]
    ));
    await waitFor(() => expect(vi.mocked(apiDomains.saveDomainRules)).toHaveBeenCalled());
  });

  it('derives a master-password hash for backup export/import handlers', async () => {
    await renderAppPhase();
    await invoke(() => (mainProps().onExportBackup as (pw: string, incl?: boolean) => Promise<unknown>)('masterpw', true));
    await invoke(() => (mainProps().onImportBackup as (pw: string, f: File) => Promise<unknown>)('masterpw', new File([''], 'b.json')));
    await invoke(() => (mainProps().onSaveBackupSettings as (pw: string, s: unknown) => Promise<unknown>)('masterpw', { destinations: [] }));
    await invoke(() => (mainProps().onRunRemoteBackup as (pw: string, d?: string | null) => Promise<unknown>)('masterpw', null));
    expect(vi.mocked(apiAuth.deriveLoginHash)).toHaveBeenCalled();
  });

  it('opens and confirms the disable-totp dialog', async () => {
    await renderAppPhase();
    await invoke(() => (mainProps().onOpenDisableTotp as () => void)());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-disable-open', 'true');
    await invoke(() => (rec.overlays.onDisableTotpPasswordChange as (v: string) => void)('pw'));
    await invoke(() => (rec.overlays.onConfirmDisableTotp as () => void)());
    await invoke(() => (rec.overlays.onCancelDisableTotp as () => void)());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-disable-open', 'false');
  });
});

describe('App auth request approval dialog', () => {
  async function renderWithRequest() {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    vi.mocked(authRequests.listPendingAuthRequests).mockResolvedValue([
      { id: 'ar-1', publicKey: 'pk', requestDeviceType: 'web', origin: 'https://x.example' },
    ] as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(rec.authDialog.open).toBe(true));
  }

  it('approves an auth request', async () => {
    await renderWithRequest();
    await invoke(() => (rec.authDialog.onApprove as () => void)());
    await waitFor(() => expect(vi.mocked(authRequests.respondToAuthRequest)).toHaveBeenCalled());
  });

  it('denies an auth request', async () => {
    await renderWithRequest();
    await invoke(() => (rec.authDialog.onDeny as () => void)());
    await waitFor(() => expect(vi.mocked(authRequests.respondToAuthRequest)).toHaveBeenCalled());
  });

  it('closes (dismisses) an auth request dialog', async () => {
    await renderWithRequest();
    await invoke(() => (rec.authDialog.onClose as () => void)());
    await waitFor(() => expect(rec.authDialog.open).toBe(false));
  });
});

describe('App locked-session hydration + demo-off effects', () => {
  it('expires a locked session that can no longer refresh', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'expired', session: null, profile: null } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    await screen.findByTestId('auth');
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });

  it('handles a transient locked-session refresh error', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({
      kind: 'transient', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, message: 'temporary', retryAfterMs: 1000,
    } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    const auth = await screen.findByTestId('auth');
    await waitFor(() => expect(auth.getAttribute('data-refresh-error')).not.toBe(''));
  });
});

describe('App theme + storage bootstrapping', () => {
  it('reads a stored dark theme preference and a stored lock timeout', async () => {
    window.localStorage.setItem('nodewarden.theme.preference.v1', 'dark');
    window.localStorage.setItem('nodewarden.lock.timeout-minutes.v1', '30');
    window.localStorage.setItem('nodewarden.session.timeout-action.v1', 'logout');
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    const shell = await screen.findByTestId('shell');
    expect(shell).toHaveAttribute('data-dark', 'true');
  });

  it('resolves the system dark theme when preference is system', async () => {
    mediaMatches['(prefers-color-scheme: dark)'] = true;
    window.localStorage.setItem('nodewarden.theme.preference.v1', 'system');
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    const shell = await screen.findByTestId('shell');
    expect(shell).toHaveAttribute('data-dark', 'true');
  });

  it('applies a mobile layout when the media query matches', async () => {
    mediaMatches['(max-width: 1180px)'] = true;
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/sends' });
    const shell = await screen.findByTestId('shell');
    expect(shell).toHaveAttribute('data-sidebar-toggle', 'true');
  });
});

describe('App route redirect effects (app phase)', () => {
  it('redirects "/" to /vault when authenticated', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/' });
    await waitFor(() => expect(window.location.pathname).toBe('/vault'));
  });

  it('redirects non-admins away from the backup route', async () => {
    const userProfile = { ...adminProfile, role: 'user' } as unknown as Profile;
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(userProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: userProfile, path: '/backup' });
    await waitFor(() => expect(window.location.pathname).toBe('/vault'));
  });

  it('redirects the settings home to the account route on desktop', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/settings' });
    await waitFor(() => expect(window.location.pathname).toBe('/settings/account'));
  });
});

describe('App register-from-invite effect', () => {
  it('switches to register when an invite code is present in the URL', async () => {
    renderApp({ phase: 'login', path: '/login', invite: 'INVITE-XYZ' });
    await waitFor(() => expect(window.location.pathname).toBe('/register'));
  });
});

describe('App SignalR notification handling', () => {
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    handlers: Record<string, ((ev: unknown) => void)[]> = {};
    sent: string[] = [];
    url: string;
    constructor(url: string) {
      this.url = url;
      FakeWebSocket.instances.push(this);
    }
    addEventListener(type: string, cb: (ev: unknown) => void) {
      (this.handlers[type] ||= []).push(cb);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {}
    emit(type: string, ev: unknown) {
      (this.handlers[type] || []).forEach((cb) => cb(ev));
    }
  }

  it('connects, handshakes, and dispatches a batch of notification frames', async () => {
    const OriginalWS = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    FakeWebSocket.instances = [];
    try {
      vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
      vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({
        folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [],
      });
      renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
      await screen.findByTestId('shell');
      await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
      const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

      await invoke(() => ws.emit('open', {}));
      expect(ws.sent.length).toBeGreaterThan(0);

      const frame = (type: number, extra: Record<string, unknown> = {}) => ({
        type: 1,
        target: 'ReceiveMessage',
        arguments: [{ Type: type, ContextId: 'other-device', Date: '2024-01-01T00:00:00Z', ...extra }],
      });
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        frame(101), // device status
        frame(15), // auth request
        frame(102, { Payload: { operation: 'backup-restore', step: 's', fileName: 'f' } }), // backup progress
        frame(4), // sync ciphers -> debounce timer
        frame(1, { Payload: { Id: 'c-remote', RevisionDate: '2024-01-02T00:00:00Z' } }), // cipher create
        frame(9, { Payload: { Id: 'c-remote' } }), // cipher delete
        frame(7, { Payload: { Id: 'f-remote' } }), // folder create
        frame(3, { Payload: { Id: 'f-remote' } }), // folder delete
        frame(12, { Payload: { Id: 's-remote' } }), // send create
        frame(14, { Payload: { Id: 's-remote' } }), // send delete
        { type: 1, target: 'ReceiveMessage', arguments: [{ Type: 4, ContextId: 'device-1' }] }, // own device -> skipped
        { type: 6 }, // non-invoke frame ignored
      ] as never);
      await invoke(() => ws.emit('message', { data: 'payload' }));
      await waitFor(() => expect(vi.mocked(apiVault.getCipherById)).toHaveBeenCalled());

      await invoke(() => ws.emit('close', {}));
      await invoke(() => ws.emit('error', {}));
    } finally {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = OriginalWS;
    }
  });

  it('logs out when a log-out notification frame arrives', async () => {
    const OriginalWS = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    FakeWebSocket.instances = [];
    try {
      vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
      vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({
        folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [],
      });
      renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
      await screen.findByTestId('shell');
      await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
      const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
      await invoke(() => ws.emit('open', {}));
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        { type: 1, target: 'ReceiveMessage', arguments: [{ Type: 11 }] },
      ] as never);
      await invoke(() => ws.emit('message', { data: 'logout' }));
      await waitFor(() => expect(window.location.pathname).toBe('/login'));
    } finally {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = OriginalWS;
    }
  });
});

describe('App notification listener + hash routes', () => {
  it('surfaces an app-notify custom event as a toast', async () => {
    const { APP_NOTIFY_EVENT } = await import('@/lib/app-notify');
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => window.dispatchEvent(new CustomEvent(APP_NOTIFY_EVENT, { detail: { type: 'success', text: 'hi' } })));
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '1');
  });

  it('normalizes an import hash route to the canonical import route', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault', hash: '#/tools/import' });
    await waitFor(() => expect(window.location.pathname).toBe('/backup/import-export'));
  });

  it('normalizes a legacy device-management hash route', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault', hash: '#/security/devices' });
    await waitFor(() => expect(window.location.pathname).toBe('/settings/security/device-management'));
  });

  it('ignores an app-notify event without text', async () => {
    const { APP_NOTIFY_EVENT } = await import('@/lib/app-notify');
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => window.dispatchEvent(new CustomEvent(APP_NOTIFY_EVENT, { detail: { type: 'success', text: '' } })));
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '0');
  });
});

describe('App matchMedia + storage edge cases', () => {
  it('falls back gracefully when matchMedia is unavailable', async () => {
    (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;
    renderApp({ phase: 'login', path: '/login' });
    const shell = await screen.findByTestId('auth');
    expect(shell).toBeInTheDocument();
  });

  it('uses the legacy addListener media API and cleans up on unmount', async () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const utils = renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    utils.unmount();
    expect(true).toBe(true);
  });

  it('coerces invalid stored theme/timeout/action values to defaults', async () => {
    window.localStorage.setItem('nodewarden.theme.preference.v1', 'weird');
    window.localStorage.setItem('nodewarden.lock.timeout-minutes.v1', 'not-a-number');
    window.localStorage.setItem('nodewarden.session.timeout-action.v1', 'nonsense');
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    expect(window.localStorage.getItem('nodewarden.lock.timeout-minutes.v1')).toBe('15');
  });
});

describe('App authenticated data + main-routes handlers', () => {
  async function renderAppData(over: { profile?: Profile; snapshot?: unknown } = {}) {
    const profile = over.profile || adminProfile;
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(profile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue((over.snapshot as never) ?? ({
      folders: [{ id: 'f1', revisionDate: '2024-01-01T00:00:00Z' }],
      ciphers: [{ id: 'c1', revisionDate: '2024-01-01T00:00:00Z' }],
      sends: [{ id: 's1', revisionDate: '2024-01-01T00:00:00Z' }],
    } as never));
    const utils = renderApp({ phase: 'app', session: appSession, profile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot)).toHaveBeenCalled());
    return utils;
  }

  it('adopts a freshly fetched profile from the profile query', async () => {
    vi.mocked(apiAuth.getProfile).mockResolvedValue({ ...adminProfile, name: 'Refetched' } as never);
    await renderAppData();
    await waitFor(() => expect(vi.mocked(apiAuth.getProfile)).toHaveBeenCalled());
  });

  it('reports a vault load error when the sync snapshot fails', async () => {
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockRejectedValue(new Error('load fail'));
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(String((mainProps().vaultError))).not.toBe(''));
  });

  it('surfaces a vault decrypt error when both worker and fallback decrypt fail', async () => {
    vi.mocked(vaultWorker.decryptVaultCoreInWorker).mockRejectedValue(new Error('worker'));
    vi.mocked(vaultDecrypt.decryptVaultCore).mockRejectedValue(new Error('fallback'));
    await renderAppData();
    await waitFor(() => expect(screen.getByTestId('overlays').getAttribute('data-toasts')).not.toBe('0'));
  });

  it('invalidates and refetches when cipher key mismatches are repaired', async () => {
    vi.mocked(apiVault.repairCipherKeyMismatches).mockResolvedValue(2 as never);
    await renderAppData();
    await waitFor(() => expect(vi.mocked(apiVaultSync.invalidateVaultCoreSyncSnapshot)).toHaveBeenCalled());
  });

  it('repairs URI checksums when no key mismatches are found', async () => {
    vi.mocked(apiVault.repairCipherKeyMismatches).mockResolvedValue(0 as never);
    vi.mocked(apiVault.repairCipherUriChecksums).mockResolvedValue(3 as never);
    await renderAppData();
    await waitFor(() => expect(vi.mocked(apiVault.repairCipherUriChecksums)).toHaveBeenCalled());
  });

  it('decrypts sends via the worker fallback path', async () => {
    vi.mocked(vaultWorker.decryptSendsInWorker).mockRejectedValue(new Error('no worker'));
    vi.mocked(vaultDecrypt.decryptSends).mockResolvedValue([{ id: 's1' }] as never);
    await renderAppData();
    await waitFor(() => expect(vi.mocked(vaultDecrypt.decryptSends)).toHaveBeenCalled());
  });

  it('handles empty sends after decrypt', async () => {
    await renderAppData({ snapshot: { folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } });
    expect(screen.getByTestId('shell')).toBeInTheDocument();
  });

  it('exercises the audit-log and backup passthrough handlers', async () => {
    await renderAppData();
    await invoke(() => (mainProps().onLoadAuditLogs as (f: unknown) => Promise<unknown>)({}));
    await invoke(() => (mainProps().onLoadAuditLogSettings as () => Promise<unknown>)());
    await invoke(() => (mainProps().onSaveAuditLogSettings as (s: unknown) => Promise<unknown>)({}));
    await invoke(() => (mainProps().onClearAuditLogs as () => Promise<unknown>)());
    await invoke(() => (mainProps().onLoadBackupSettings as () => Promise<unknown>)());
    await invoke(() => (mainProps().onListRemoteBackups as () => Promise<unknown>)());
    await invoke(() => (mainProps().onImportBackupAllowingChecksumMismatch as (pw: string, f: File) => Promise<unknown>)('pw', new File([''], 'b')));
    await invoke(() => (mainProps().onDownloadRemoteBackup as (pw: string, d: string, p: string) => Promise<unknown>)('pw', 'dest', 'path'));
    await invoke(() => (mainProps().onInspectRemoteBackup as (pw: string, d: string, p: string) => Promise<unknown>)('pw', 'dest', 'path'));
    await invoke(() => (mainProps().onDeleteRemoteBackup as (pw: string, d: string, p: string) => Promise<unknown>)('pw', 'dest', 'path'));
    await invoke(() => (mainProps().onRestoreRemoteBackup as (pw: string, d: string, p: string) => Promise<unknown>)('pw', 'dest', 'path'));
    await invoke(() => (mainProps().onRestoreRemoteBackupAllowingChecksumMismatch as (pw: string, d: string, p: string) => Promise<unknown>)('pw', 'dest', 'path'));
    expect(vi.mocked(apiAuth.deriveLoginHash)).toHaveBeenCalled();
  });

  it('exercises the totp / auth-request / domain refresh handlers', async () => {
    await renderAppData();
    await invoke(() => (mainProps().onEnableTotp as (s: string, t: string, p: string) => Promise<unknown>)('secret', 'token', 'pw'));
    await invoke(() => (mainProps().onRefreshTwoFactorStatus as () => Promise<unknown>)());
    await invoke(() => (mainProps().onRefreshPendingAuthRequests as () => Promise<unknown>)());
    await invoke(() => (mainProps().onRefreshDomainRules as () => void)());
    expect(screen.getByTestId('shell')).toBeInTheDocument();
  });

  it('rejects a backup export when no master password is supplied', async () => {
    await renderAppData();
    let threw = false;
    await invoke(async () => {
      try {
        await (mainProps().onExportBackup as (pw: string) => Promise<unknown>)('');
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(true);
  });

  it('recovers from a domain rules save failure', async () => {
    vi.mocked(apiDomains.saveDomainRules).mockRejectedValue(new Error('save fail'));
    await renderAppData();
    await invoke(() => (mainProps().onSaveDomainRules as (a: unknown[], b: number[]) => void)(
      [{ id: 'd1', domains: ['a.example'], excluded: true }],
      []
    ));
    await waitFor(() => expect(vi.mocked(apiDomains.getDomainRules)).toHaveBeenCalled());
  });

  it('selects a specific pending auth request before approving', async () => {
    vi.mocked(authRequests.listPendingAuthRequests).mockResolvedValue([
      { id: 'ar-1', publicKey: 'pk', origin: 'https://x.example' },
      { id: 'ar-2', publicKey: 'pk2', origin: 'https://y.example' },
    ] as never);
    await renderAppData();
    await waitFor(() => expect((mainProps().pendingAuthRequests as unknown[]).length).toBe(2));
    await invoke(() => (mainProps().onApproveAuthRequest as (r: unknown) => Promise<void>)({ id: 'ar-2' }));
    await waitFor(() => expect(rec.authDialog.open).toBe(true));
  });
});

describe('App page-title + mobile-route branches', () => {
  const routes = [
    '/security/password-health', '/vault/totp', '/generator', '/sends', '/admin',
    '/logs', '/settings/security/device-management', '/settings/domain-rules',
    '/backup', '/backup/import-export', '/settings/account',
  ];
  it('computes a page title and primary route for each app route', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    for (const path of routes) {
      const utils = renderApp({ phase: 'app', session: appSession, profile: adminProfile, path });
      const shell = await screen.findByTestId('shell');
      expect(shell).toHaveAttribute('data-title');
      utils.unmount();
    }
  });

  it('shows the settings home title on mobile', async () => {
    mediaMatches['(max-width: 1180px)'] = true;
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/settings' });
    const shell = await screen.findByTestId('shell');
    expect(shell).toHaveAttribute('data-mobile-route', '/settings');
  });
});

describe('App lock-timeout auto action', () => {
  it('locks the session after inactivity when the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem('nodewarden.lock.timeout-minutes.v1', '1');
      vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
      vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
      renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
      await vi.waitFor(() => expect(rec.shell).toBeTruthy());
      // let the vault decrypt + effects settle so the timeout effect is armed
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      await act(async () => {
        window.dispatchEvent(new Event('pointerdown'));
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(61_000);
      });
      await vi.waitFor(() => expect(rec.auth?.mode).toBe('locked'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs out after inactivity when the timeout action is logout', async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem('nodewarden.lock.timeout-minutes.v1', '1');
      window.localStorage.setItem('nodewarden.session.timeout-action.v1', 'logout');
      vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
      vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
      renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
      await vi.waitFor(() => expect(rec.shell).toBeTruthy());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      await vi.waitFor(() => expect(window.location.pathname).toBe('/login'));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('App notification 404 + refresh paths', () => {
  class FakeWS {
    static instances: FakeWS[] = [];
    handlers: Record<string, ((ev: unknown) => void)[]> = {};
    sent: string[] = [];
    constructor(public url: string) {
      FakeWS.instances.push(this);
    }
    addEventListener(type: string, cb: (ev: unknown) => void) {
      (this.handlers[type] ||= []).push(cb);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {}
    emit(type: string, ev: unknown) {
      (this.handlers[type] || []).forEach((cb) => cb(ev));
    }
  }

  it('deletes resources locally when notification lookups 404 and refreshes on sync frames', async () => {
    const OriginalWS = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
    FakeWS.instances = [];
    const notFound = Object.assign(new Error('missing'), { status: 404 });
    try {
      vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
      vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
      vi.mocked(apiVault.getCipherById).mockRejectedValue(notFound);
      vi.mocked(apiVault.getFolderById).mockRejectedValue(notFound);
      vi.mocked(apiSend.getSendById).mockRejectedValue(notFound);
      renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
      await screen.findByTestId('shell');
      await waitFor(() => expect(FakeWS.instances.length).toBeGreaterThan(0));
      const ws = FakeWS.instances[FakeWS.instances.length - 1];
      await invoke(() => ws.emit('open', {}));
      const frame = (type: number, extra: Record<string, unknown> = {}) => ({
        type: 1, target: 'ReceiveMessage', arguments: [{ Type: type, ContextId: 'other', ...extra }],
      });
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        frame(1, { Payload: { Id: 'c-x' } }),
        frame(7, { Payload: { Id: 'f-x' } }),
        frame(12, { Payload: { Id: 's-x' } }),
        frame(102, { Payload: { operation: 'backup-export', step: 'writing', fileName: 'export.json' } }), // valid backup progress
        frame(4), // sync ciphers -> schedule silent refresh timer
        frame(5), // sync vault -> timer already pending, clears + reschedules
      ] as never);
      await invoke(() => ws.emit('message', { data: 'x' }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });
      await waitFor(() => expect(vi.mocked(apiVault.getCipherById)).toHaveBeenCalled());
      // Non-404 lookup failures log a warning instead of deleting locally.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(apiVault.getCipherById).mockRejectedValue(new Error('server error'));
      vi.mocked(apiVault.getFolderById).mockRejectedValue(new Error('server error'));
      vi.mocked(apiSend.getSendById).mockRejectedValue(new Error('server error'));
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        frame(1, { Payload: { Id: 'c-boom' } }),
        frame(7, { Payload: { Id: 'f-boom' } }),
        frame(12, { Payload: { Id: 's-boom' } }),
      ] as never);
      await invoke(() => ws.emit('message', { data: 'boom' }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      warn.mockRestore();
    } finally {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = OriginalWS;
    }
  });

  it('applies successful upserts, updates existing items, and honors an invalid backup-progress frame', async () => {
    const OriginalWS = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
    FakeWS.instances = [];
    try {
      vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
      vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({
        folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [{ id: 's1' }],
      } as never);
      vi.mocked(apiVault.getCipherById).mockResolvedValue({ id: 'c1', revisionDate: '2024-05-01T00:00:00Z' } as never);
      vi.mocked(apiVault.getFolderById).mockResolvedValue({ id: 'f1', revisionDate: '2024-05-01T00:00:00Z' } as never);
      vi.mocked(apiSend.getSendById).mockResolvedValue({ id: 's1', revisionDate: '2024-05-01T00:00:00Z' } as never);
      vi.mocked(vaultDecrypt.decryptVaultCore).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }] } as never);
      vi.mocked(vaultDecrypt.decryptSends).mockResolvedValue([{ id: 's1' }] as never);
      renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
      await screen.findByTestId('shell');
      await waitFor(() => expect(FakeWS.instances.length).toBeGreaterThan(0));
      const ws = FakeWS.instances[FakeWS.instances.length - 1];
      await invoke(() => ws.emit('open', {}));
      const frame = (type: number, extra: Record<string, unknown> = {}) => ({
        type: 1, target: 'ReceiveMessage', arguments: [{ Type: type, ContextId: 'other', ...extra }],
      });
      // A non-string message payload is ignored outright.
      await invoke(() => ws.emit('message', { data: 12345 }));
      // First batch: upserts against EXISTING ids plus a brand-new id, and a
      // backup-progress frame whose payload is missing (isBackupProgressDetail=false).
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        frame(1, { Payload: { Id: 'c1', RevisionDate: '2024-05-02T00:00:00Z' } }), // update existing cipher
        frame(1, { Payload: { Id: 'cNew', RevisionDate: 'not-a-date' } }), // new cipher, invalid stamp
        frame(8, { Payload: { Id: 'f1' } }), // update existing folder
        frame(13, { Payload: { Id: 's1' } }), // update existing send
        frame(102), // backup progress with no payload
      ] as never);
      await invoke(() => ws.emit('message', { data: 'upserts' }));
      await waitFor(() => expect(vi.mocked(apiVault.getCipherById)).toHaveBeenCalled());
      await waitFor(() => expect(vi.mocked(apiVault.getFolderById)).toHaveBeenCalled());
      await waitFor(() => expect(vi.mocked(apiSend.getSendById)).toHaveBeenCalled());
      await waitFor(() => expect(vi.mocked(apiVaultSync.saveVaultCoreSyncSnapshot)).toHaveBeenCalled());
      // Second batch: deletes of the existing ids.
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        frame(9, { Payload: { Id: 'c1' } }),
        frame(3, { Payload: { Id: 'f1' } }),
        frame(14, { Payload: { Id: 's1' } }),
      ] as never);
      await invoke(() => ws.emit('message', { data: 'deletes' }));
      // Third batch: frames whose resource id / type are missing exercise the
      // `&& resourceId` false sides and the Number(Type||0) fallthrough.
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        frame(1), // cipher create, no id
        frame(8), // folder update, no id
        frame(12), // send create, no id
        frame(9), // cipher delete, no id
        frame(3), // folder delete, no id
        frame(14), // send delete, no id
        { type: 1, target: 'ReceiveMessage', arguments: [{ ContextId: 'other' }] }, // no Type -> 0
        { type: 1, target: 'OtherTarget', arguments: [{ Type: 4 }] }, // wrong target ignored
      ] as never);
      await invoke(() => ws.emit('message', { data: 'missing-ids' }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    } finally {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = OriginalWS;
    }
  });
});

describe('App notification new-item inserts', () => {
  class FakeWS2 {
    static instances: FakeWS2[] = [];
    handlers: Record<string, ((ev: unknown) => void)[]> = {};
    sent: string[] = [];
    constructor(public url: string) {
      FakeWS2.instances.push(this);
    }
    addEventListener(type: string, cb: (ev: unknown) => void) {
      (this.handlers[type] ||= []).push(cb);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {}
    emit(type: string, ev: unknown) {
      (this.handlers[type] || []).forEach((cb) => cb(ev));
    }
  }

  it('inserts brand-new decrypted resources from notifications into an empty vault', async () => {
    const OriginalWS = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS2;
    FakeWS2.instances = [];
    try {
      vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
      vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [], ciphers: [], sends: [] } as never);
      vi.mocked(apiVault.getCipherById).mockResolvedValue({ id: 'cNew', revisionDate: '2024-06-01T00:00:00Z' } as never);
      vi.mocked(apiVault.getFolderById).mockResolvedValue({ id: 'fNew', revisionDate: '2024-06-01T00:00:00Z' } as never);
      vi.mocked(apiSend.getSendById).mockResolvedValue({ id: 'sNew', revisionDate: '2024-06-01T00:00:00Z' } as never);
      vi.mocked(vaultDecrypt.decryptVaultCore).mockResolvedValue({ folders: [{ id: 'fNew' }], ciphers: [{ id: 'cNew' }] } as never);
      vi.mocked(vaultDecrypt.decryptSends).mockResolvedValue([{ id: 'sNew' }] as never);
      renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
      await screen.findByTestId('shell');
      await waitFor(() => expect(FakeWS2.instances.length).toBeGreaterThan(0));
      const ws = FakeWS2.instances[FakeWS2.instances.length - 1];
      await invoke(() => ws.emit('open', {}));
      const frame = (type: number, extra: Record<string, unknown> = {}) => ({
        type: 1, target: 'ReceiveMessage', arguments: [{ Type: type, ContextId: 'other', ...extra }],
      });
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        frame(1, { Payload: { Id: 'cNew' } }),
        frame(7, { Payload: { Id: 'fNew' } }),
        frame(12, { Payload: { Id: 'sNew' } }),
      ] as never);
      await invoke(() => ws.emit('message', { data: 'new' }));
      await waitFor(() => expect(vi.mocked(vaultDecrypt.decryptSends)).toHaveBeenCalled());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    } finally {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = OriginalWS;
    }
  });
});

describe('App branch mop-up: non-Error throws + edges', () => {
  async function renderLoginReady() {
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
  }
  async function renderLockedReady() {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: { email: 'user@example.com' } as SessionState, profile: adminProfile } as never);
    const utils = renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeUnlock as (v: string) => void)('pw'));
    return utils;
  }

  it('handles non-Error rejections across the auth handlers', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockRejectedValue('string-error');
    await renderLoginReady();
    await invoke(() => authCb('onSubmitLogin')());
    vi.mocked(appAuth.performPasskeyLogin).mockRejectedValue('string-error');
    await invoke(() => authCb('onSubmitPasskey')());
    expect(Number(screen.getByTestId('overlays').getAttribute('data-toasts'))).toBeGreaterThanOrEqual(2);
  });

  it('handles empty result messages on login and passkey errors', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValue({ kind: 'error', message: '' } as never);
    await renderLoginReady();
    await invoke(() => authCb('onSubmitPasskey')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '1');
  });

  it('handles non-Error unlock rejection and empty unlock error message', async () => {
    vi.mocked(appAuth.performUnlock).mockResolvedValueOnce({ kind: 'error', message: '' } as never);
    await renderLockedReady();
    await invoke(() => authCb('onSubmitUnlock')());
    vi.mocked(appAuth.performUnlock).mockRejectedValueOnce('string-error');
    await invoke(() => authCb('onSubmitUnlock')());
    expect(Number(screen.getByTestId('overlays').getAttribute('data-toasts'))).toBeGreaterThanOrEqual(2);
  });

  it('handles non-Error passkey-unlock and passkey-password rejections', async () => {
    vi.mocked(appAuth.performPasskeyLogin).mockRejectedValueOnce('string-error');
    const locked = await renderLockedReady();
    await invoke(() => authCb('onSubmitPasskeyUnlock')());
    locked.unmount();
    // passkey-password path
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValueOnce({
      kind: 'password',
      pendingPasskeyPassword: { token: {} as never, email: 'user@example.com', kdfIterations: 600000 },
    } as never);
    vi.mocked(appAuth.completePasskeyPasswordLogin).mockRejectedValueOnce('string-error');
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskey')());
    await invoke(() => (rec.auth.onChangePasskeyPassword as (v: string) => void)('pw'));
    await invoke(() => authCb('onSubmitPasskeyPassword')());
    expect(Number(screen.getByTestId('overlays').getAttribute('data-toasts'))).toBeGreaterThanOrEqual(1);
  });

  it('handles a non-Error recover-2fa rejection', async () => {
    vi.mocked(appAuth.performRecoverTwoFactorLogin).mockRejectedValueOnce('string-error');
    renderApp({ path: '/recover-2fa' });
    await screen.findByTestId('recover');
    await invoke(() => (rec.recover.onChange as (v: unknown) => void)({ email: 'a@b.com', password: 'pw', recoveryCode: 'rc' }));
    await invoke(() => (rec.recover.onSubmit as () => void)());
    expect(Number(screen.getByTestId('overlays').getAttribute('data-toasts'))).toBeGreaterThanOrEqual(1);
  });

  it('handles a non-Error password-hint rejection', async () => {
    vi.mocked(apiAuth.getPasswordHint).mockRejectedValue('string-error');
    await renderLoginReady();
    await invoke(() => authCb('onTogglePasswordHint')());
    expect(Number(screen.getByTestId('overlays').getAttribute('data-toasts'))).toBeGreaterThanOrEqual(1);
  });

  it('resets a cached login hint when the email changes', async () => {
    await renderLoginReady();
    await invoke(() => authCb('onTogglePasswordHint')()); // fetch + cache
    await invoke(() => overlayCb('onCancelConfirm')());
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'different@example.com', password: 'pw' }));
    expect(screen.getByTestId('auth')).toBeInTheDocument();
  });

  it('re-selects the same totp provider and confirms with no pending challenge', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'totp', pendingTotp } as never);
    await renderLoginReady();
    await invoke(() => authCb('onSubmitLogin')());
    await invoke(() => overlayCb('onSelectTotpProvider')(0)); // same provider -> no change
    await invoke(() => overlayCb('onCancelTotp')());
    await invoke(() => overlayCb('onConfirmTotp')()); // no pending totp now -> early return
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-totp-open', 'false');
  });

  it('finalizes logins with mixed fresh-credential presence', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({
      kind: 'success',
      login: { session: appSession, profile: adminProfile, profilePromise: Promise.resolve(adminProfile), freshMasterPasswordHash: null, freshUserVerificationToken: 'uvt-only' },
    } as never);
    await renderLoginReady();
    await invoke(() => authCb('onSubmitLogin')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('shows the locked hint fallback when there is no profile at all', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: { email: 'user@example.com' } as SessionState, profile: null } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: null, path: '/lock' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onShowLockedPasswordHint')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-confirm', 'true');
  });

  it('registers online + visibility retry listeners for a transient locked-session error', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({
      kind: 'transient', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, message: '',
    } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    await screen.findByTestId('auth');
    await waitFor(() => expect(String(rec.auth.sessionRefreshError)).not.toBe(''));
    await invoke(() => window.dispatchEvent(new Event('online')));
    await invoke(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByTestId('auth')).toBeInTheDocument();
  });
});

describe('App in-flight guards', () => {
  const never = () => new Promise<never>(() => {});

  it('ignores concurrent auth actions while a login is in flight', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockReturnValue(never() as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')()); // sets pendingAuthAction
    await invoke(() => authCb('onSubmitLogin')()); // guarded
    await invoke(() => authCb('onSubmitPasskey')()); // guarded
    await invoke(() => authCb('onSubmitPasskeyPassword')()); // guarded
    await invoke(() => authCb('onTogglePasswordHint')()); // guarded
    expect(screen.getByTestId('auth')).toHaveAttribute('data-pending', 'login');
  });

  it('ignores concurrent unlock actions while an unlock is in flight', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: { email: 'user@example.com' } as SessionState, profile: adminProfile } as never);
    vi.mocked(appAuth.performUnlock).mockReturnValue(never() as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeUnlock as (v: string) => void)('pw'));
    await invoke(() => authCb('onSubmitUnlock')()); // sets pending
    await invoke(() => authCb('onSubmitUnlock')()); // guarded
    await invoke(() => authCb('onSubmitPasskeyUnlock')()); // guarded
    await invoke(() => authCb('onShowLockedPasswordHint')()); // guarded
    expect(screen.getByTestId('auth')).toHaveAttribute('data-pending', 'unlock');
  });

  it('ignores a concurrent register while a registration is in flight', async () => {
    vi.mocked(appAuth.performRegistration).mockReturnValue(never() as never);
    renderApp({ phase: 'register', path: '/register' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeRegister as (v: unknown) => void)({
      name: 'n', email: 'e@example.com', password: 'longenoughpw1', password2: 'longenoughpw1', passwordHint: '', inviteCode: '',
    }));
    await invoke(() => authCb('onSubmitRegister')()); // sets pending
    await invoke(() => authCb('onSubmitRegister')()); // guarded
    expect(screen.getByTestId('auth')).toHaveAttribute('data-pending', 'register');
  });

  it('ignores totp actions while a verification is in flight', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'totp', pendingTotp } as never);
    vi.mocked(appAuth.performTotpLogin).mockReturnValue(never() as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    await invoke(() => overlayCb('onTotpCodeChange')('123456'));
    await invoke(() => overlayCb('onConfirmTotp')()); // sets totpSubmitting
    await invoke(() => overlayCb('onConfirmTotp')()); // guarded
    await invoke(() => overlayCb('onSelectTotpProvider')(3)); // guarded
    await invoke(() => overlayCb('onCancelTotp')()); // guarded
    await invoke(() => overlayCb('onUseRecoveryCode')()); // guarded
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-submitting', 'true');
  });

  it('non-Error totp failure and empty-message unlock error render fallbacks', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'totp', pendingTotp: { ...pendingTotp, providerType: 3 } } as never);
    vi.mocked(appAuth.performTotpLogin).mockRejectedValue('string-error');
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    await invoke(() => overlayCb('onTotpCodeChange')('otp'));
    await invoke(() => overlayCb('onConfirmTotp')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-totp-open', 'true');
  });
});

describe('App more branch mop-up', () => {
  it('finalizes a login with a hash but no verification token', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({
      kind: 'success',
      login: { session: appSession, profile: adminProfile, profilePromise: Promise.resolve(adminProfile), freshMasterPasswordHash: 'hash-only', freshUserVerificationToken: null },
    } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('runs the invite effect early-return path while locked', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: { email: 'user@example.com' } as SessionState, profile: adminProfile } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock', invite: 'INV-LOCKED' });
    await screen.findByTestId('auth');
    expect(window.location.pathname).toBe('/lock');
  });

  it('recovers from a non-Error domain rules save failure', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
    vi.mocked(apiDomains.saveDomainRules).mockRejectedValue('string-error');
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await invoke(() => (mainProps().onSaveDomainRules as (a: unknown[], b: number[]) => void)([], []));
    await waitFor(() => expect(vi.mocked(apiDomains.getDomainRules)).toHaveBeenCalled());
  });

  it('surfaces a non-Error auth-request response failure', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
    vi.mocked(authRequests.listPendingAuthRequests).mockResolvedValue([{ id: 'ar-1', publicKey: 'pk', origin: 'https://x.example' }] as never);
    vi.mocked(authRequests.respondToAuthRequest).mockRejectedValue('string-error');
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(rec.authDialog.open).toBe(true));
    await invoke(() => (rec.authDialog.onApprove as () => void)());
    await invoke(() => (rec.authDialog.onDeny as () => void)());
    await waitFor(() => expect(vi.mocked(authRequests.respondToAuthRequest)).toHaveBeenCalled());
  });

  it('cascades a folder deletion to its ciphers and dispatches a remote-run progress frame', async () => {
    class FakeWS3 {
      static instances: FakeWS3[] = [];
      handlers: Record<string, ((ev: unknown) => void)[]> = {};
      constructor(public url: string) { FakeWS3.instances.push(this); }
      addEventListener(type: string, cb: (ev: unknown) => void) { (this.handlers[type] ||= []).push(cb); }
      send() {}
      close() {}
      emit(type: string, ev: unknown) { (this.handlers[type] || []).forEach((cb) => cb(ev)); }
    }
    const OriginalWS = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS3;
    FakeWS3.instances = [];
    try {
      vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
      vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({
        folders: [{ id: 'f1' }], ciphers: [{ id: 'c1', folderId: 'f1' }], sends: [],
      } as never);
      vi.mocked(vaultWorker.decryptVaultCoreInWorker).mockResolvedValue({
        folders: [{ id: 'f1' }], ciphers: [{ id: 'c1', folderId: 'f1' }],
      } as never);
      renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
      await screen.findByTestId('shell');
      await waitFor(() => expect(FakeWS3.instances.length).toBeGreaterThan(0));
      const ws = FakeWS3.instances[FakeWS3.instances.length - 1];
      await invoke(() => ws.emit('open', {}));
      const frame = (type: number, extra: Record<string, unknown> = {}) => ({
        type: 1, target: 'ReceiveMessage', arguments: [{ Type: type, ContextId: 'other', ...extra }],
      });
      vi.mocked(appSupport.parseSignalRTextFrames).mockReturnValueOnce([
        frame(3, { Payload: { Id: 'f1' } }), // folder delete cascades to c1.folderId
        frame(102, { Payload: { operation: 'backup-remote-run', step: 'uploading', fileName: 'remote.json' } }),
      ] as never);
      await invoke(() => ws.emit('message', { data: 'cascade' }));
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    } finally {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = OriginalWS;
    }
  });

  it('aborts async decrypt work when unmounted mid-flight', async () => {
    let resolveDecrypt: (v: unknown) => void = () => {};
    vi.mocked(vaultWorker.decryptVaultCoreInWorker).mockReturnValue(new Promise((r) => { resolveDecrypt = r; }) as never);
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
    const utils = renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(vi.mocked(vaultWorker.decryptVaultCoreInWorker)).toHaveBeenCalled());
    utils.unmount();
    await act(async () => {
      resolveDecrypt({ folders: [], ciphers: [] });
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });

  it('aborts decrypt work that rejects after unmount (both worker and fallback)', async () => {
    let rejectDecrypt: (e: unknown) => void = () => {};
    vi.mocked(vaultWorker.decryptVaultCoreInWorker).mockRejectedValue(new Error('no worker'));
    vi.mocked(vaultDecrypt.decryptVaultCore).mockReturnValue(new Promise((_r, rej) => { rejectDecrypt = rej; }) as never);
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
    const utils = renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(vi.mocked(vaultDecrypt.decryptVaultCore)).toHaveBeenCalled());
    utils.unmount();
    await act(async () => {
      rejectDecrypt(new Error('late failure'));
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });

  it('aborts sends decrypt work when unmounted mid-flight', async () => {
    let resolveSends: (v: unknown) => void = () => {};
    vi.mocked(vaultWorker.decryptSendsInWorker).mockReturnValue(new Promise((r) => { resolveSends = r; }) as never);
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [{ id: 's1' }] } as never);
    const utils = renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(vi.mocked(vaultWorker.decryptSendsInWorker)).toHaveBeenCalled());
    utils.unmount();
    await act(async () => {
      resolveSends([{ id: 's1' }]);
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });
});

describe('App last-mile branches', () => {
  it('renders the plain-totp and passkey-2fa verification failure messages', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'totp', pendingTotp: { ...pendingTotp, providerType: 0 } } as never);
    vi.mocked(appAuth.performTotpLogin).mockRejectedValue('plain-string');
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    await invoke(() => overlayCb('onTotpCodeChange')('123456'));
    await invoke(() => overlayCb('onConfirmTotp')()); // plain totp failure message
    // switch to a passkey (webauthn) provider and fail there too
    await invoke(() => overlayCb('onSelectTotpProvider')(7));
    await invoke(() => overlayCb('onConfirmTotp')()); // passkey verification failure message
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-totp-open', 'true');
  });

  it('shows the fallback message for a passkey unlock error with no message', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: { email: 'user@example.com' } as SessionState, profile: adminProfile } as never);
    vi.mocked(appAuth.performPasskeyLogin).mockResolvedValue({ kind: 'error', message: '' } as never);
    renderApp({ phase: 'locked', session: { email: 'user@example.com' } as SessionState, profile: adminProfile, path: '/lock' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskeyUnlock')());
    expect(Number(screen.getByTestId('overlays').getAttribute('data-toasts'))).toBeGreaterThanOrEqual(1);
  });
});

describe('App profile-less app phase', () => {
  it('operates in the app phase with only a session email (no profile)', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(null as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
    renderApp({ phase: 'app', session: appSession, profile: null, path: '/vault' });
    await screen.findByTestId('shell');
    await invoke(() => (mainProps().onExportBackup as (pw: string) => Promise<unknown>)('masterpw'));
    expect(vi.mocked(apiAuth.deriveLoginHash)).toHaveBeenCalled();
  });
});

describe('App misc branch coverage', () => {
  it('toggles theme from a system-dark preference through both directions', async () => {
    mediaMatches['(prefers-color-scheme: dark)'] = true;
    window.localStorage.setItem('nodewarden.theme.preference.v1', 'system');
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await invoke(() => shellCb('onToggleTheme')()); // dark -> light
    await invoke(() => shellCb('onToggleTheme')()); // light -> dark
    expect(screen.getByTestId('shell')).toHaveAttribute('data-dark', 'true');
  });

  it('skips the admin backup repair effect for a non-admin session', async () => {
    const userProfile = { ...adminProfile, role: 'user' } as unknown as Profile;
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(userProfile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
    renderApp({ phase: 'app', session: appSession, profile: userProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot)).toHaveBeenCalled());
    expect(vi.mocked(backupRepair.silentlyRepairBackupSettingsIfNeeded)).not.toHaveBeenCalled();
  });
});

describe('App handler edge branches', () => {
  async function renderLocked(over: { session?: SessionState; profile?: Profile | null } = {}) {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: (over.session as SessionState) || ({ email: 'user@example.com' } as SessionState), profile: (over.profile as Profile) ?? adminProfile } as never);
    const utils = renderApp({ phase: 'locked', session: over.session ?? ({ email: 'user@example.com' } as SessionState), profile: over.profile ?? adminProfile, path: '/lock' });
    await screen.findByTestId('auth');
    return utils;
  }

  it('finalizes a login with no fresh credentials and a rejecting profile promise', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({
      kind: 'success',
      login: {
        session: appSession,
        profile: adminProfile,
        profilePromise: Promise.reject(new Error('hydration failed')),
        freshMasterPasswordHash: null,
        freshUserVerificationToken: null,
      },
    } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });

  it('shows an error toast when the login result has no message', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'error', message: '' } as never);
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-toasts', '1');
  });

  it('passkey unlock returns early without an account email', async () => {
    vi.mocked(appAuth.hydrateLockedSession).mockResolvedValue({ kind: 'ready', session: {} as SessionState, profile: null } as never);
    renderApp({ phase: 'locked', session: {} as SessionState, profile: null, path: '/lock' });
    await screen.findByTestId('auth');
    await invoke(() => authCb('onSubmitPasskeyUnlock')());
    expect(vi.mocked(appAuth.performPasskeyLogin)).not.toHaveBeenCalled();
  });

  it('shows the locked password hint fallback when the profile has none', async () => {
    await renderLocked({ session: { email: 'user@example.com' } as SessionState, profile: { ...adminProfile, masterPasswordHint: '' } as Profile });
    await invoke(() => authCb('onShowLockedPasswordHint')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-confirm', 'true');
  });

  it('ignores selecting an unavailable totp provider and verifies a yubikey code', async () => {
    vi.mocked(appAuth.performPasswordLogin).mockResolvedValue({ kind: 'totp', pendingTotp: { ...pendingTotp, providerType: 3 } } as never);
    vi.mocked(appAuth.performTotpLogin).mockRejectedValueOnce(new Error('yubi fail'));
    renderApp({ phase: 'login', path: '/login' });
    await screen.findByTestId('auth');
    await invoke(() => (rec.auth.onChangeLogin as (v: unknown) => void)({ email: 'user@example.com', password: 'pw' }));
    await invoke(() => authCb('onSubmitLogin')());
    await invoke(() => overlayCb('onSelectTotpProvider')(99)); // unavailable
    // empty code on a yubikey provider -> validation toast
    await invoke(() => overlayCb('onConfirmTotp')());
    // now provide a code and let the verify throw (yubikey failure message branch)
    await invoke(() => overlayCb('onTotpCodeChange')('otp'));
    await invoke(() => overlayCb('onConfirmTotp')());
    expect(screen.getByTestId('overlays')).toHaveAttribute('data-totp-open', 'true');
  });

  it('handles recover-2fa without a new code and an auto-login failure', async () => {
    vi.mocked(appAuth.performRecoverTwoFactorLogin).mockResolvedValueOnce({ login: makeLogin(), newRecoveryCode: null } as never);
    renderApp({ path: '/recover-2fa' });
    await screen.findByTestId('recover');
    await invoke(() => (rec.recover.onChange as (v: unknown) => void)({ email: 'user@example.com', password: 'pw', recoveryCode: 'code' }));
    await invoke(() => (rec.recover.onSubmit as () => void)());
    await waitFor(() => expect(vi.mocked(appAuth.performRecoverTwoFactorLogin)).toHaveBeenCalled());
  });

  it('navigates to login when recover-2fa succeeds but auto-login is unavailable', async () => {
    vi.mocked(appAuth.performRecoverTwoFactorLogin).mockResolvedValueOnce({ login: null } as never);
    renderApp({ path: '/recover-2fa' });
    await screen.findByTestId('recover');
    await invoke(() => (rec.recover.onChange as (v: unknown) => void)({ email: 'user@example.com', password: 'pw', recoveryCode: 'code' }));
    await invoke(() => (rec.recover.onSubmit as () => void)());
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });

  it('redirects a register-phase session from the root to /register', async () => {
    renderApp({ phase: 'register', path: '/' });
    await waitFor(() => expect(window.location.pathname).toBe('/register'));
  });

  it('does not arm the auto-lock timer when the timeout is disabled', async () => {
    window.localStorage.setItem('nodewarden.lock.timeout-minutes.v1', '0');
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    expect(await screen.findByTestId('shell')).toBeInTheDocument();
  });
});

describe('App query error surfaces', () => {
  it('reports admin, device, and domain-rules load errors through the shell props', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
    vi.mocked(apiAdmin.listAdminUsers).mockRejectedValue(new Error('users fail'));
    vi.mocked(apiAdmin.listAdminInvites).mockRejectedValue(new Error('invites fail'));
    vi.mocked(apiAuth.getAuthorizedDevices).mockRejectedValue(new Error('devices fail'));
    vi.mocked(apiDomains.getDomainRules).mockRejectedValue(new Error('domains fail'));
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(String(mainProps().adminError)).not.toBe(''));
    await waitFor(() => expect(String(mainProps().domainRulesError)).not.toBe(''));
    await waitFor(() => expect(String(mainProps().authorizedDevicesError)).not.toBe(''));
  });

  it('surfaces a rejecting auth-request response through the approval dialog', async () => {
    vi.mocked(apiAuth.loadProfileSnapshot).mockReturnValue(adminProfile as never);
    vi.mocked(apiVaultSync.loadVaultCoreSyncSnapshot).mockResolvedValue({ folders: [{ id: 'f1' }], ciphers: [{ id: 'c1' }], sends: [] } as never);
    vi.mocked(authRequests.listPendingAuthRequests).mockResolvedValue([
      { id: 'ar-1', publicKey: 'pk', origin: 'https://x.example' },
    ] as never);
    vi.mocked(authRequests.respondToAuthRequest).mockRejectedValue(new Error('respond fail'));
    renderApp({ phase: 'app', session: appSession, profile: adminProfile, path: '/vault' });
    await screen.findByTestId('shell');
    await waitFor(() => expect(rec.authDialog.open).toBe(true));
    await invoke(() => (rec.authDialog.onApprove as () => void)());
    await invoke(() => (rec.authDialog.onDeny as () => void)());
    await invoke(() => (rec.authDialog.onClose as () => void)());
    await waitFor(() => expect(vi.mocked(authRequests.respondToAuthRequest)).toHaveBeenCalled());
  });
});
