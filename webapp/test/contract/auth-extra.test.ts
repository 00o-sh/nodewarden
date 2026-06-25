import { beforeAll, describe, expect, it } from 'vitest';
import {
  changeMasterPassword,
  createAuthedFetch,
  deriveLoginHash,
  getApiKey,
  getAccountPasskeyAssertionOptions,
  getAccountPasskeyAttestationOptions,
  getAuthorizedDevices,
  getPasswordHint,
  getProfile,
  getTotpRecoveryCode,
  getTotpStatus,
  listAccountPasskeys,
  loginWithPassword,
  recoverTwoFactor,
  registerAccount,
  revokeAllAuthorizedDeviceTrust,
  revokeAuthorizedDeviceTrust,
  rotateApiKey,
  setTotp,
  trustAuthorizedDevicePermanently,
  unlockVaultKey,
  updateAuthorizedDeviceName,
  updateProfile,
  verifyMasterPassword,
  getVaultRevisionDate,
} from '@/lib/api/auth';
import { createInvite, listAdminInvites } from '@/lib/api/admin';
import type { SessionState, TokenSuccess } from '@/lib/types';
import { DEFAULT_ITERATIONS, type ContractSession, registerAndLogin } from './helpers';

// Extra auth-api contract coverage: every webapp `lib/api/auth.ts` function that
// the existing auth-flow.test.ts does not already exercise, driven against the
// REAL worker (workerd/Miniflare). For endpoints that need external state we
// cannot provide in this harness (a real authenticator, a real WebAuthn device),
// we assert the *reachable* success/guard path the worker actually serves.
//
// `ctx` is the FIRST account registered in this isolated worker, so it is admin
// and can mint invites. Tests that INVALIDATE their own session (rotateApiKey,
// changeMasterPassword — both rotate the security stamp + drop refresh tokens)
// run against dedicated invite-registered accounts so they never poison `ctx`.
let ctx: ContractSession;
let masterPasswordHash: string;

beforeAll(async () => {
  ctx = await registerAndLogin('auth-extra');
  const prelogin = await deriveLoginHash(ctx.email, ctx.password, DEFAULT_ITERATIONS);
  masterPasswordHash = prelogin.hash;
});

