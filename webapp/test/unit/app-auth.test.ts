import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, SessionState, TokenSuccess } from '@/lib/types';

// app-auth.ts composes a number of api/storage modules. We mock those module
// boundaries so the orchestration logic (bootstrap state machine, login/unlock
// branches) is what gets exercised; i18n stays real (its output is
// deterministic).

const api = {
  createAuthedFetch: vi.fn(() => vi.fn()),
  deriveLoginHashLocally: vi.fn(),
  getAccountPasskeyAssertionOptions: vi.fn(),
  getProfile: vi.fn(),
  loadProfileSnapshot: vi.fn(() => null),
  loadSession: vi.fn(() => null),
  loginWithAccountPasskeyAssertion: vi.fn(),
  loginWithPassword: vi.fn(),
  refreshAccessToken: vi.fn(),
  recoverTwoFactor: vi.fn(),
  registerAccount: vi.fn(),
  unlockVaultKey: vi.fn(),
};

const passkeys = {
  assertAccountPasskey: vi.fn(),
  unlockVaultKeyWithAccountPasskeyPrf: vi.fn(),
};

const support = {
  readInviteCodeFromUrl: vi.fn(() => ''),
};

const offline = {
  getOfflineUnlockKdfIterations: vi.fn(() => 0),
  hasOfflineUnlockRecord: vi.fn(() => false),
  kdfIterationsFromLogin: vi.fn((_token: TokenSuccess, fallback: number) => fallback),
  loadOfflineProfileSnapshot: vi.fn(() => null),
  saveOfflineUnlockRecord: vi.fn(),
  unlockOfflineVaultWithMasterKey: vi.fn(),
};

const network = {
  probeNodeWardenService: vi.fn(),
};

vi.mock('@/lib/api/auth', () => api);
vi.mock('@/lib/account-passkeys', () => passkeys);
vi.mock('@/lib/app-support', () => support);
vi.mock('@/lib/offline-auth', () => offline);
vi.mock('@/lib/network-status', () => network);

type AppAuthModule = typeof import('@/lib/app-auth');

async function loadModule(): Promise<AppAuthModule> {
  return import('@/lib/app-auth');
}

function setWindowBoot(boot: unknown): void {
  (window as unknown as { __NW_BOOT__?: unknown }).__NW_BOOT__ = boot;
}

function setNavigatorOnLine(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function makeToken(overrides: Partial<TokenSuccess> = {}): TokenSuccess {
  return {
    access_token: 'header.eyJzdWIiOiJ1c2VyLTEiLCJlbWFpbCI6InVAZXhhbXBsZS5jb20ifQ.sig',
    refresh_token: 'refresh-1',
    Key: 'profile-key-cipher',
    ...overrides,
  } as TokenSuccess;
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    email: 'u@example.com',
    name: 'User',
    key: 'profile-key-cipher',
    role: 'user',
    ...overrides,
  } as Profile;
}

