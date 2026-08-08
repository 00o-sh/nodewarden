import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';
import { bytesToBase64, encryptBw, hkdfExpand, pbkdf2 } from '@/lib/crypto';
import type { Profile, SessionState } from '@/lib/types';
import {
  bootstrapYubiKeyOtpApiCredentials,
  clearProfileSnapshot,
  deleteAccountPasskey,
  deleteAllAuthorizedDevices,
  deleteAuthorizedDevice,
  deleteTwoFactorPasskey,
  deriveLoginHash,
  deriveLoginHashLocally,
  disableTwoFactorPasskeys,
  disableYubiKeyOtp,
  getApiKey,
  getAuthorizedDevices,
  getPasswordHint,
  getPreloginKdfConfig,
  getProfile,
  getTotpRecoveryCode,
  getTwoFactorPasskeyChallenge,
  getTwoFactorPasskeySettings,
  getTwoFactorProviderStatus,
  getVaultRevisionDate,
  getYubiKeyOtpSettings,
  listAccountPasskeys,
  loadProfileSnapshot,
  loadSession,
  loginWithPassword,
  recoverTwoFactor,
  refreshAccessToken,
  revokeAuthorizedDeviceTrust,
  revokeCurrentSession,
  rotateApiKey,
  saveProfileSnapshot,
  saveSession,
  saveTwoFactorPasskey,
  saveYubiKeyOtpApiCredentials,
  saveYubiKeyOtpSettings,
  setTotp,
  stripProfileSecrets,
  trustAuthorizedDevicePermanently,
  unlockVaultKey,
  updateAuthorizedDeviceName,
  updateProfile,
  verifyMasterPassword,
} from '@/lib/api/auth';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const emptyOk = () => Promise.resolve(new Response(null, { status: 200 }));

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('auth session persistence', () => {
  it('saveSession persists only email + authMode, and loadSession reads it back', () => {
    saveSession({ email: 'a@b.com', authMode: 'web-cookie', accessToken: 'secret' } as SessionState);
    const raw = JSON.parse(localStorage.getItem('nodewarden.web.session.v4')!);
    expect(raw).toEqual({ email: 'a@b.com', authMode: 'web-cookie' });
    expect(raw.accessToken).toBeUndefined();
    expect(loadSession()).toEqual({ email: 'a@b.com', authMode: 'web-cookie' });
  });

  it('saveSession(null) clears storage and loadSession returns null', () => {
    saveSession({ email: 'a@b.com', authMode: 'token' } as SessionState);
    saveSession(null);
    expect(localStorage.getItem('nodewarden.web.session.v4')).toBeNull();
    expect(loadSession()).toBeNull();
  });

  it('loadSession returns null for corrupt JSON', () => {
    localStorage.setItem('nodewarden.web.session.v4', '{not json');
    expect(loadSession()).toBeNull();
  });

  it('loadSession migrates a legacy token-bearing session, stripping the secret material', () => {
    localStorage.setItem(
      'nodewarden.web.session.v4',
      JSON.stringify({ email: 'a@b.com', authMode: 'token', accessToken: 'secret', refreshToken: 'r' })
    );
    expect(loadSession()).toEqual({ email: 'a@b.com', authMode: 'token' });
    // The migration rewrites storage without any token material.
    expect(JSON.parse(localStorage.getItem('nodewarden.web.session.v4')!)).toEqual({
      email: 'a@b.com',
      authMode: 'token',
    });
  });

  it('loadSession migrates a legacy web-cookie session and normalizes the authMode', () => {
    localStorage.setItem(
      'nodewarden.web.session.v4',
      JSON.stringify({ email: 'a@b.com', authMode: 'web-cookie', accessToken: 'secret' })
    );
    expect(loadSession()).toEqual({ email: 'a@b.com', authMode: 'web-cookie' });
  });

  it('loadSession returns null when the persisted shape matches no known branch', () => {
    // email present but no authMode and no tokens => falls through to the final null.
    localStorage.setItem('nodewarden.web.session.v4', JSON.stringify({ email: 'a@b.com' }));
    expect(loadSession()).toBeNull();
  });
});

