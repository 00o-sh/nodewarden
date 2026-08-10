import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, SessionState, TokenSuccess } from '@/lib/types';
import { t } from '@/lib/i18n';

// Mutation-killing black-box suite for lib/app-auth.ts. It mirrors the harness
// of app-auth.test.ts (same module mocks, same dynamic import) but asserts the
// EXACT observable outputs of the module's internal helpers, driven through the
// public API, so surviving Stryker mutants die.

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

// base64url-encode a JSON claims object into a JWT payload segment.
function b64url(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build a JWT-shaped `header.<payload>.sig` access token from claims.
function makeJwt(claims: Record<string, unknown>): string {
  return `header.${b64url(claims)}.sig`;
}

// Build a 2-segment token (`header.<payload>`, no signature).
function makeJwt2(claims: Record<string, unknown>): string {
  return `header.${b64url(claims)}`;
}

function makeToken(overrides: Partial<TokenSuccess> = {}): TokenSuccess {
  return {
    access_token: makeJwt({ sub: 'user-1', email: 'u@example.com' }),
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

// A resolved 2FA response, typed loosely for the loginWithPassword mock.
function twoFactorResponse(body: Record<string, unknown>): TokenSuccess {
  return body as unknown as TokenSuccess;
}

beforeEach(() => {
  vi.clearAllMocks();
  setWindowBoot(undefined);
  setNavigatorOnLine(true);
  delete (window as unknown as { __NW_BOOT__?: unknown }).__NW_BOOT__;
  localStorage.clear();
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

// ---------------------------------------------------------------------------
// maybeRefreshSession + decodeJwtExp (reached through hydrateLockedSession)
// ---------------------------------------------------------------------------
describe('maybeRefreshSession / decodeJwtExp via hydrateLockedSession', () => {
  const FIXED_MS = 1_700_000_000_000;
  const NOW = Math.floor(FIXED_MS / 1000); // 1_700_000_000

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no refresh token + token authMode + access token => success (no refresh)', async () => {
    const session = { email: 'u@example.com', authMode: 'token', accessToken: 'keep' } as SessionState;
    const profile = makeProfile({ name: 'Kept' });
    api.getProfile.mockResolvedValue(profile);
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(api.refreshAccessToken).not.toHaveBeenCalled();
    expect(result.kind).toBe('ready');
    expect(result.session).toBe(session);
    expect(result.profile).toBe(profile);
  });

  it('no refresh token + token authMode + NO access token => expired', async () => {
    const session = { email: 'u@example.com', authMode: 'token' } as SessionState;
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(api.refreshAccessToken).not.toHaveBeenCalled();
    expect(result.kind).toBe('expired');
    expect(result.session).toBeNull();
    expect(result.profile).toBeNull();
  });

  it('empty authMode still enters the no-refresh-token branch (kills the web-cookie literal)', async () => {
    const session = {
      email: 'u@example.com',
      authMode: '' as unknown as SessionState['authMode'],
      accessToken: 'keep',
    } as SessionState;
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(api.refreshAccessToken).not.toHaveBeenCalled();
    expect(result.kind).toBe('ready');
  });

  it('exp far in the future does NOT refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_MS);
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'r',
      accessToken: makeJwt({ exp: NOW + 3600 }),
    } as SessionState;
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(api.refreshAccessToken).not.toHaveBeenCalled();
    expect(result.kind).toBe('ready');
    expect(result.session?.accessToken).toBe(session.accessToken);
  });

  it('exp = now + 61 (> 60) does NOT refresh (boundary just above)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_MS);
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'r',
      accessToken: makeJwt({ exp: NOW + 61 }),
    } as SessionState;
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    await mod.hydrateLockedSession(session);
    expect(api.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('exp = now + 60 (not > 60) DOES refresh (boundary at the edge)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_MS);
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'r',
      accessToken: makeJwt({ exp: NOW + 60 }),
    } as SessionState;
    api.refreshAccessToken.mockResolvedValue({ ok: true, token: { access_token: 'refreshed' } });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(api.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(result.session?.accessToken).toBe('refreshed');
  });

  it('token with no exp claim is refreshed', async () => {
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'r',
      accessToken: makeJwt({ sub: 'x' }),
    } as SessionState;
    api.refreshAccessToken.mockResolvedValue({ ok: true, token: { access_token: 'refreshed' } });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(api.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(result.session?.accessToken).toBe('refreshed');
  });

  it('a 2-segment token still decodes its exp (kills parts.length boundary)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_MS);
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'r',
      accessToken: makeJwt2({ exp: NOW + 3600 }),
    } as SessionState;
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    await mod.hydrateLockedSession(session);
    expect(api.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refresh success with web_session=true rewrites token/refresh/authMode to web-cookie', async () => {
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'r',
      accessToken: undefined,
    } as SessionState;
    api.refreshAccessToken.mockResolvedValue({
      ok: true,
      token: { access_token: 'na', refresh_token: 'nr', web_session: true },
    });
    const refreshed = makeProfile({ name: 'Refreshed' });
    api.getProfile.mockResolvedValue(refreshed);
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(result.kind).toBe('ready');
    expect(result.session?.accessToken).toBe('na');
    expect(result.session?.refreshToken).toBe('nr');
    expect(result.session?.authMode).toBe('web-cookie');
    expect(result.profile).toBe(refreshed);
    // The authed-fetch getter must yield the refreshed session, not undefined.
    const getSession = api.createAuthedFetch.mock.calls[0][0] as () => SessionState;
    expect(getSession().accessToken).toBe('na');
  });

  it('refresh success without web_session keeps prior refresh token and token authMode', async () => {
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'orig-refresh',
      accessToken: undefined,
    } as SessionState;
    api.refreshAccessToken.mockResolvedValue({ ok: true, token: { access_token: 'na' } });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(result.session?.accessToken).toBe('na');
    expect(result.session?.refreshToken).toBe('orig-refresh');
    expect(result.session?.authMode).toBe('token');
  });

  it('refresh success with empty prior authMode falls back to token (kills || default)', async () => {
    const session = {
      email: 'u@example.com',
      authMode: undefined,
      refreshToken: 'orig-refresh',
      accessToken: undefined,
    } as SessionState;
    api.refreshAccessToken.mockResolvedValue({ ok: true, token: { access_token: 'na' } });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(result.session?.authMode).toBe('token');
  });

  it('transient refresh with an error string surfaces that exact message', async () => {
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'r',
      accessToken: undefined,
    } as SessionState;
    api.refreshAccessToken.mockResolvedValue({
      ok: false,
      transient: true,
      error: 'temp-error',
      retryAfterMs: 1234,
    });
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(result.kind).toBe('transient');
    if (result.kind === 'transient') {
      expect(result.message).toBe('temp-error');
      expect(result.retryAfterMs).toBe(1234);
      expect(result.session).toBe(session);
      expect(result.profile).toBeNull();
    }
  });

  it('transient refresh with empty error falls back to the i18n message', async () => {
    const session = {
      email: 'u@example.com',
      authMode: 'token',
      refreshToken: 'r',
      accessToken: undefined,
    } as SessionState;
    api.refreshAccessToken.mockResolvedValue({ ok: false, transient: true, error: '' });
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(result.kind).toBe('transient');
    if (result.kind === 'transient') {
      expect(result.message).toBe(t('txt_session_refresh_temporarily_unavailable'));
    }
  });
});