beforeEach(() => {
  vi.clearAllMocks();
  setWindowBoot(undefined);
  setNavigatorOnLine(true);
  delete (window as unknown as { __NW_BOOT__?: unknown }).__NW_BOOT__;
  localStorage.clear();
  // Restore default mock return values cleared by clearAllMocks.
  api.createAuthedFetch.mockReturnValue(vi.fn());
  api.loadProfileSnapshot.mockReturnValue(null);
  api.loadSession.mockReturnValue(null);
  support.readInviteCodeFromUrl.mockReturnValue('');
  offline.getOfflineUnlockKdfIterations.mockReturnValue(0);
  offline.hasOfflineUnlockRecord.mockReturnValue(false);
  offline.kdfIterationsFromLogin.mockImplementation((_t: TokenSuccess, fb: number) => fb);
  offline.loadOfflineProfileSnapshot.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('readInitialAppBootstrapState', () => {
  it('defaults to login with the default kdf iterations when no session/boot', async () => {
    const mod = await loadModule();
    const state = mod.readInitialAppBootstrapState();
    expect(state.defaultKdfIterations).toBe(600000);
    expect(state.session).toBeNull();
    expect(state.phase).toBe('login');
    expect(state.jwtWarning).toBeNull();
  });

  it('produces a jwtWarning and forces login phase when boot signals an unsafe jwt', async () => {
    setWindowBoot({ jwtUnsafeReason: 'too_short', jwtSecretMinLength: 32 });
    const mod = await loadModule();
    const state = mod.readInitialAppBootstrapState();
    expect(state.jwtWarning).toEqual({ reason: 'too_short', minLength: 32 });
    expect(state.phase).toBe('login');
  });

  it('uses the locked phase when a session is present', async () => {
    api.loadSession.mockReturnValue({ email: 'u@example.com', authMode: 'token' } as SessionState);
    const mod = await loadModule();
    expect(mod.readInitialAppBootstrapState().phase).toBe('locked');
  });

  it('selects the register phase when an invite code is in the URL', async () => {
    support.readInviteCodeFromUrl.mockReturnValue('INVITE');
    const mod = await loadModule();
    expect(mod.readInitialAppBootstrapState().phase).toBe('register');
  });

  it('selects register when invites are not required (registrationInviteRequired=false)', async () => {
    setWindowBoot({ registrationInviteRequired: false });
    const mod = await loadModule();
    const state = mod.readInitialAppBootstrapState();
    expect(state.registrationInviteRequired).toBe(false);
    expect(state.phase).toBe('register');
  });
});

describe('bootstrapAppSession', () => {
  function stubFetch(json: unknown, ok = true): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(json) })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the login phase and clears the session when a jwt warning is present', async () => {
    stubFetch({ jwtUnsafeReason: 'missing', jwtSecretMinLength: 32 });
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession({
      defaultKdfIterations: 600000,
      jwtWarning: null,
      session: { email: 'u@example.com', authMode: 'token' } as SessionState,
      phase: 'locked',
    });
    expect(result.phase).toBe('login');
    expect(result.session).toBeNull();
    expect(result.jwtWarning).toEqual({ reason: 'missing', minLength: 32 });
  });

  it('returns an unauthenticated phase when there is no loaded session', async () => {
    stubFetch({});
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession({
      defaultKdfIterations: 600000,
      jwtWarning: null,
      session: null,
      phase: 'login',
    });
    expect(result.session).toBeNull();
    expect(result.profile).toBeNull();
    expect(result.phase).toBe('login');
  });

  it('returns the cached profile snapshot and flags background hydration', async () => {
    stubFetch({});
    const cached = makeProfile();
    api.loadProfileSnapshot.mockReturnValue(cached);
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession({
      defaultKdfIterations: 600000,
      jwtWarning: null,
      session: { email: 'u@example.com', authMode: 'token' } as SessionState,
      phase: 'locked',
    });
    expect(result.phase).toBe('locked');
    expect(result.profile).toBe(cached);
    expect(result.needsBackgroundHydration).toBe(true);
  });

  it('returns a locked phase with no profile when nothing is cached', async () => {
    stubFetch({});
    api.loadProfileSnapshot.mockReturnValue(null);
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession({
      defaultKdfIterations: 600000,
      jwtWarning: null,
      session: { email: 'u@example.com', authMode: 'token' } as SessionState,
      phase: 'locked',
    });
    expect(result.phase).toBe('locked');
    expect(result.profile).toBeNull();
    expect(result.needsBackgroundHydration).toBe(true);
  });

  it('uses the 600000 default when the bootstrap fetch fails (empty response)', async () => {
    // A rejected fetch yields {}; normalizeBootstrapResponse defaults the
    // iteration count to 600000, which (being truthy) wins over the initial.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession({
      defaultKdfIterations: 123456,
      jwtWarning: null,
      session: null,
      phase: 'login',
    });
    expect(result.defaultKdfIterations).toBe(600000);
    expect(result.phase).toBe('login');
  });
});

