import { beforeAll, describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  ENC_STRING,
  api,
  baseHeaders,
  createCipher,
  createFolder,
  login,
  newAccount,
  register,
  url,
  type TestAccount,
} from './helpers';

// ---------------------------------------------------------------------------
// Bitwarden-CLIENT wire contract.
//
// Unlike the other integration tests (which assert behaviour) and the webapp
// contract suite (which drives this repo's OWN normalized client), these tests
// pin the raw JSON SHAPE that real Bitwarden clients — mobile, browser
// extension, desktop, the `bw` CLI — require on the wire. The server makes
// several DELIBERATE compatibility decisions documented only in code comments
// (the dual PascalCase+camelCase unlock surface, a non-null secureNote, the
// `object` discriminators) that had no regression protection: a casing or
// field-shape change would silently break a real client on an HTTP 200. Each
// assertion below locks one of those contract points.
//
// One account is registered for the whole file (registration is rate-limited
// per client IP); the read-only contract assertions all reuse its session.
// Grounded in the response builders in src/handlers/identity.ts,
// src/handlers/sync.ts, src/handlers/ciphers.ts and src/utils/*.
// ---------------------------------------------------------------------------

let account: TestAccount;
let tokenResponse: Record<string, any>;
let accessToken: string;
let refreshToken: string;

beforeAll(async () => {
  account = newAccount('contract');
  const reg = await register(account);
  if (reg.status !== 200) throw new Error(`register failed ${reg.status}: ${await reg.text()}`);
  const res = await login(account);
  if (res.status !== 200) throw new Error(`login failed ${res.status}: ${await res.text()}`);
  tokenResponse = (await res.json()) as Record<string, any>;
  accessToken = tokenResponse.access_token;
  refreshToken = tokenResponse.refresh_token;
});

describe('contract: POST /identity/connect/token (password grant)', () => {
  it('returns the OAuth envelope Bitwarden clients expect', () => {
    expect(typeof tokenResponse.access_token).toBe('string');
    expect(tokenResponse.token_type).toBe('Bearer');
    expect(typeof tokenResponse.expires_in).toBe('number');
    expect(typeof tokenResponse.refresh_token).toBe('string');
    expect(tokenResponse.scope).toBe('api offline_access');
  });

  it('returns the vault key material (PascalCase) needed to unlock', () => {
    // The registered account key is ENC_STRING; clients decrypt the vault with it.
    expect(tokenResponse.Key).toBe(ENC_STRING);
    expect(typeof tokenResponse.PrivateKey).toBe('string');
    // KDF params are PascalCase in the token response (clients derive the master
    // key from these). kdf=0 == PBKDF2.
    expect(typeof tokenResponse.Kdf).toBe('number');
    expect(typeof tokenResponse.KdfIterations).toBe('number');
  });

  it('returns UserDecryptionOptions.MasterPasswordUnlock (mobile/desktop unlock path)', () => {
    const udo = tokenResponse.UserDecryptionOptions;
    expect(udo).toBeTruthy();
    expect(udo.HasMasterPassword).toBe(true);
    expect(udo.Object).toBe('userDecryptionOptions');
    const mpu = udo.MasterPasswordUnlock;
    expect(mpu).toBeTruthy();
    expect(mpu.Object).toBe('masterPasswordUnlock');
    expect(mpu.MasterKeyEncryptedUserKey).toBe(ENC_STRING);
    expect(typeof mpu.Salt).toBe('string');
    // Nested KDF descriptor, all PascalCase.
    expect(typeof mpu.Kdf.KdfType).toBe('number');
    expect(typeof mpu.Kdf.Iterations).toBe('number');
  });

  it('emits BOTH casings of the migration-sensitive fields (compat hedge)', () => {
    // The server deliberately duplicates these across the PascalCase->camelCase
    // migration so old and new clients both find them.
    expect(tokenResponse.AccountKeys ?? null).not.toBeNull();
    expect(tokenResponse.accountKeys ?? null).not.toBeNull();
    expect(tokenResponse.UserDecryptionOptions ?? null).not.toBeNull();
    expect(tokenResponse.userDecryptionOptions ?? null).not.toBeNull();
    expect(tokenResponse.unofficialServer).toBe(true);
  });
});

describe('contract: POST /identity/connect/token (refresh_token grant)', () => {
  it('re-issues the same envelope and key material, echoing the refresh token', async () => {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'web',
    });
    const res = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form.toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.token_type).toBe('Bearer');
    expect(typeof body.access_token).toBe('string');
    // This server does not rotate the refresh token — it echoes the same one.
    expect(body.refresh_token).toBe(refreshToken);
    // The unlock material must be present on refresh too (clients re-hydrate it).
    expect(body.Key).toBe(ENC_STRING);
    expect(body.UserDecryptionOptions?.MasterPasswordUnlock?.Object).toBe('masterPasswordUnlock');
  });

  it('rejects an invalid refresh token with invalid_grant', async () => {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'not-a-real-token',
      client_id: 'web',
    });
    const res = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, any>).error).toBe('invalid_grant');
  });
});