describe('auth profile snapshot', () => {
  const profile: Profile = {
    id: 'p1',
    email: 'a@b.com',
    name: 'Alice',
    role: 'admin',
    key: 'super-secret-key',
    privateKey: 'priv',
    masterPasswordHint: 'hint',
    publicKey: 'pub',
  } as Profile;

  it('stripProfileSecrets removes key/privateKey and normalizes role', () => {
    const stripped = stripProfileSecrets({ ...profile, role: 'weird' as any });
    expect(stripped).toMatchObject({ key: '', privateKey: null, role: 'user' });
  });

  it('saveProfileSnapshot then loadProfileSnapshot round-trips without secrets', () => {
    saveProfileSnapshot(profile);
    const loaded = loadProfileSnapshot('a@b.com');
    expect(loaded?.key).toBe('');
    expect(loaded?.privateKey).toBeNull();
    expect(loaded?.role).toBe('admin');
  });

  it('loadProfileSnapshot returns null when the email does not match', () => {
    saveProfileSnapshot(profile);
    expect(loadProfileSnapshot('other@b.com')).toBeNull();
  });

  it('clearProfileSnapshot wipes the stored snapshot', () => {
    saveProfileSnapshot(profile);
    clearProfileSnapshot();
    expect(loadProfileSnapshot()).toBeNull();
  });
});

describe('auth key derivation', () => {
  it('deriveLoginHashLocally derives a deterministic base64 hash', async () => {
    const a = await deriveLoginHashLocally('User@Example.com', 'pw', 5000);
    const b = await deriveLoginHashLocally('user@example.com', 'pw', 5000);
    expect(a.hash).toBe(b.hash); // email is lower-cased before derivation
    expect(a.kdfIterations).toBe(5000);
    expect(typeof a.hash).toBe('string');
  });

  it('deriveLoginHash calls prelogin and honors the server iteration count', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ kdfIterations: 7000 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await deriveLoginHash('User@Example.com', 'pw', 600000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/identity/accounts/prelogin');
    expect(JSON.parse(init.body)).toEqual({ email: 'user@example.com' });
    expect(result.kdfIterations).toBe(7000);
    const local = await deriveLoginHashLocally('user@example.com', 'pw', 7000);
    expect(result.hash).toBe(local.hash);
  });

  it('deriveLoginHash throws when prelogin fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))));
    await expect(deriveLoginHash('a@b.com', 'pw', 600000)).rejects.toThrow('prelogin failed');
  });

  it('getPreloginKdfConfig requires an email and parses the kdf config', async () => {
    await expect(getPreloginKdfConfig('  ', 600000)).rejects.toThrow('Email is required');
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ kdf: 1, kdfIterations: 3, kdfMemory: 64, kdfParallelism: null })));
    expect(await getPreloginKdfConfig('a@b.com', 600000)).toEqual({
      kdfType: 1,
      kdfIterations: 3,
      kdfMemory: 64,
      kdfParallelism: null,
    });
  });

  it('unlockVaultKey rejects a short key and unwraps a valid one', async () => {
    const masterKey = await pbkdf2('pw', 'a@b.com', 1000, 32);
    const enc = await hkdfExpand(masterKey, 'enc', 32);
    const mac = await hkdfExpand(masterKey, 'mac', 32);
    const short = await encryptBw(new Uint8Array(32), enc, mac);
    await expect(unlockVaultKey(short, masterKey)).rejects.toThrow('Invalid profile key');

    const full = await encryptBw(new Uint8Array(64).fill(1), enc, mac);
    const unlocked = await unlockVaultKey(full, masterKey);
    expect(unlocked.symEncKey).toBe(bytesToBase64(new Uint8Array(32).fill(1)));
    expect(unlocked.symMacKey).toBe(bytesToBase64(new Uint8Array(32).fill(1)));
  });
});