// ---------------------------------------------------------------------------
// hydrateLockedSession branch/kind coverage
// ---------------------------------------------------------------------------
describe('hydrateLockedSession offline/online decisions', () => {
  const session = {
    email: 'u@example.com',
    authMode: 'token',
    accessToken: 'old',
    refreshToken: 'r',
  } as SessionState;

  it('offline record + browser offline returns ready snapshot without refreshing', async () => {
    offline.hasOfflineUnlockRecord.mockReturnValue(true);
    setNavigatorOnLine(false);
    const snap = makeProfile({ name: 'Snap' });
    offline.loadOfflineProfileSnapshot.mockReturnValue(snap);
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession(session);
    expect(result.kind).toBe('ready');
    expect(result.session).toBe(session);
    expect(result.profile).toBe(snap);
    expect(api.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('offline record but ONLINE proceeds to refresh (kills && -> ||)', async () => {
    offline.hasOfflineUnlockRecord.mockReturnValue(true);
    setNavigatorOnLine(true);
    api.refreshAccessToken.mockResolvedValue({ ok: true, token: { access_token: 'new' } });
    api.getProfile.mockResolvedValue(makeProfile({ name: 'Online' }));
    offline.loadOfflineProfileSnapshot.mockReturnValue(makeProfile({ name: 'Snap' }));
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession({ ...session, accessToken: undefined });
    expect(api.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('ready');
    expect(result.session?.accessToken).toBe('new');
    expect(result.profile?.name).toBe('Online');
  });

  it('expired refresh with no offline record clears the session', async () => {
    offline.hasOfflineUnlockRecord.mockReturnValue(false);
    api.refreshAccessToken.mockResolvedValue({ ok: false, transient: false });
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession({ ...session, accessToken: undefined });
    expect(result.kind).toBe('expired');
    expect(result.session).toBeNull();
  });

  it('ready after profile fetch throws returns the fallback profile', async () => {
    api.refreshAccessToken.mockResolvedValue({ ok: true, token: { access_token: 'new' } });
    api.getProfile.mockRejectedValue(new Error('500'));
    const fallback = makeProfile({ name: 'Fallback' });
    const mod = await loadModule();
    const result = await mod.hydrateLockedSession({ ...session, accessToken: undefined }, fallback);
    expect(result.kind).toBe('ready');
    expect(result.session?.accessToken).toBe('new');
    expect(result.profile).toBe(fallback);
  });
});

// ---------------------------------------------------------------------------
// buildTransientProfile (via performPasswordLogin success)
// ---------------------------------------------------------------------------
describe('buildTransientProfile', () => {
  beforeEach(() => {
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'enc', symMacKey: 'mac' });
    api.getProfile.mockResolvedValue(makeProfile());
  });

  it('maps every profile field from the token claims and the admin fallback', async () => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'derived-hash',
      masterKey: new Uint8Array([1, 2, 3]),
      kdfIterations: 600000,
    });
    api.loadProfileSnapshot.mockReturnValue(
      makeProfile({ role: 'admin', masterPasswordHint: 'the-hint', publicKey: 'the-pub' })
    );
    const token = makeToken({
      access_token: makeJwt({ sub: 'user-9', email: 'CLAIM@X.com', name: 'Claim Name', premium: true }),
      Key: 'the-key',
      PrivateKey: 'the-private',
      AccountKeys: { a: 1 },
    } as Partial<TokenSuccess>);
    api.loginWithPassword.mockResolvedValue(token);
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('Login@X.com', 'pw', 600000);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const p = result.login.profile;
    expect(p.id).toBe('user-9');
    expect(p.email).toBe('claim@x.com');
    expect(p.name).toBe('Claim Name');
    expect(p.key).toBe('the-key');
    expect(p.privateKey).toBe('the-private');
    expect(p.role).toBe('admin');
    expect(p.premium).toBe(true);
    expect(p.accountKeys).toEqual({ a: 1 });
    expect(p.masterPasswordHint).toBe('the-hint');
    expect(p.publicKey).toBe('the-pub');
    expect(p.object).toBe('profile');
  });

  it('falls back to the email param + user role + non-premium when claims and fallback are missing', async () => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'derived-hash',
      masterKey: new Uint8Array([1]),
      kdfIterations: 600000,
    });
    api.loadProfileSnapshot.mockReturnValue(null);
    const token = makeToken({
      access_token: makeJwt({ sub: 'only-sub' }),
      Key: 'k',
      PrivateKey: null,
      accountKeys: { b: 2 },
    } as Partial<TokenSuccess>);
    api.loginWithPassword.mockResolvedValue(token);
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('Fallback@X.com', 'pw', 600000);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const p = result.login.profile;
    expect(p.email).toBe('fallback@x.com');
    expect(p.name).toBe('fallback@x.com');
    expect(p.role).toBe('user');
    expect(p.premium).toBe(false);
    expect(p.privateKey).toBeNull();
    expect(p.accountKeys).toEqual({ b: 2 });
    expect(p.masterPasswordHint).toBeNull();
    expect(p.publicKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decodeAccessTokenClaims edge cases (via performPasswordLogin success)
// ---------------------------------------------------------------------------
describe('decodeAccessTokenClaims', () => {
  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'h',
      masterKey: new Uint8Array([1]),
      kdfIterations: 600000,
    });
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
  });

  it('decodes a 2-segment access token payload', async () => {
    api.loginWithPassword.mockResolvedValue(
      makeToken({ access_token: makeJwt2({ sub: 'two-part-sub', email: 'two@x.com' }), Key: 'k' } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('two@x.com', 'pw', 600000);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.login.profile.id).toBe('two-part-sub');
    expect(result.login.profile.email).toBe('two@x.com');
  });

  it('returns empty claims (does not throw) for an undecodable payload', async () => {
    api.loginWithPassword.mockResolvedValue(
      makeToken({ access_token: 'header.@@@@.sig', Key: 'k' } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('Recover@X.com', 'pw', 600000);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    // No sub claim -> id '' ; email falls back to the (normalized) login email.
    expect(result.login.profile.id).toBe('');
    expect(result.login.profile.email).toBe('recover@x.com');
  });
});

// ---------------------------------------------------------------------------
// completeLogin / readTokenUserVerificationToken / freshMasterPasswordHash
// (via completePasskeyPasswordLogin so we can feed an un-normalized email)
// ---------------------------------------------------------------------------
describe('completeLogin', () => {
  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'derived-hash',
      masterKey: new Uint8Array([1]),
      kdfIterations: 600000,
    });
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'enc', symMacKey: 'mac' });
    api.getProfile.mockResolvedValue(makeProfile());
  });

  it('normalizes the email into the session and the offline-unlock record', async () => {
    const token = makeToken({ access_token: makeJwt({ sub: 's', email: 'claim@x.com' }), Key: 'k' } as Partial<TokenSuccess>);
    const mod = await loadModule();
    const login = await mod.completePasskeyPasswordLogin(
      { token, email: '  Mixed@X.com  ', kdfIterations: 600000 },
      'pw'
    );
    expect(login.session.email).toBe('mixed@x.com');
    expect(login.session.accessToken).toBe(token.access_token);
    expect(login.session.refreshToken).toBe(token.refresh_token);
    expect(login.session.authMode).toBe('token');
    expect(login.session.symEncKey).toBe('enc');
    expect(login.session.symMacKey).toBe('mac');
    expect(offline.saveOfflineUnlockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'mixed@x.com', profileKey: 'k', kdfIterations: 600000 })
    );
    // The authed-fetch getter must return the base session, not undefined.
    const getSession = api.createAuthedFetch.mock.calls[0][0] as () => SessionState;
    expect(getSession().accessToken).toBe(token.access_token);
  });

  it('sets authMode web-cookie when the token is a web session', async () => {
    const token = makeToken({ web_session: true, Key: 'k' } as Partial<TokenSuccess>);
    const mod = await loadModule();
    const login = await mod.completePasskeyPasswordLogin(
      { token, email: 'u@example.com', kdfIterations: 600000 },
      'pw'
    );
    expect(login.session.authMode).toBe('web-cookie');
  });

  it('carries the fresh master-password hash through (|| null)', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken());
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.login.freshMasterPasswordHash).toBe('derived-hash');
  });

  it('reads and trims the UserVerificationToken', async () => {
    api.loginWithPassword.mockResolvedValue(
      makeToken({ UserVerificationToken: '  uvt-123  ' } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    if (result.kind !== 'success') throw new Error('expected success');
    expect(result.login.freshUserVerificationToken).toBe('uvt-123');
  });

  it('reads the camelCase userVerificationToken fallback', async () => {
    api.loginWithPassword.mockResolvedValue(
      makeToken({ userVerificationToken: 'lower-uvt' } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    if (result.kind !== 'success') throw new Error('expected success');
    expect(result.login.freshUserVerificationToken).toBe('lower-uvt');
  });

  it('yields a null verification token when neither field is present', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken());
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    if (result.kind !== 'success') throw new Error('expected success');
    expect(result.login.freshUserVerificationToken).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// completeLoginWithVaultKeys (via performPasskeyLogin PRF path)
// ---------------------------------------------------------------------------
describe('completeLoginWithVaultKeys', () => {
  it('builds the session from the vault keys and a null fresh hash', async () => {
    api.getAccountPasskeyAssertionOptions.mockResolvedValue({ options: {}, token: 't' });
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: new Uint8Array([9]) });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(
      makeToken({
        access_token: makeJwt({ sub: 's', email: 'pk@x.com' }),
        web_session: true,
        UserDecryptionOptions: { WebAuthnPrfOption: { kind: 'prf' } },
      } as Partial<TokenSuccess>)
    );
    passkeys.unlockVaultKeyWithAccountPasskeyPrf.mockResolvedValue({ symEncKey: 've', symMacKey: 'vm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.login.session.symEncKey).toBe('ve');
    expect(result.login.session.symMacKey).toBe('vm');
    expect(result.login.session.email).toBe('pk@x.com');
    expect(result.login.session.authMode).toBe('web-cookie');
    expect(result.login.freshMasterPasswordHash).toBeNull();
    expect(offline.saveOfflineUnlockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'pk@x.com' })
    );
  });
});

// ---------------------------------------------------------------------------
// twoFactorProviderTypeFromValue / readTwoFactorProviderTypes
// (via performPasswordLogin 2FA-required)
// ---------------------------------------------------------------------------
describe('two-factor provider parsing', () => {
  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'derived-hash',
      masterKey: new Uint8Array([1]),
      kdfIterations: 600000,
    });
  });

  async function totp(body: Record<string, unknown>) {
    api.loginWithPassword.mockResolvedValue(twoFactorResponse(body));
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    if (result.kind !== 'totp') throw new Error(`expected totp, got ${result.kind}`);
    return result.pendingTotp;
  }

  it('parses an object descriptor via its Type field (webauthn=7)', async () => {
    const p = await totp({ TwoFactorProviders: [{ Type: 7 }] });
    expect(p.providerType).toBe(7);
    expect(p.availableProviders).toEqual([7]);
  });

  it('parses a whitespace-wrapped webauthn name (kills the missing trim)', async () => {
    const p = await totp({ TwoFactorProviders: [' webauthn '] });
    expect(p.providerType).toBe(7);
    expect(p.availableProviders).toEqual([7]);
  });

  it('parses the yubikey name to provider 3', async () => {
    const p = await totp({ TwoFactorProviders: ['yubikey'] });
    expect(p.providerType).toBe(3);
    expect(p.availableProviders).toEqual([3]);
  });

  it('parses the yubikeyotp alias to provider 3', async () => {
    const p = await totp({ TwoFactorProviders: ['yubikeyotp'] });
    expect(p.availableProviders).toEqual([3]);
  });

  it('parses the authenticator name alongside webauthn', async () => {
    const p = await totp({ TwoFactorProviders: ['webauthn', 'authenticator'] });
    expect(p.availableProviders).toEqual([7, 0]);
  });

  it('parses the totp alias alongside webauthn', async () => {
    const p = await totp({ TwoFactorProviders: ['webauthn', 'totp'] });
    expect(p.availableProviders).toEqual([7, 0]);
  });

  it('skips object-map entries whose value is exactly false', async () => {
    const p = await totp({ TwoFactorProviders: { '3': false, '0': true } });
    expect(p.availableProviders).toEqual([0]);
    expect(p.providerType).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// readTwoFactorProviderData + readTwoFactorProviderDataMap
// Constructed so the WebAuthn fallback branch actually supplies providerData.
// ---------------------------------------------------------------------------
describe('two-factor provider data lookup', () => {
  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'derived-hash',
      masterKey: new Uint8Array([1]),
      kdfIterations: 600000,
    });
  });

  it('falls through the by-type map (null) to the WebAuthn data via readTwoFactorProviderData', async () => {
    // Map builds {7: null} because the '0007' key parses to 7 last and stores
    // null; the direct providerData lookup then reaches record.WebAuthn.
    api.loginWithPassword.mockResolvedValue(
      twoFactorResponse({
        TwoFactorProviders: ['webauthn'],
        TwoFactorProviders2: { WebAuthn: { challenge: 'cw' }, '0007': null },
      })
    );
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    expect(result.kind).toBe('totp');
    if (result.kind !== 'totp') return;
    expect(result.pendingTotp.providerType).toBe(7);
    expect(result.pendingTotp.providerDataByType).toEqual({ 7: null });
    expect(result.pendingTotp.providerData).toEqual({ challenge: 'cw' });
  });
});