// Register a brand-new (non-admin) account through the real invite flow, minting
// the invite as the admin `ctx`. Returns an unlocked session like registerAndLogin.
async function registerExtraAccount(label: string): Promise<ContractSession> {
  await createInvite(ctx.authedFetch, 168);
  const invites = await listAdminInvites(ctx.authedFetch);
  const active = invites.filter((i) => i.status === 'active');
  const inviteCode = active[active.length - 1].code;

  const email = `contract-${label}-${crypto.randomUUID()}@vault.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const reg = await registerAccount({
    email,
    name: 'Contract Test',
    password,
    inviteCode,
    fallbackIterations: DEFAULT_ITERATIONS,
  });
  if (!reg.ok) throw new Error(`register failed: ${'message' in reg ? reg.message : 'unknown'}`);

  const prelogin = await deriveLoginHash(email, password, DEFAULT_ITERATIONS);
  const token = (await loginWithPassword(email, prelogin.hash)) as TokenSuccess;
  if (!token.access_token) throw new Error('login failed');
  const { symEncKey, symMacKey } = await unlockVaultKey(token.Key as string, prelogin.masterKey);
  let session: SessionState = {
    email,
    authMode: 'token',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    symEncKey,
    symMacKey,
  };
  const authedFetch = createAuthedFetch(
    () => session,
    (next) => {
      if (next) session = { ...next, symEncKey, symMacKey };
    }
  );
  return { email, password, session, authedFetch, masterKey: prelogin.masterKey };
}

describe('updateProfile contract', () => {
  it('persists the master password hint and reflects it on the next profile read', async () => {
    const hint = `hint-${crypto.randomUUID()}`;
    const updated = await updateProfile(ctx.authedFetch, { masterPasswordHint: hint });
    expect(updated.email).toBe(ctx.email);
    expect(updated.masterPasswordHint).toBe(hint);

    const reread = await getProfile(ctx.authedFetch);
    expect(reread.masterPasswordHint).toBe(hint);
  });

  it('clears the hint when given an empty string (worker stores null)', async () => {
    const cleared = await updateProfile(ctx.authedFetch, { masterPasswordHint: '   ' });
    expect(cleared.masterPasswordHint).toBeNull();
  });
});

describe('getVaultRevisionDate contract', () => {
  it('returns a positive epoch-millisecond timestamp', async () => {
    const stamp = await getVaultRevisionDate(ctx.authedFetch);
    expect(Number.isFinite(stamp)).toBe(true);
    expect(stamp).toBeGreaterThan(0);
    // Sanity: it's a plausible ms timestamp (after 2020), not seconds.
    expect(stamp).toBeGreaterThan(1_577_836_800_000);
  });
});

describe('verifyMasterPassword contract', () => {
  it('resolves for the correct master password hash', async () => {
    await expect(verifyMasterPassword(ctx.authedFetch, masterPasswordHash)).resolves.toBeUndefined();
  });

  it('rejects an incorrect master password hash', async () => {
    await expect(
      verifyMasterPassword(ctx.authedFetch, 'definitely-not-the-hash')
    ).rejects.toThrow();
  });
});

describe('getPasswordHint contract', () => {
  // The worker rate-limits /api/accounts/password-hint to 1 request/minute per
  // client IP, so this suite makes exactly ONE call to stay within budget.
  it('returns the stored hint for an active account', async () => {
    const hint = `hint-${crypto.randomUUID()}`;
    await updateProfile(ctx.authedFetch, { masterPasswordHint: hint });

    const result = await getPasswordHint(ctx.email);
    expect(result.masterPasswordHint).toBe(hint);
  });
});

describe('getApiKey / rotateApiKey contract', () => {
  // rotateApiKey rotates the security stamp + drops refresh tokens, invalidating
  // the session, so this runs against a dedicated account (never the shared ctx).
  it('returns an api key (creating one on first request) and rotates it to a new value', async () => {
    const account = await registerExtraAccount('auth-extra-apikey');
    const hash = (await deriveLoginHash(account.email, account.password, DEFAULT_ITERATIONS)).hash;

    const first = await getApiKey(account.authedFetch, hash);
    expect(first).toBeTruthy();
    // Reading again returns the same key (no rotation).
    const second = await getApiKey(account.authedFetch, hash);
    expect(second).toBe(first);

    const rotated = await rotateApiKey(account.authedFetch, hash);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(first);
    // NOTE: rotateApiKey rotates the security stamp and deletes refresh tokens,
    // so this session's access token is now invalid and cannot be refreshed.
    // Re-reading the key would require a fresh login, which is out of scope here.
  });

  it('rejects getApiKey with a wrong master password hash', async () => {
    await expect(getApiKey(ctx.authedFetch, 'definitely-not-the-hash')).rejects.toThrow();
  });
});

describe('TOTP status / enable-guard / recovery-code contract', () => {
  it('reports TOTP disabled for a fresh account', async () => {
    const status = await getTotpStatus(ctx.authedFetch);
    expect(status.enabled).toBe(false);
  });

  it('rejects enabling TOTP with an invalid secret (reachable enable guard)', async () => {
    // We cannot mint a real authenticator code in this harness, so we exercise
    // the worker's secret/token validation guard rather than a full enable.
    await expect(
      setTotp(ctx.authedFetch, {
        enabled: true,
        secret: 'not-a-valid-base32-secret!!',
        token: '000000',
        masterPasswordHash,
      })
    ).rejects.toThrow();

    // Guard rejection must not have flipped the stored status.
    const status = await getTotpStatus(ctx.authedFetch);
    expect(status.enabled).toBe(false);
  });

  it('returns a recovery code for the correct master password hash, and rejects a wrong one', async () => {
    const code = await getTotpRecoveryCode(ctx.authedFetch, masterPasswordHash);
    expect(code).toBeTruthy();
    expect(typeof code).toBe('string');

    await expect(
      getTotpRecoveryCode(ctx.authedFetch, 'definitely-not-the-hash')
    ).rejects.toThrow();
  });
});

describe('recoverTwoFactor contract', () => {
  it('rejects an invalid recovery code (reachable guard, no 2FA enabled)', async () => {
    await expect(
      recoverTwoFactor(ctx.email, masterPasswordHash, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    ).rejects.toThrow();
  });

  it('rejects a wrong master password hash', async () => {
    await expect(
      recoverTwoFactor(ctx.email, 'definitely-not-the-hash', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    ).rejects.toThrow();
  });
});

describe('authorized devices contract', () => {
  it('lists the device created by login and renames it', async () => {
    const devices = await getAuthorizedDevices(ctx.authedFetch);
    expect(Array.isArray(devices)).toBe(true);
    expect(devices.length).toBeGreaterThanOrEqual(1);

    const device = devices[0];
    const deviceIdentifier = String((device as { id?: string; Id?: string }).id || (device as { Id?: string }).Id || '');
    expect(deviceIdentifier).toBeTruthy();

    const newName = `Renamed ${crypto.randomUUID()}`;
    await expect(
      updateAuthorizedDeviceName(ctx.authedFetch, deviceIdentifier, newName)
    ).resolves.toBeUndefined();

    // The rename is reflected on a subsequent authorized-device listing.
    const after = await getAuthorizedDevices(ctx.authedFetch);
    const renamed = after.find(
      (d) => String((d as { id?: string; Id?: string }).id || (d as { Id?: string }).Id || '') === deviceIdentifier
    );
    expect((renamed as { name?: string; Name?: string }).name || (renamed as { Name?: string }).Name).toBe(newName);
  });

  it('revoking trust for an untrusted device is a no-op success (removed: 0)', async () => {
    const devices = await getAuthorizedDevices(ctx.authedFetch);
    const deviceIdentifier = String((devices[0] as { id?: string; Id?: string }).id || (devices[0] as { Id?: string }).Id || '');
    // No 2FA remember-token exists, so this removes nothing but still succeeds.
    await expect(
      revokeAuthorizedDeviceTrust(ctx.authedFetch, deviceIdentifier)
    ).resolves.toBeUndefined();
  });

  it('permanently trusting a device with no active trust token rejects (409 guard)', async () => {
    const devices = await getAuthorizedDevices(ctx.authedFetch);
    const deviceIdentifier = String((devices[0] as { id?: string; Id?: string }).id || (devices[0] as { Id?: string }).Id || '');
    // updateTrustedTwoFactorTokensExpiryByDevice returns 0 rows -> worker 409s.
    await expect(
      trustAuthorizedDevicePermanently(ctx.authedFetch, deviceIdentifier)
    ).rejects.toThrow();
  });

  it('revokes all device trust (idempotent success)', async () => {
    await expect(revokeAllAuthorizedDeviceTrust(ctx.authedFetch)).resolves.toBeUndefined();
  });
});

describe('account passkeys contract', () => {
  it('lists account passkeys (empty for a fresh account)', async () => {
    const passkeys = await listAccountPasskeys(ctx.authedFetch);
    expect(Array.isArray(passkeys)).toBe(true);
    expect(passkeys.length).toBe(0);
  });

  it('returns attestation (registration) options for the correct master password hash', async () => {
    const result = await getAccountPasskeyAttestationOptions(ctx.authedFetch, masterPasswordHash);
    expect(result.token).toBeTruthy();
    expect(result.options).toBeTruthy();
    // Registration options carry a server-generated challenge.
    expect((result.options as { challenge?: string }).challenge).toBeTruthy();
  });

  it('rejects attestation options with a wrong master password hash', async () => {
    await expect(
      getAccountPasskeyAttestationOptions(ctx.authedFetch, 'definitely-not-the-hash')
    ).rejects.toThrow();
  });

  it('returns account-login assertion options (unauthenticated) with a challenge token', async () => {
    const result = await getAccountPasskeyAssertionOptions();
    expect(result.token).toBeTruthy();
    expect(result.options).toBeTruthy();
    expect((result.options as { challenge?: string }).challenge).toBeTruthy();
  });
});

describe('changeMasterPassword contract', () => {
  // Runs LAST among the auth-extra suites that depend on the original password,
  // because it rotates the user's key material and invalidates refresh tokens.
  it('rotates the master password and lets the user log in with the new one', async () => {
    // A dedicated account so we never disturb the shared `ctx` used above.
    const account = await registerExtraAccount('auth-extra-change-pw');
    const profile = await getProfile(account.authedFetch);

    const newPassword = `pw-new-${crypto.randomUUID()}`;
    await expect(
      changeMasterPassword(account.authedFetch, {
        email: account.email,
        currentPassword: account.password,
        newPassword,
        currentIterations: DEFAULT_ITERATIONS,
        profileKey: profile.key,
      })
    ).resolves.toBeUndefined();

    // The old password must no longer authenticate.
    const oldPrelogin = await deriveLoginHash(account.email, account.password, DEFAULT_ITERATIONS);
    const oldAttempt = await loginWithPassword(account.email, oldPrelogin.hash);
    expect('access_token' in oldAttempt).toBe(false);

    // The new password authenticates and its key still unlocks the vault.
    const newPrelogin = await deriveLoginHash(account.email, newPassword, DEFAULT_ITERATIONS);
    const token = (await loginWithPassword(account.email, newPrelogin.hash)) as TokenSuccess;
    expect(token.access_token).toBeTruthy();
    const unlocked = await unlockVaultKey(token.Key as string, newPrelogin.masterKey);
    expect(unlocked.symEncKey).toBeTruthy();
    expect(unlocked.symMacKey).toBeTruthy();
  });

  it('rejects a change with a wrong current password (server verification guard)', async () => {
    const account = await registerExtraAccount('auth-extra-change-pw-bad');
    const profile = await getProfile(account.authedFetch);
    await expect(
      changeMasterPassword(account.authedFetch, {
        email: account.email,
        currentPassword: 'definitely-not-the-password',
        newPassword: `pw-new-${crypto.randomUUID()}`,
        currentIterations: DEFAULT_ITERATIONS,
        profileKey: profile.key,
      })
    ).rejects.toThrow();
  });
});