describe('auth loginWithPassword', () => {
  it('sends a password grant with device metadata and saves the remember token', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ access_token: 'at', TwoFactorToken: 'remember-me' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await loginWithPassword('User@Example.com', 'HASH');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/identity/connect/token');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(init.body);
    expect(params.get('grant_type')).toBe('password');
    expect(params.get('username')).toBe('user@example.com');
    expect(params.get('password')).toBe('HASH');
    expect(params.get('scope')).toBe('api offline_access');
    expect(params.get('deviceType')).toBe('14');
    expect((result as any).access_token).toBe('at');
    // Remember token persisted for future TOTP-remembered logins.
    expect(localStorage.getItem('nodewarden.web.totp.remember-token.v1')).toBe('remember-me');
  });

  it('includes the TOTP code and remember flag when supplied', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ access_token: 'at' }));
    vi.stubGlobal('fetch', fetchMock);
    await loginWithPassword('a@b.com', 'HASH', { totpCode: '123456', twoFactorProvider: 0, rememberDevice: true });
    const params = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(params.get('twoFactorProvider')).toBe('0');
    expect(params.get('twoFactorToken')).toBe('123456');
    expect(params.get('twoFactorRemember')).toBe('1');
  });

  it('returns the error json on a failed login', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'invalid_grant' }, 400)));
    const result = await loginWithPassword('a@b.com', 'HASH');
    expect((result as any).error).toBe('invalid_grant');
  });

  it('sends the stored remember token as provider 5 when useRememberToken is set', async () => {
    localStorage.setItem('nodewarden.web.totp.remember-token.v1', 'REMEMBER');
    const fetchMock = vi.fn(() => jsonResponse({ access_token: 'at' }));
    vi.stubGlobal('fetch', fetchMock);
    await loginWithPassword('a@b.com', 'HASH', { useRememberToken: true });
    const params = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(params.get('twoFactorProvider')).toBe('5');
    expect(params.get('twoFactorToken')).toBe('REMEMBER');
  });

  // When a remembered-device login is rejected *with* a fresh two-factor
  // challenge, the stale remember token is cleared. Exercise every shape the
  // hasTwoFactorChallenge helper understands.
  const challengeShapes: Array<[string, Record<string, unknown>]> = [
    ['TwoFactorProviders array', { TwoFactorProviders: [1] }],
    ['TwoFactorProviders object', { TwoFactorProviders: { '1': null } }],
    ['TwoFactorProviders2 array', { TwoFactorProviders2: [{ '1': {} }] }],
    ['TwoFactorProviders2 object', { TwoFactorProviders2: { '1': {} } }],
  ];
  for (const [label, body] of challengeShapes) {
    it(`clears the remember token when a remembered login is met with a ${label} challenge`, async () => {
      localStorage.setItem('nodewarden.web.totp.remember-token.v1', 'REMEMBER');
      vi.stubGlobal('fetch', vi.fn(() => jsonResponse(body, 400)));
      const result = await loginWithPassword('a@b.com', 'HASH', { useRememberToken: true });
      expect(result).toMatchObject(body);
      expect(localStorage.getItem('nodewarden.web.totp.remember-token.v1')).toBeNull();
    });
  }

  it('keeps the remember token when a remembered login fails without a two-factor challenge', async () => {
    localStorage.setItem('nodewarden.web.totp.remember-token.v1', 'REMEMBER');
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'invalid_grant' }, 400)));
    await loginWithPassword('a@b.com', 'HASH', { useRememberToken: true });
    // No challenge => nothing to invalidate; the token is preserved.
    expect(localStorage.getItem('nodewarden.web.totp.remember-token.v1')).toBe('REMEMBER');
  });
});

describe('auth revokeCurrentSession', () => {
  it('posts the refresh token and an Authorization header in token mode', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await revokeCurrentSession({
      email: 'a@b.com',
      authMode: 'token',
      accessToken: 'AT',
      refreshToken: 'RT',
    } as SessionState);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/identity/connect/revocation');
    expect(init.headers.Authorization).toBe('Bearer AT');
    expect(new URLSearchParams(init.body).get('token')).toBe('RT');
  });

  it('swallows network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(revokeCurrentSession({ email: 'a', authMode: 'web-cookie' } as SessionState)).resolves.toBeUndefined();
  });
});