// ---------------------------------------------------------------------------
// performPasswordLogin remaining branches
// ---------------------------------------------------------------------------
describe('performPasswordLogin branches', () => {
  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'derived-hash',
      masterKey: new Uint8Array([1]),
      kdfIterations: 600000,
    });
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
  });

  it('normalizes the email and requests a remember token', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken());
    const mod = await loadModule();
    await mod.performPasswordLogin('  PL@X.com ', 'pw', 600000);
    expect(api.deriveLoginHashLocally).toHaveBeenCalledWith('pl@x.com', 'pw', 600000);
    expect(api.loginWithPassword).toHaveBeenCalledWith(
      'pl@x.com',
      'derived-hash',
      expect.objectContaining({ useRememberToken: true })
    );
  });

  it('treats an empty access_token (no providers) as an error, not a success', async () => {
    api.loginWithPassword.mockResolvedValue(
      twoFactorResponse({ access_token: '', error_description: 'weird' })
    );
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('weird');
    }
  });

  it('uses the login-failed fallback when the error body is empty', async () => {
    api.loginWithPassword.mockResolvedValue(twoFactorResponse({}));
    const mod = await loadModule();
    const result = await mod.performPasswordLogin('u@example.com', 'pw', 600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe(t('txt_login_failed'));
    }
  });
});