describe('hydrateLockedSession', () => {
  const session: SessionState = {
    email: 'u@example.com',
    authMode: 'token',
    accessToken: 'old',
    refreshToken: 'r',
  };

  it('returns the offline snapshot when an offline record exists and the browser is offline', async () => {
    offline.hasOfflineUnlockRecord.mockReturnValue(true);
    setNavigatorOnLine(false);
    const offlineProfile = makeProfile({ name: 'Offline' });
    offline.loadOfflineProfileSnapshot.mockReturnValue(offlineProfile);
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(result.session).toBe(session);
    expect(result.profile).toBe(offlineProfile);
    expect(api.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('returns a null session when refresh fails and there is no offline record', async () => {
    offline.hasOfflineUnlockRecord.mockReturnValue(false);
    // Expired token + a failed non-transient refresh => session dropped.
    api.refreshAccessToken.mockResolvedValue({ ok: false, transient: false });
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession({ ...session, accessToken: undefined });
    expect(result.session).toBeNull();
    expect(result.profile).toBeNull();
  });

  it('fetches the profile after a successful refresh', async () => {
    api.refreshAccessToken.mockResolvedValue({
      ok: true,
      token: { access_token: 'new', refresh_token: 'r2' },
    });
    const fetched = makeProfile({ name: 'Fresh' });
    api.getProfile.mockResolvedValue(fetched);
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession({ ...session, accessToken: undefined });
    expect(result.session?.accessToken).toBe('new');
    expect(result.profile).toBe(fetched);
  });

  it('returns the fallback profile when the profile fetch throws', async () => {
    api.refreshAccessToken.mockResolvedValue({
      ok: true,
      token: { access_token: 'new', refresh_token: 'r2' },
    });
    api.getProfile.mockRejectedValue(new Error('500'));
    const fallback = makeProfile({ name: 'Fallback' });
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession({ ...session, accessToken: undefined }, fallback);
    expect(result.session?.accessToken).toBe('new');
    expect(result.profile).toBe(fallback);
  });

  it('serves the offline snapshot when refresh fails but the service is unreachable', async () => {
    offline.hasOfflineUnlockRecord.mockReturnValue(true);
    setNavigatorOnLine(true);
    api.refreshAccessToken.mockResolvedValue({ ok: false, transient: false });
    network.probeNodeWardenService.mockResolvedValue(false);
    const offlineProfile = makeProfile({ name: 'OfflineRefresh' });
    offline.loadOfflineProfileSnapshot.mockReturnValue(offlineProfile);
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession({ ...session, accessToken: undefined });
    expect(result.session).toEqual({ ...session, accessToken: undefined });
    expect(result.profile).toBe(offlineProfile);
  });
});

describe('performPasswordLogin', () => {
  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'derived-hash',
      masterKey: new Uint8Array([1, 2, 3]),
      kdfIterations: 600000,
    });
  });

  it('returns a completed login on a successful token response', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'enc', symMacKey: 'mac' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('U@Example.com', 'pw', 600000);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.login.session.symEncKey).toBe('enc');
      expect(result.login.profile.email).toBe('u@example.com');
    }
    expect(offline.saveOfflineUnlockRecord).toHaveBeenCalled();
  });

  it('returns a totp pending result when the server requires two factor', async () => {
    api.loginWithPassword.mockResolvedValue({ TwoFactorProviders: ['totp'] });
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    expect(result.kind).toBe('totp');
    if (result.kind === 'totp') {
      expect(result.pendingTotp.email).toBe('u@example.com');
      expect(result.pendingTotp.passwordHash).toBe('derived-hash');
    }
  });

  it('returns a translated error when login fails outright', async () => {
    api.loginWithPassword.mockResolvedValue({ error_description: 'Account is disabled' });
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Account is disabled');
    }
  });

  it('throws when the token has no profile key', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken({ Key: '' }));
    const mod = await loadModule();
    await expect(mod.performPasswordLogin('u@example.com', 'pw', 600000)).rejects.toThrow(
      'Missing profile key'
    );
  });
});

describe('performPasskeyLogin', () => {
  it('completes via PRF when a prf option and prf key are available', async () => {
    api.getAccountPasskeyAssertionOptions.mockResolvedValue({ options: {}, token: 't' });
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: new Uint8Array([9]) });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(
      makeToken({ UserDecryptionOptions: { WebAuthnPrfOption: { kind: 'prf' } } } as Partial<TokenSuccess>)
    );
    passkeys.unlockVaultKeyWithAccountPasskeyPrf.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.login.session.symEncKey).toBe('e');
    }
  });

  it('falls back to a password prompt when no prf option is present', async () => {
    api.getAccountPasskeyAssertionOptions.mockResolvedValue({ options: {}, token: 't' });
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(makeToken());
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('password');
    if (result.kind === 'password') {
      expect(result.pendingPasskeyPassword.email).toBe('u@example.com');
    }
  });

  it('errors when the assertion login fails', async () => {
    api.getAccountPasskeyAssertionOptions.mockResolvedValue({ options: {}, token: 't' });
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue({ error_description: 'Account is disabled' });
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Account is disabled');
    }
  });

  it('rejects when the passkey belongs to a different locked account', async () => {
    api.getAccountPasskeyAssertionOptions.mockResolvedValue({ options: {}, token: 't' });
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(makeToken());
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000, 'someone-else@example.com');
    expect(result.kind).toBe('error');
  });

  it('returns an error when an exception is thrown', async () => {
    api.getAccountPasskeyAssertionOptions.mockRejectedValue(new Error('boom'));
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('boom');
    }
  });
});

describe('performTotpLogin', () => {
  const pending = {
    email: 'u@example.com',
    passwordHash: 'h',
    masterKey: new Uint8Array([1]),
    kdfIterations: 600000,
  };

  it('completes the login when the totp code is accepted', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const login = await mod.performTotpLogin(pending, ' 123456 ', true);
    expect(login.session.symEncKey).toBe('e');
    // Code is trimmed before being sent.
    expect(api.loginWithPassword).toHaveBeenCalledWith(
      'u@example.com',
      'h',
      expect.objectContaining({ totpCode: '123456', rememberDevice: true })
    );
  });

  it('throws a translated error when the totp code is rejected', async () => {
    api.loginWithPassword.mockResolvedValue({ error_description: 'Two-step token is invalid. Try again.' });
    const mod = await loadModule();
    await expect(mod.performTotpLogin(pending, '000000', false)).rejects.toThrow();
  });
});