describe('auth refreshAccessToken', () => {
  it('posts the refresh token in token mode', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ access_token: 'new-at' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await refreshAccessToken({ email: 'a@b.com', authMode: 'token', refreshToken: 'rt' } as SessionState);
    const params = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('rt');
    expect(result).toEqual({ ok: true, token: { access_token: 'new-at' } });
  });

  it('sends the web-session header and no refresh token in cookie mode', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ access_token: 'new-at' }));
    vi.stubGlobal('fetch', fetchMock);
    await refreshAccessToken({ email: 'a@b.com', authMode: 'web-cookie' } as SessionState);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-NodeWarden-Web-Session']).toBe('1');
    expect(new URLSearchParams(init.body).get('refresh_token')).toBeNull();
  });

  it('reports a transient failure for a 500 and a hard failure for a 400', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'x' }, 500)));
    const transient = await refreshAccessToken({ email: 'a', authMode: 'token', refreshToken: 'r' } as SessionState);
    expect(transient).toMatchObject({ ok: false, transient: true });

    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'invalid_grant' }, 400)));
    const hard = await refreshAccessToken({ email: 'a', authMode: 'token', refreshToken: 'r' } as SessionState);
    expect(hard).toMatchObject({ ok: false, transient: false });
  });

  it('treats a thrown network error as transient', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const result = await refreshAccessToken({ email: 'a', authMode: 'token', refreshToken: 'r' } as SessionState);
    expect(result).toEqual({ ok: false, transient: true, error: 'offline' });
  });
});

describe('auth getProfile / updateProfile', () => {
  it('getProfile returns the parsed profile', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'p1', email: 'a@b.com' }));
    expect(await getProfile(authedFetch as any)).toMatchObject({ id: 'p1' });
    expect(authedFetch).toHaveBeenCalledWith('/api/accounts/profile');
  });

  it('getProfile throws on failure', async () => {
    await expect(getProfile(vi.fn(() => jsonResponse(null, 500)) as any)).rejects.toThrow('Failed to load profile');
  });

  it('updateProfile PUTs a trimmed hint (null when blank)', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'p1' }));
    await updateProfile(authedFetch as any, { masterPasswordHint: '   ' });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/accounts/profile');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHint: null });
  });
});

describe('auth two-factor request shaping', () => {
  it('setTotp PUTs the payload verbatim', async () => {
    const authedFetch = vi.fn(emptyOk);
    await setTotp(authedFetch as any, { enabled: true, token: '123', secret: 'S' });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/accounts/totp');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ enabled: true, token: '123', secret: 'S' });
  });

  it('setTotp surfaces the translated server error', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'bad totp' }, 400));
    await expect(setTotp(authedFetch as any, { enabled: true })).rejects.toThrow('bad totp');
  });

  it('getYubiKeyOtpSettings normalizes PascalCase server fields', async () => {
    const authedFetch = vi.fn(() =>
      jsonResponse({ Enabled: true, Key1: 'k1', Nfc: true, YubicoConfigured: true, YubicoClientId: 'cid' })
    );
    const settings = await getYubiKeyOtpSettings(authedFetch as any, 'HASH');
    expect(JSON.parse(authedFetch.mock.calls[0][1].body)).toEqual({ masterPasswordHash: 'HASH' });
    expect(settings).toMatchObject({
      enabled: true,
      nfc: true,
      yubicoConfigured: true,
      yubicoClientId: 'cid',
    });
    expect(settings.keys[0]).toBe('k1');
    expect(settings.keys).toHaveLength(5);
  });

  it('saveYubiKeyOtpSettings maps the keys array into key1..key5', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ enabled: true }));
    await saveYubiKeyOtpSettings(authedFetch as any, { keys: ['a', 'b'], nfc: false, masterPasswordHash: 'H' });
    const body = JSON.parse(authedFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ key1: 'a', key2: 'b', key3: '', key4: '', key5: '', nfc: false, masterPasswordHash: 'H' });
  });

  it('disableYubiKeyOtp PUTs a type-3 disable request', async () => {
    const authedFetch = vi.fn(emptyOk);
    await disableYubiKeyOtp(authedFetch as any, 'H');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/two-factor/disable');
    expect(JSON.parse(init.body)).toEqual({ type: 3, masterPasswordHash: 'H' });
  });

  it('disableTwoFactorPasskeys PUTs a type-7 disable request', async () => {
    const authedFetch = vi.fn(emptyOk);
    await disableTwoFactorPasskeys(authedFetch as any, 'H');
    expect(JSON.parse(authedFetch.mock.calls[0][1].body)).toEqual({ type: 7, masterPasswordHash: 'H' });
  });

  it('getTwoFactorPasskeySettings filters out invalid key ids', async () => {
    const authedFetch = vi.fn(() =>
      jsonResponse({ enabled: true, keys: [{ id: 1, name: 'yk', migrated: true }, { id: 0, name: 'bad' }] })
    );
    const settings = await getTwoFactorPasskeySettings(authedFetch as any, 'H');
    expect(settings.enabled).toBe(true);
    expect(settings.keys).toEqual([{ id: 1, name: 'yk', migrated: true }]);
  });

  it('verifyMasterPassword POSTs the hash and rejects on error', async () => {
    const authedFetch = vi.fn(emptyOk);
    await verifyMasterPassword(authedFetch as any, 'H');
    expect(authedFetch.mock.calls[0][0]).toBe('/api/accounts/verify-password');
    const bad = vi.fn(() => jsonResponse({ error_description: 'wrong' }, 400));
    await expect(verifyMasterPassword(bad as any, 'H')).rejects.toThrow('wrong');
  });

  it('getTwoFactorProviderStatus maps enabled provider types', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ data: [{ type: 0 }, { type: 7 }] }));
    expect(await getTwoFactorProviderStatus(authedFetch as any)).toEqual({
      totpEnabled: true,
      yubikeyEnabled: false,
      passkeyEnabled: true,
    });
  });

  it('getTotpRecoveryCode returns the code string', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ code: 'RECOVERY' }));
    expect(await getTotpRecoveryCode(authedFetch as any, 'H')).toBe('RECOVERY');
  });
});