// ---------------------------------------------------------------------------
// performPasskeyLogin branches
// ---------------------------------------------------------------------------
describe('performPasskeyLogin branches', () => {
  beforeEach(() => {
    api.getAccountPasskeyAssertionOptions.mockResolvedValue({ options: {}, token: 't' });
  });

  it('errors (not proceeds) when access_token is present but empty', async () => {
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(
      twoFactorResponse({ access_token: '', error_description: 'boom-x' })
    );
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('boom-x');
    }
  });

  it('uses the login-failed fallback when the failed assertion has no error text', async () => {
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(twoFactorResponse({}));
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe(t('txt_login_failed'));
    }
  });

  it('normalizes the decoded email into the pending password prompt', async () => {
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(
      makeToken({ access_token: makeJwt({ email: '  CAP@X.com  ' }) } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('password');
    if (result.kind === 'password') {
      expect(result.pendingPasskeyPassword.email).toBe('cap@x.com');
    }
  });

  it('errors with login-failed when the token carries no email claim', async () => {
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(
      makeToken({ access_token: makeJwt({ sub: 'noemail' }) } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe(t('txt_login_failed'));
    }
  });

  it('accepts a matching expected email (trimmed/lowercased) and proceeds to password', async () => {
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(
      makeToken({ access_token: makeJwt({ email: 'u@example.com' }) } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000, '  U@Example.com ');
    expect(result.kind).toBe('password');
  });

  it('rejects a mismatched expected email with the specific message', async () => {
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(
      makeToken({ access_token: makeJwt({ email: 'u@example.com' }) } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000, 'other@x.com');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe(t('txt_passkey_not_for_locked_account'));
    }
  });

  it('does NOT PRF-unlock when the prf key is missing (kills && -> ||)', async () => {
    passkeys.assertAccountPasskey.mockResolvedValue({ prfKey: null });
    api.loginWithAccountPasskeyAssertion.mockResolvedValue(
      makeToken({ UserDecryptionOptions: { WebAuthnPrfOption: { kind: 'prf' } } } as Partial<TokenSuccess>)
    );
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('password');
    expect(passkeys.unlockVaultKeyWithAccountPasskeyPrf).not.toHaveBeenCalled();
  });

  it('uses login-failed when a non-Error value is thrown', async () => {
    api.getAccountPasskeyAssertionOptions.mockRejectedValue('plain-string');
    const mod = await loadModule();
    const result = await mod.performPasskeyLogin(600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe(t('txt_login_failed'));
    }
  });
});

// ---------------------------------------------------------------------------
// performTotpLogin branches
// ---------------------------------------------------------------------------
describe('performTotpLogin branches', () => {
  const pending = {
    email: 'u@example.com',
    passwordHash: 'h',
    masterKey: new Uint8Array([1]),
    kdfIterations: 600000,
    providerType: 0,
    availableProviders: [0],
    providerDataByType: {},
  };

  it('does not treat an empty access_token as success (throws the server error)', async () => {
    api.loginWithPassword.mockResolvedValue(
      twoFactorResponse({ access_token: '', error_description: 'srv-x' })
    );
    const mod = await loadModule();
    await expect(mod.performTotpLogin(pending, '000000', false)).rejects.toThrow('srv-x');
  });

  it('uses the TOTP failure message for a non-webauthn provider', async () => {
    api.loginWithPassword.mockResolvedValue(twoFactorResponse({ error_description: '' }));
    const mod = await loadModule();
    await expect(mod.performTotpLogin({ ...pending, providerType: 0 }, '000000', false)).rejects.toThrow(
      t('txt_totp_verify_failed')
    );
  });

  it('reads the server error from the error field when error_description is absent', async () => {
    api.loginWithPassword.mockResolvedValue(twoFactorResponse({ error: 'srv-err' }));
    const mod = await loadModule();
    await expect(mod.performTotpLogin({ ...pending, providerType: 0 }, '000000', false)).rejects.toThrow(
      'srv-err'
    );
  });
});

// ---------------------------------------------------------------------------
// performRecoverTwoFactorLogin branches
// ---------------------------------------------------------------------------
describe('performRecoverTwoFactorLogin branches', () => {
  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'h',
      masterKey: new Uint8Array([1]),
      kdfIterations: 600000,
    });
  });

  it('normalizes the email and does not request a remember token', async () => {
    api.recoverTwoFactor.mockResolvedValue({ newRecoveryCode: 'NEW' });
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.performRecoverTwoFactorLogin('  Rec@X.com ', 'pw', '  code ', 600000);
    expect(api.recoverTwoFactor).toHaveBeenCalledWith('rec@x.com', 'h', 'code');
    expect(api.loginWithPassword).toHaveBeenCalledWith(
      'rec@x.com',
      'h',
      expect.objectContaining({ useRememberToken: false })
    );
    expect(result.newRecoveryCode).toBe('NEW');
    expect(result.login).not.toBeNull();
  });

  it('returns a null login (not a throw) when the follow-up login yields empty access_token', async () => {
    api.recoverTwoFactor.mockResolvedValue({ newRecoveryCode: 'X' });
    api.loginWithPassword.mockResolvedValue(twoFactorResponse({ access_token: '' }));
    const mod = await loadModule();
    const result = await mod.performRecoverTwoFactorLogin('u@example.com', 'pw', 'code', 600000);
    expect(result.login).toBeNull();
    expect(result.newRecoveryCode).toBe('X');
  });
});