describe('contract: POST /identity/accounts/prelogin', () => {
  it('returns KDF params in both camelCase and the PascalCase legacy alias', async () => {
    const res = await SELF.fetch(url('/identity/accounts/prelogin'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: account.email }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    // Modern clients read camelCase kdf/kdfIterations.
    expect(typeof body.kdf).toBe('number');
    expect(typeof body.kdfIterations).toBe('number');
    // camelCase consolidated descriptor.
    expect(typeof body.kdfSettings?.kdfType).toBe('number');
    expect(typeof body.kdfSettings?.iterations).toBe('number');
    // PascalCase legacy alias older clients read.
    expect(typeof body.KdfSettings?.KdfType).toBe('number');
    expect(typeof body.KdfSettings?.Iterations).toBe('number');
  });

  it('returns defaults for an unknown user (no account enumeration)', async () => {
    const res = await SELF.fetch(url('/identity/accounts/prelogin'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: `nobody-${crypto.randomUUID()}@vault.test` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(typeof body.kdf).toBe('number');
    expect(typeof body.kdfIterations).toBe('number');
  });
});

describe('contract: GET /api/sync', () => {
  it('returns the sync envelope with camelCase vault objects and the unlock blocks', async () => {
    await createCipher(accessToken);
    await createFolder(accessToken);
    const res = await api('GET', '/api/sync', accessToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.object).toBe('sync');
    // Vault surface: camelCase arrays.
    expect(Array.isArray(body.ciphers)).toBe(true);
    expect(Array.isArray(body.folders)).toBe(true);
    expect(Array.isArray(body.collections)).toBe(true);
    expect(Array.isArray(body.sends)).toBe(true);

    // Profile block, camelCase, with the fields clients read to render the account.
    expect(body.profile?.object).toBe('profile');
    expect(body.profile?.email).toBe(account.email);
    expect(typeof body.profile?.key).toBe('string');
    expect(typeof body.profile?.privateKey).toBe('string');

    // Unlock surface: PascalCase UserDecryptionOptions + the camelCase compat twin.
    expect(body.UserDecryptionOptions?.MasterPasswordUnlock?.Object).toBe('masterPasswordUnlock');
    expect(body.userDecryption ?? null).not.toBeNull();

    // The created objects round-trip into sync with their discriminators.
    expect(body.ciphers[0]?.object).toBe('cipherDetails');
    expect(body.folders[0]?.object).toBe('folder');
  });
});

describe('contract: cipher object envelope', () => {
  it('POST /api/ciphers returns a cipherDetails object with the client-required fields', async () => {
    const cipher = await createCipher(accessToken);

    expect(cipher.object).toBe('cipherDetails');
    expect(typeof cipher.id).toBe('string');
    expect(cipher.type).toBe(1);
    // Timestamps clients use for sync reconciliation.
    expect(typeof cipher.creationDate).toBe('string');
    expect(typeof cipher.revisionDate).toBe('string');
    // Permission flags clients read to gate the UI.
    expect(cipher.edit).toBe(true);
    expect(cipher.viewPassword).toBe(true);
    expect(typeof cipher.permissions?.delete).toBe('boolean');
    expect(typeof cipher.permissions?.restore).toBe('boolean');
    // collectionIds must be an array (clients iterate it), empty for a personal item.
    expect(Array.isArray(cipher.collectionIds)).toBe(true);
    expect(cipher.collectionIds).toHaveLength(0);
    // The login sub-object survives the round trip.
    expect(cipher.login).toBeTruthy();
    expect(typeof cipher.login.username).toBe('string');
  });

  it('a type-2 (secure note) cipher carries the non-null secureNote clients require', async () => {
    const cipher = await createCipher(accessToken, {
      type: 2,
      login: undefined,
      secureNote: { type: 0 },
    });
    expect(cipher.object).toBe('cipherDetails');
    expect(cipher.type).toBe(2);
    // The server defaults secureNote to { type: 0 } — clients crash on a null note.
    expect(cipher.secureNote?.type).toBe(0);
  });
});

describe('contract: folder object envelope', () => {
  it('POST /api/folders returns { id, name, revisionDate, creationDate, object }', async () => {
    const folder = await createFolder(accessToken);
    expect(folder.object).toBe('folder');
    expect(typeof folder.id).toBe('string');
    expect(typeof folder.name).toBe('string');
    expect(typeof folder.revisionDate).toBe('string');
    expect(typeof folder.creationDate).toBe('string');
  });
});

describe('contract: error response shapes', () => {
  it('a bad password login returns the identity error envelope (ErrorModel + invalid_grant)', async () => {
    const form = new URLSearchParams({
      grant_type: 'password',
      username: account.email,
      password: 'wrong-password-hash',
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: account.deviceIdentifier,
      deviceName: 'integration-test',
    });
    const res = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form.toString(),
    });
    expect(res.status).toBe(400);
    // Identity errors must not be cached by intermediaries.
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const body = (await res.json()) as Record<string, any>;
    expect(body.error).toBe('invalid_grant');
    expect(typeof body.error_description).toBe('string');
    // Bitwarden clients surface ErrorModel.Message to the user.
    expect(typeof body.ErrorModel?.Message).toBe('string');
    expect(body.ErrorModel?.Object).toBe('error');
  });

  it('an authenticated request for a missing cipher returns the ErrorModel envelope', async () => {
    const res = await api('GET', `/api/ciphers/${crypto.randomUUID()}`, accessToken);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as Record<string, any>;
    // The /api/* error envelope this server emits: { error, error_description,
    // ErrorModel: { Message, Object: 'error' } }.
    expect(body.ErrorModel?.Object).toBe('error');
    expect(typeof body.ErrorModel?.Message).toBe('string');
  });
});