describe('auth account passkeys', () => {
  it('listAccountPasskeys normalizes rows and drops entries without an id', async () => {
    const authedFetch = vi.fn(() =>
      jsonResponse({ data: [{ id: 'k1', name: 'Key', PrfStatus: 1 }, { name: 'no-id' }] })
    );
    const rows = await listAccountPasskeys(authedFetch as any);
    expect(authedFetch).toHaveBeenCalledWith('/api/webauthn');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'k1', name: 'Key', prfStatus: 1 });
  });

  it('deleteAccountPasskey POSTs to the encoded delete endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await deleteAccountPasskey(authedFetch as any, 'k 1', 'H');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/webauthn/k%201/delete');
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'H' });
  });
});

describe('auth two-factor error + passkey management', () => {
  it('getYubiKeyOtpSettings surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'wrong password' }, 400));
    await expect(getYubiKeyOtpSettings(authedFetch as any, 'H')).rejects.toThrow('wrong password');
  });

  it('saveYubiKeyOtpSettings surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'save failed' }, 400));
    await expect(
      saveYubiKeyOtpSettings(authedFetch as any, { keys: ['a'], nfc: true, masterPasswordHash: 'H' })
    ).rejects.toThrow('save failed');
  });

  it('saveYubiKeyOtpApiCredentials PUTs the config payload and returns normalized settings', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ Enabled: true, YubicoClientId: 'cid' }));
    const settings = await saveYubiKeyOtpApiCredentials(authedFetch as any, {
      masterPasswordHash: 'H',
      yubicoClientId: 'cid',
      yubicoSecretKey: 'secret',
    });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/two-factor/yubikey/config');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      masterPasswordHash: 'H',
      yubicoClientId: 'cid',
      yubicoSecretKey: 'secret',
    });
    expect(settings).toMatchObject({ enabled: true, yubicoClientId: 'cid' });
  });

  it('saveYubiKeyOtpApiCredentials surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'bad config' }, 400));
    await expect(
      saveYubiKeyOtpApiCredentials(authedFetch as any, {
        masterPasswordHash: 'H',
        yubicoClientId: 'c',
        yubicoSecretKey: 's',
      })
    ).rejects.toThrow('bad config');
  });

  it('bootstrapYubiKeyOtpApiCredentials POSTs the otp payload and returns normalized settings', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ enabled: false }));
    const settings = await bootstrapYubiKeyOtpApiCredentials(authedFetch as any, {
      masterPasswordHash: 'H',
      otp: 'ccccc',
    });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/two-factor/yubikey/bootstrap');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'H', otp: 'ccccc' });
    expect(settings.enabled).toBe(false);
  });

  it('bootstrapYubiKeyOtpApiCredentials surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'auto config failed' }, 400));
    await expect(
      bootstrapYubiKeyOtpApiCredentials(authedFetch as any, { masterPasswordHash: 'H', otp: 'x' })
    ).rejects.toThrow('auto config failed');
  });

  it('disableYubiKeyOtp surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'cannot disable' }, 400));
    await expect(disableYubiKeyOtp(authedFetch as any, 'H')).rejects.toThrow('cannot disable');
  });

  it('getTwoFactorPasskeySettings normalizes PascalCase server fields', async () => {
    const authedFetch = vi.fn(() =>
      jsonResponse({ Enabled: true, Keys: [{ Id: 2, Name: 'YubiBio', Migrated: false }] })
    );
    const settings = await getTwoFactorPasskeySettings(authedFetch as any, 'H');
    expect(settings.enabled).toBe(true);
    expect(settings.keys).toEqual([{ id: 2, name: 'YubiBio', migrated: false }]);
  });

  it('getTwoFactorPasskeySettings surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'verify failed' }, 400));
    await expect(getTwoFactorPasskeySettings(authedFetch as any, 'H')).rejects.toThrow('verify failed');
  });

  it('getTwoFactorPasskeyChallenge POSTs the hash and returns the parsed challenge', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ challenge: 'CH', token: 'T' }));
    const result = await getTwoFactorPasskeyChallenge(authedFetch as any, 'H');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/two-factor/get-webauthn-challenge');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'H' });
    expect(result).toEqual({ challenge: 'CH', token: 'T' });
  });

  it('getTwoFactorPasskeyChallenge surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'setup failed' }, 400));
    await expect(getTwoFactorPasskeyChallenge(authedFetch as any, 'H')).rejects.toThrow('setup failed');
  });

  it('saveTwoFactorPasskey PUTs the payload verbatim and returns normalized settings', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ enabled: true, keys: [{ id: 3, name: 'K', migrated: true }] }));
    const payload = { name: 'K', masterPasswordHash: 'H', deviceResponse: { r: 1 } };
    const settings = await saveTwoFactorPasskey(authedFetch as any, payload);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/two-factor/webauthn');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(payload);
    expect(settings.keys).toEqual([{ id: 3, name: 'K', migrated: true }]);
  });

  it('saveTwoFactorPasskey surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'setup failed' }, 400));
    await expect(
      saveTwoFactorPasskey(authedFetch as any, { name: 'K', masterPasswordHash: 'H', deviceResponse: {} })
    ).rejects.toThrow('setup failed');
  });

  it('deleteTwoFactorPasskey DELETEs the payload and returns normalized settings', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ enabled: false, keys: [] }));
    const settings = await deleteTwoFactorPasskey(authedFetch as any, { id: 4, masterPasswordHash: 'H' });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/two-factor/webauthn');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ id: 4, masterPasswordHash: 'H' });
    expect(settings).toEqual({ enabled: false, keys: [] });
  });

  it('deleteTwoFactorPasskey surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'delete failed' }, 400));
    await expect(
      deleteTwoFactorPasskey(authedFetch as any, { id: 4, masterPasswordHash: 'H' })
    ).rejects.toThrow('delete failed');
  });

  it('disableTwoFactorPasskeys surfaces the translated error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'cannot disable passkeys' }, 400));
    await expect(disableTwoFactorPasskeys(authedFetch as any, 'H')).rejects.toThrow('cannot disable passkeys');
  });

  it('getTwoFactorProviderStatus throws when the request fails', async () => {
    const authedFetch = vi.fn(() => jsonResponse(null, 500));
    await expect(getTwoFactorProviderStatus(authedFetch as any)).rejects.toThrow(
      'Failed to load two-factor status'
    );
  });

  it('getTwoFactorProviderStatus maps PascalCase Data/Type fields', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ Data: [{ Type: 3 }] }));
    expect(await getTwoFactorProviderStatus(authedFetch as any)).toEqual({
      totpEnabled: false,
      yubikeyEnabled: true,
      passkeyEnabled: false,
    });
  });
});