// ---------------------------------------------------------------------------
// performUnlock branches
// ---------------------------------------------------------------------------
describe('performUnlock branches', () => {
  const session = { email: 'sess@x.com', authMode: 'token' } as SessionState;

  beforeEach(() => {
    api.deriveLoginHashLocally.mockResolvedValue({
      hash: 'h',
      masterKey: new Uint8Array([4]),
      kdfIterations: 600000,
    });
  });

  it('derives the hash with the profile email (falling back to session email when profile is null)', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    await mod.performUnlock(session, null, 'pw', 600000);
    expect(api.deriveLoginHashLocally).toHaveBeenCalledWith('sess@x.com', 'pw', 600000);
  });

  it('prefers the profile email, trimmed and lowercased', async () => {
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    await mod.performUnlock(session, makeProfile({ email: '  PROF@X.com  ' }), 'pw', 600000);
    expect(api.deriveLoginHashLocally).toHaveBeenCalledWith('prof@x.com', 'pw', 600000);
  });

  it('online with an offline record uses the offline iterations and the network login path', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(1000);
    setNavigatorOnLine(true);
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile({ email: 'sess@x.com' }), 'pw', 600000);
    expect(result.kind).toBe('success');
    expect(api.deriveLoginHashLocally).toHaveBeenCalledWith('sess@x.com', 'pw', 1000);
    expect(api.loginWithPassword).toHaveBeenCalledWith(
      'sess@x.com',
      'h',
      expect.objectContaining({ useRememberToken: true })
    );
    expect(offline.unlockOfflineVaultWithMasterKey).not.toHaveBeenCalled();
  });

  it('uses the fallback iterations when there is no offline record', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(0);
    api.loginWithPassword.mockResolvedValue(makeToken());
    api.unlockVaultKey.mockResolvedValue({ symEncKey: 'e', symMacKey: 'm' });
    api.getProfile.mockResolvedValue(makeProfile());
    const mod = await loadModule();
    await mod.performUnlock(session, makeProfile({ email: 'sess@x.com' }), 'pw', 4242);
    expect(api.deriveLoginHashLocally).toHaveBeenCalledWith('sess@x.com', 'pw', 4242);
  });

  it('returns a fully-populated offline login object when unlocking offline', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(1000);
    setNavigatorOnLine(false);
    const offlineSession = { ...session, symEncKey: 'oe', symMacKey: 'om' } as SessionState;
    const offlineProfile = makeProfile({ name: 'Off' });
    offline.unlockOfflineVaultWithMasterKey.mockResolvedValue({
      session: offlineSession,
      profile: offlineProfile,
    });
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.login.session).toBe(offlineSession);
    expect(result.login.profile).toBe(offlineProfile);
    expect(result.login.freshMasterPasswordHash).toBeNull();
    expect(api.loginWithPassword).not.toHaveBeenCalled();
  });

  it('returns the incorrect-password message when offline unlock fails', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(1000);
    setNavigatorOnLine(false);
    offline.unlockOfflineVaultWithMasterKey.mockRejectedValue(new Error('bad'));
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe(t('txt_unlock_failed_master_password_is_incorrect'));
    }
  });

  it('returns the incorrect-password message when the network login throws with no offline record', async () => {
    offline.getOfflineUnlockKdfIterations.mockReturnValue(0);
    api.loginWithPassword.mockRejectedValue(new Error('network'));
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe(t('txt_unlock_failed_master_password_is_incorrect'));
    }
  });

  it('does NOT fall back to offline when there is no offline record (network throw)', async () => {
    // No offline record: even if offline unlock could succeed, it must not run.
    offline.getOfflineUnlockKdfIterations.mockReturnValue(0);
    api.loginWithPassword.mockRejectedValue(new Error('network'));
    offline.unlockOfflineVaultWithMasterKey.mockResolvedValue({
      session: { ...session, symEncKey: 'e', symMacKey: 'm' },
      profile: makeProfile(),
    });
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('error');
    expect(offline.unlockOfflineVaultWithMasterKey).not.toHaveBeenCalled();
  });

  it('treats an empty access_token (no providers) as a translated error', async () => {
    api.loginWithPassword.mockResolvedValue(
      twoFactorResponse({ access_token: '', error_description: 'Account is disabled' })
    );
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Account is disabled');
    }
  });

  it('uses the unlock-failed fallback when the error body is empty', async () => {
    api.loginWithPassword.mockResolvedValue(twoFactorResponse({}));
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe(t('txt_unlock_failed'));
    }
  });

  it('reaches WebAuthn providerData through the by-type null on the unlock 2FA path', async () => {
    api.loginWithPassword.mockResolvedValue(
      twoFactorResponse({
        TwoFactorProviders: ['webauthn'],
        TwoFactorProviders2: { WebAuthn: { challenge: 'cw' }, '0007': null },
      })
    );
    const mod = await loadModule();
    const result = await mod.performUnlock(session, makeProfile(), 'pw', 600000);
    expect(result.kind).toBe('totp');
    if (result.kind !== 'totp') return;
    expect(result.pendingTotp.providerType).toBe(7);
    expect(result.pendingTotp.providerData).toEqual({ challenge: 'cw' });
  });
});