describe('completePasskeyPasswordLogin', () => {
  it('derives the hash and completes the login', async () => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'h',
      masterKey: new Uint8Array([2]),
      kdfIterations: 600000,
    });
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const login = await mod.completePasskeyPasswordLogin(
      { token: makeToken(), email: 'u@example.com', kdfIterations: 600000 },
      'pw'
    );
    expect(login.session.symEncKey).toBe('e');
    expect(api.deriveLoginHashLocally).toHaveBeenCalledWith('u@example.com', 'pw', 600000);
  });
});

describe('performRecoverTwoFactorLogin', () => {
  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'h',
      masterKey: new Uint8Array([3]),
      kdfIterations: 600000,
    });
  });

  it('returns the completed login and new recovery code on success', async () => {
    api.recoverTwoFactor.mockResolvedValue({ newRecoveryCode: 'NEWCODE' });
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.performRecoverTwoFactorLogin('u@example.com', 'pw', ' code ', 600000);
    expect(result.newRecoveryCode).toBe('NEWCODE');
    expect(result.login).not.toBeNull();
    expect(api.recoverTwoFactor).toHaveBeenCalledWith('u@example.com', 'h', 'code');
  });

  it('returns a null login when the follow-up password login does not succeed', async () => {
    api.recoverTwoFactor.mockResolvedValue({ newRecoveryCode: 'X' });
    api.loginWithPassword.mockResolvedValue({ error_description: 'nope' });
    const mod = await loadModule();
    const result = await mod.performRecoverTwoFactorLogin('u@example.com', 'pw', 'code', 600000);
    expect(result.login).toBeNull();
    expect(result.newRecoveryCode).toBe('X');
  });
});

describe('performRegistration', () => {
  it('normalizes and trims inputs before delegating to registerAccount', async () => {
    api.registerAccount.mockResolvedValue({ ok: true });
    const mod = await loadModule();
    await mod.performRegistration({
      email: '  USER@Example.com ',
      name: '  Name  ',
      password: 'pw',
      masterPasswordHint: '  hint ',
      inviteCode: ' INV ',
      fallbackIterations: 600000,
    });
    expect(api.registerAccount).toHaveBeenCalledWith({
      email: 'user@example.com',
      name: 'Name',
      password: 'pw',
      masterPasswordHint: 'hint',
      inviteCode: 'INV',
      fallbackIterations: 600000,
    });
  });
});

describe('performUnlock', () => {
  const session: SessionState = { email: 'u@example.com', authMode: 'token' };

  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'h',
      masterKey: new Uint8Array([4]),
      kdfIterations: 600000,
    });
  });

  it('unlocks offline when an offline record exists and the browser is offline', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(1000);
    setNavigatorOnLine(false);
    const profile = makeProfile();
    offline.unlockOfflineVaultWithMasterKey.mockResolvedValue({
      session: { ...session, symEncKey: 'e', symMacKey: 'm' },
      profile,
    });
    const mod = await loadModule();
    const result = await mod.performUnlock(session, profile, 'pw', 600000);
    expect(result.kind).toBe('success');
    expect(api.loginWithPassword).not.toHaveBeenCalled();
  });

  it('returns an error when offline unlock fails', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(1000);
    setNavigatorOnLine(false);
    offline.unlockOfflineVaultWithMasterKey.mockRejectedValue(new Error('bad pw'));
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('error');
  });

  it('completes an online unlock through the password login path', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('success');
  });

  it('returns a totp pending result when unlock triggers two factor', async () => {
    api.loginWithPassword.mockResolvedValue({ TwoFactorProviders: ['totp'] });
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('totp');
  });

  it('falls back to offline unlock when the network login throws and the service is unreachable', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(1000);
    setNavigatorOnLine(true);
    api.loginWithPassword.mockRejectedValue(new Error('network'));
    network.probeNodeWardenService.mockResolvedValue(false);
    const profile = makeProfile();
    offline.unlockOfflineVaultWithMasterKey.mockResolvedValue({
      session: { ...session, symEncKey: 'e', symMacKey: 'm' },
      profile,
    });
    const mod = await loadModule();
    const result = await mod.performUnlock(session, profile, 'pw', 600000);
    expect(result.kind).toBe('success');
  });

  it('returns an incorrect-password error when the network login throws and no offline record exists', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(0);
    api.loginWithPassword.mockRejectedValue(new Error('network'));
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('error');
  });

  it('returns a translated error when the server rejects the unlock', async () => {
    api.loginWithPassword.mockResolvedValue({ error_description: 'Account is disabled' });
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Account is disabled');
    }
  });
});