describe('auth revision date', () => {
  it('returns a positive numeric stamp', async () => {
    const authedFetch = vi.fn(() => jsonResponse(1710000000000));
    expect(await getVaultRevisionDate(authedFetch as any)).toBe(1710000000000);
  });

  it('throws for a non-positive stamp', async () => {
    const authedFetch = vi.fn(() => jsonResponse(0));
    await expect(getVaultRevisionDate(authedFetch as any)).rejects.toThrow('Invalid revision date');
  });

  it('throws when the request fails', async () => {
    await expect(getVaultRevisionDate(vi.fn(() => jsonResponse(null, 500)) as any)).rejects.toThrow(
      'Failed to load revision date'
    );
  });
});

describe('auth authorized devices', () => {
  it('getAuthorizedDevices returns the data list', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ object: 'list', data: [{ identifier: 'd1' }] }));
    expect(await getAuthorizedDevices(authedFetch as any)).toEqual([{ identifier: 'd1' }]);
    expect(authedFetch).toHaveBeenCalledWith('/api/devices/authorized');
  });

  it('revokeAuthorizedDeviceTrust DELETEs the encoded authorized endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await revokeAuthorizedDeviceTrust(authedFetch as any, 'd 1');
    expect(authedFetch).toHaveBeenCalledWith('/api/devices/authorized/d%201', { method: 'DELETE' });
  });

  it('trustAuthorizedDevicePermanently POSTs to the permanent endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await trustAuthorizedDevicePermanently(authedFetch as any, 'd1');
    expect(authedFetch).toHaveBeenCalledWith('/api/devices/authorized/d1/permanent', { method: 'POST' });
  });

  it('deleteAuthorizedDevice DELETEs the device endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await deleteAuthorizedDevice(authedFetch as any, 'd1');
    expect(authedFetch).toHaveBeenCalledWith('/api/devices/d1', { method: 'DELETE' });
  });

  it('updateAuthorizedDeviceName requires a non-blank name and PUTs the trimmed value', async () => {
    await expect(updateAuthorizedDeviceName(vi.fn() as any, 'd1', '   ')).rejects.toThrow(
      t('txt_device_note_required')
    );
    const authedFetch = vi.fn(emptyOk);
    await updateAuthorizedDeviceName(authedFetch as any, 'd1', '  My Laptop  ');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/devices/d1/name');
    expect(JSON.parse(init.body)).toEqual({ name: 'My Laptop' });
  });

  it('deleteAllAuthorizedDevices DELETEs the collection with the master-password hash', async () => {
    const authedFetch = vi.fn(emptyOk);
    await deleteAllAuthorizedDevices(authedFetch as any, 'mph');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/devices');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'mph' });
  });
});