// ---------------------------------------------------------------------------
// Bootstrap: normalizeBootstrapResponse / readWindowBootstrap
// ---------------------------------------------------------------------------
describe('bootstrap normalization', () => {
  it('defaults websiteIconsEnabled to true and keeps registrationInviteRequired undefined', async () => {
    const mod = await loadModule();
    const state = mod.readInitialAppBootstrapState();
    expect(state.websiteIconsEnabled).toBe(true);
    expect(state.registrationInviteRequired).toBeUndefined();
  });

  it('treats websiteIconsEnabled=false as disabled', async () => {
    setWindowBoot({ websiteIconsEnabled: false });
    const mod = await loadModule();
    expect(mod.readInitialAppBootstrapState().websiteIconsEnabled).toBe(false);
  });

  it('ignores a non-boolean registrationInviteRequired', async () => {
    setWindowBoot({ registrationInviteRequired: 'yes' });
    const mod = await loadModule();
    expect(mod.readInitialAppBootstrapState().registrationInviteRequired).toBeUndefined();
  });

  it('defaults the jwt warning minLength to 32 when unset', async () => {
    setWindowBoot({ jwtUnsafeReason: 'missing' });
    const mod = await loadModule();
    expect(mod.readInitialAppBootstrapState().jwtWarning).toEqual({ reason: 'missing', minLength: 32 });
  });

  it('reads an explicit jwt secret min length', async () => {
    setWindowBoot({ jwtUnsafeReason: 'too_short', jwtSecretMinLength: 16 });
    const mod = await loadModule();
    expect(mod.readInitialAppBootstrapState().jwtWarning).toEqual({ reason: 'too_short', minLength: 16 });
  });
});

// ---------------------------------------------------------------------------
// Bootstrap: fetchBootstrapConfig / bootstrapAppSession
// ---------------------------------------------------------------------------
describe('bootstrapAppSession fetch + merge', () => {
  function stubFetch(json: unknown, ok = true): void {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(json) }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const initial = {
    defaultKdfIterations: 600000,
    jwtWarning: null,
    session: null,
    phase: 'login' as const,
  };

  it('fetches the bootstrap config from the exact endpoint with a GET/JSON request', async () => {
    stubFetch({});
    const mod = await loadModule();
    await mod.bootstrapAppSession(initial);
    expect(fetch).toHaveBeenCalledWith(
      '/api/web-bootstrap',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } })
    );
  });

  it('ignores the response body when the fetch is not ok', async () => {
    stubFetch({ defaultKdfIterations: 111111 }, false);
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession(initial);
    expect(result.defaultKdfIterations).toBe(600000);
  });

  it('keeps the initial registrationInviteRequired when the remote omits it', async () => {
    stubFetch({});
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession({ ...initial, registrationInviteRequired: true });
    expect(result.registrationInviteRequired).toBe(true);
  });

  it('honours a remote websiteIconsEnabled=false', async () => {
    stubFetch({ websiteIconsEnabled: false });
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession(initial);
    expect(result.websiteIconsEnabled).toBe(false);
  });

  it('defaults websiteIconsEnabled to true for an empty remote config', async () => {
    stubFetch({});
    const mod = await loadModule();
    const result = await mod.bootstrapAppSession(initial);
    expect(result.websiteIconsEnabled).toBe(true);
  });
});