describe('auth api keys', () => {
  it('getApiKey returns the apiKey field', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ apiKey: 'AK' }));
    expect(await getApiKey(authedFetch as any, 'H')).toBe('AK');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/accounts/api-key');
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'H' });
  });

  it('rotateApiKey posts to the rotate endpoint', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ apiKey: 'AK2' }));
    expect(await rotateApiKey(authedFetch as any, 'H')).toBe('AK2');
    expect(authedFetch.mock.calls[0][0]).toBe('/api/accounts/rotate-api-key');
  });

  it('getApiKey surfaces the translated error', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'nope' }, 400));
    await expect(getApiKey(authedFetch as any, 'H')).rejects.toThrow('nope');
  });
});

describe('auth global-fetch endpoints', () => {
  it('getPasswordHint posts a normalized email and returns the hint', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ masterPasswordHint: 'my hint' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getPasswordHint(' A@B.com ')).toEqual({ masterPasswordHint: 'my hint' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/accounts/password-hint');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.com' });
  });

  it('getPasswordHint throws the translated error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ error: 'user not found' }, 404)));
    await expect(getPasswordHint('a@b.com')).rejects.toThrow('user not found');
  });

  it('recoverTwoFactor posts the recovery payload and returns the new code', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ newRecoveryCode: 'NEW' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await recoverTwoFactor('A@B.com', 'HASH', 'CODE')).toEqual({ newRecoveryCode: 'NEW' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/identity/accounts/recover-2fa');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.com', masterPasswordHash: 'HASH', recoveryCode: 'CODE' });
  });
});
