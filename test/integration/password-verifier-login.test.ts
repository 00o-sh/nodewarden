import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/services/auth';
import {
  createPasswordVerifier,
  needsPasswordVerifierUpgrade,
  verifyPasswordVerifier,
} from '../../src/services/password-verifier';
import { StorageService } from '../../src/services/storage';
import { upgradePasswordVerifier as upgradeStoredPasswordVerifier } from '../../src/services/storage-user-repo';
import { ENC_STRING, Session, TestAccount, api, authenticate, baseHeaders, newAccount, url } from './helpers';

// Upstream v1.8.1 changed how the server stores the second-layer password hash:
//   - new verifiers are '$s2$<iterations>$<random 32-byte salt>$<digest>' (a
//     per-user random salt instead of the e-mail address);
//   - legacy '$s$<digest>' (e-mail salted) and raw client-hash rows still verify
//     and are upgraded to '$s2$' after a successful password login;
//   - login no longer reveals whether an account exists or is disabled.
// Everything here runs against the real D1 binding, real WebCrypto and the real
// token endpoint; nothing about the hashing is mocked.

const db = (env as any).DB as D1Database;
let admin: Session;
let adminToken: string;
let ipCounter = 0;

// Each login attempt comes from its own address so the per-account/IP failed
// login limiter never interferes with the response being asserted.
function nextIp(): string {
  ipCounter += 1;
  return `198.51.${100 + Math.floor(ipCounter / 250)}.${ipCounter % 250 + 1}`;
}

function passwordForm(email: string, password: string, extra: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': nextIp() }),
    body: new URLSearchParams({
      grant_type: 'password',
      username: email,
      password,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: crypto.randomUUID(),
      deviceName: 'password-verifier-test',
      ...extra,
    }).toString(),
  });
}

async function storedVerifier(email: string): Promise<string> {
  const row = await db.prepare('SELECT master_password_hash AS h FROM users WHERE email = ?').bind(email).first<{ h: string }>();
  expect(row).toBeTruthy();
  return row!.h;
}

async function setStoredVerifier(email: string, value: string): Promise<void> {
  await db.prepare('UPDATE users SET master_password_hash = ? WHERE email = ?').bind(value, email).run();
}

// Independent re-implementation of the pre-v1.8.1 '$s$' format:
// PBKDF2-SHA256(clientHash, salt = lower-cased trimmed email, 100k, 256 bits).
async function legacyEmailSaltedVerifier(clientHash: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(clientHash), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(email.toLowerCase().trim()), iterations: 100_000 },
    key,
    256
  );
  return `$s$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}

// Registration is rate limited per client address, so each account registers
// from its own address too.
function registerFrom(account: TestAccount, inviteCode: string): Promise<Response> {
  return SELF.fetch(url('/api/accounts/register'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': nextIp() }),
    body: JSON.stringify({
      email: account.email,
      name: 'Password Verifier Test',
      masterPasswordHash: account.masterPasswordHash,
      key: ENC_STRING,
      kdf: 0,
      kdfIterations: 600000,
      inviteCode,
      keys: { publicKey: btoa(`pv-public-key-${'x'.repeat(40)}`), encryptedPrivateKey: ENC_STRING },
    }),
  });
}

async function makeUser(label: string): Promise<{ account: TestAccount; id: string }> {
  const invite = (await (await api('POST', '/api/admin/invites', adminToken, { masterPasswordHash: admin.account.masterPasswordHash })).json()) as any;
  const account = newAccount(label);
  expect((await registerFrom(account, invite.code)).status).toBe(200);
  const row = await db.prepare('SELECT id FROM users WHERE email = ?').bind(account.email).first<{ id: string }>();
  return { account, id: row!.id };
}

beforeAll(async () => {
  admin = await authenticate('pwverifier');
  adminToken = admin.accessToken;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('new verifiers use a per-user random salt', () => {
  it('registration stores a $s2$ verifier whose salt differs between users with the same password', async () => {
    const a = await makeUser('salt-a');
    const b = await makeUser('salt-b');
    const shared = btoa('same-client-hash');
    await setStoredVerifier(a.account.email, await createPasswordVerifier(shared));
    await setStoredVerifier(b.account.email, await createPasswordVerifier(shared));

    const va = await storedVerifier(a.account.email);
    const vb = await storedVerifier(b.account.email);
    const pattern = /^\$s2\$100000\$([A-Za-z0-9+/]{43}=)\$([A-Za-z0-9+/]{43}=)$/;
    const [, saltA, digestA] = va.match(pattern)!;
    const [, saltB, digestB] = vb.match(pattern)!;
    expect(saltA).not.toBe(saltB);
    expect(digestA).not.toBe(digestB);
    // The salt is not derived from the e-mail address any more.
    expect(va).not.toBe(await legacyEmailSaltedVerifier(shared, a.account.email));

    // Both still log in with the same client hash.
    expect((await passwordForm(a.account.email, shared)).status).toBe(200);
    expect((await passwordForm(b.account.email, shared)).status).toBe(200);
  });

  it('a freshly registered account is stored with a $s2$ verifier that is already current', async () => {
    const { account } = await makeUser('fresh');
    const stored = await storedVerifier(account.email);
    expect(stored.startsWith('$s2$100000$')).toBe(true);
    expect(needsPasswordVerifierUpgrade(stored)).toBe(false);
    expect(await verifyPasswordVerifier(account.masterPasswordHash, stored, 'ignored@vault.test')).toBe(true);
    expect(await verifyPasswordVerifier('wrong', stored, account.email)).toBe(false);
  });
});

describe('legacy verifiers still verify and are migrated on login', () => {
  it('an e-mail salted $s$ row logs in and is rewritten to $s2$', async () => {
    const { account } = await makeUser('legacy-s');
    const legacy = await legacyEmailSaltedVerifier(account.masterPasswordHash, account.email);
    await setStoredVerifier(account.email, legacy);

    // The legacy format verifies, case-insensitively on the e-mail salt.
    expect(await verifyPasswordVerifier(account.masterPasswordHash, legacy, account.email.toUpperCase())).toBe(true);
    expect(await verifyPasswordVerifier('wrong', legacy, account.email)).toBe(false);
    expect(needsPasswordVerifierUpgrade(legacy)).toBe(true);

    // A wrong password does not migrate the row.
    expect((await passwordForm(account.email, 'wrong-hash')).status).toBe(400);
    expect(await storedVerifier(account.email)).toBe(legacy);

    const res = await passwordForm(account.email, account.masterPasswordHash);
    expect(res.status).toBe(200);
    const upgraded = await storedVerifier(account.email);
    expect(upgraded).not.toBe(legacy);
    expect(upgraded).toMatch(/^\$s2\$100000\$/);
    expect(needsPasswordVerifierUpgrade(upgraded)).toBe(false);

    // The upgraded row keeps working.
    expect((await passwordForm(account.email, account.masterPasswordHash)).status).toBe(200);
  });

  it('a raw client-hash row logs in and is rewritten to $s2$', async () => {
    const { account } = await makeUser('legacy-raw');
    await setStoredVerifier(account.email, account.masterPasswordHash);
    expect((await passwordForm(account.email, account.masterPasswordHash)).status).toBe(200);
    const upgraded = await storedVerifier(account.email);
    expect(upgraded).toMatch(/^\$s2\$100000\$/);
    expect(await verifyPasswordVerifier(account.masterPasswordHash, upgraded, account.email)).toBe(true);
  });

  it('malformed or reserved verifier formats never authenticate', async () => {
    const client = 'client-hash';
    const good = await createPasswordVerifier(client);
    const [, , , salt, digest] = good.split('$');
    // A canonical-looking base64 string whose last character carries non-zero
    // padding bits: it decodes to 32 bytes but does not round-trip.
    const nonCanonical = `${salt.slice(0, 42)}B=`;
    const cases = [
      `$s2$999$${salt}$${digest}`, // a work factor this version does not write
      `$s2$100000$${salt}$${digest}$extra`, // wrong number of parts
      `$s2$100000$not-base64!$${digest}`, // salt not base64
      `$s2$100000$${salt}$short`, // digest not 32 bytes
      `$s2$100000$${nonCanonical}$${digest}`, // non-canonical salt encoding
      '$s$not-a-digest', // legacy prefix with a malformed digest
      '$x$anything', // unknown reserved format
    ];
    for (const stored of cases) {
      expect(await verifyPasswordVerifier(client, stored, 'a@b.test')).toBe(false);
      // Even the literal stored string must not work as a raw password.
      expect(await verifyPasswordVerifier(stored, stored, 'a@b.test')).toBe(false);
    }
    expect(await verifyPasswordVerifier(client, null, 'a@b.test')).toBe(false);
    expect(await verifyPasswordVerifier(client, good, 'a@b.test')).toBe(true);
  });
});

describe('verifier upgrade is conditional and best-effort', () => {
  it('does not overwrite a verifier that changed concurrently', async () => {
    const { account, id } = await makeUser('upgrade-race');
    const storage = new StorageService(db);
    const user = (await storage.getUser(account.email))!;
    const current = await storedVerifier(account.email);
    const replacement = await createPasswordVerifier('new-hash');

    // Expected verifier no longer matches (a password change won the race).
    expect(await storage.upgradePasswordVerifier(id, 'stale-verifier', user.securityStamp, replacement)).toBe(false);
    expect(await storedVerifier(account.email)).toBe(current);
    // Security stamp rotated since the read.
    expect(await storage.upgradePasswordVerifier(id, current, 'stale-stamp', replacement)).toBe(false);
    expect(await storedVerifier(account.email)).toBe(current);
    // Matching expectations update only the verifier.
    expect(await storage.upgradePasswordVerifier(id, current, user.securityStamp, replacement)).toBe(true);
    expect(await storedVerifier(account.email)).toBe(replacement);
    const after = (await storage.getUser(account.email))!;
    expect(after.securityStamp).toBe(user.securityStamp);
    expect(after.key).toBe(user.key);
  });

  it('treats a write result without a change count as not upgraded (fail closed)', async () => {
    const calls: unknown[][] = [];
    const fakeDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          calls.push([sql, ...args]);
          return { run: async () => ({ success: true, meta: {} }) };
        },
      }),
    } as unknown as D1Database;
    expect(await upgradeStoredPasswordVerifier(fakeDb, 'uid', 'old', 'stamp', 'new')).toBe(false);
    // The guarded UPDATE binds new verifier, id, expected verifier and stamp, in that order.
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("status = 'active'");
    expect(calls[0].slice(1)).toEqual(['new', 'uid', 'old', 'stamp']);
  });

  it('AuthService.upgradePasswordVerifier migrates legacy rows, skips current ones and leaves a lost race alone', async () => {
    const auth = new AuthService(env as any);
    const storage = new StorageService(db);

    const { account: legacyAccount } = await makeUser('svc-legacy');
    await setStoredVerifier(legacyAccount.email, legacyAccount.masterPasswordHash);
    const legacyUser = (await storage.getUser(legacyAccount.email))!;
    await auth.upgradePasswordVerifier(legacyUser, legacyAccount.masterPasswordHash);
    expect(legacyUser.masterPasswordHash).toMatch(/^\$s2\$/);
    expect(await storedVerifier(legacyAccount.email)).toBe(legacyUser.masterPasswordHash);

    // Already-current verifiers are not rewritten.
    const current = legacyUser.masterPasswordHash;
    await auth.upgradePasswordVerifier(legacyUser, legacyAccount.masterPasswordHash);
    expect(await storedVerifier(legacyAccount.email)).toBe(current);

    // The in-memory user is stale (the row changed underneath): nothing is written
    // and the in-memory copy keeps its old value.
    const { account: raceAccount } = await makeUser('svc-race');
    await setStoredVerifier(raceAccount.email, raceAccount.masterPasswordHash);
    const staleUser = (await storage.getUser(raceAccount.email))!;
    const concurrent = await createPasswordVerifier('changed-elsewhere');
    await setStoredVerifier(raceAccount.email, concurrent);
    await auth.upgradePasswordVerifier(staleUser, raceAccount.masterPasswordHash);
    expect(staleUser.masterPasswordHash).toBe(raceAccount.masterPasswordHash);
    expect(await storedVerifier(raceAccount.email)).toBe(concurrent);
  });

  it('a failed upgrade is swallowed and logs no credentials', async () => {
    const auth = new AuthService(env as any);
    const storage = new StorageService(db);
    const { account } = await makeUser('svc-fail');
    await setStoredVerifier(account.email, account.masterPasswordHash);
    const user = (await storage.getUser(account.email))!;

    vi.spyOn(auth, 'hashPasswordServer').mockRejectedValue(new Error('kdf unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(auth.upgradePasswordVerifier(user, account.masterPasswordHash)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Password verifier upgrade deferred');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(account.masterPasswordHash);
    expect(user.masterPasswordHash).toBe(account.masterPasswordHash);
    expect(await storedVerifier(account.email)).toBe(account.masterPasswordHash);
  });
});

describe('login does not reveal whether an account exists or is disabled', () => {
  async function failure(res: Response): Promise<{ status: number; body: unknown }> {
    return { status: res.status, body: await res.json() };
  }

  it('wrong password, unknown user and disabled user get the identical error', async () => {
    const { account: active } = await makeUser('enum-active');
    const { account: disabled, id: disabledId } = await makeUser('enum-disabled');
    expect((await api('PUT', `/api/admin/users/${disabledId}/status`, adminToken, {
      status: 'banned',
      masterPasswordHash: admin.account.masterPasswordHash,
    })).status).toBe(200);

    const wrongPassword = await failure(await passwordForm(active.email, 'definitely-wrong'));
    const unknownUser = await failure(await passwordForm(`nobody-${crypto.randomUUID()}@vault.test`, active.masterPasswordHash));
    // The disabled account presents its CORRECT password and still learns nothing.
    const disabledUser = await failure(await passwordForm(disabled.email, disabled.masterPasswordHash));

    expect(wrongPassword.status).toBe(400);
    expect((wrongPassword.body as any).error).toBe('invalid_grant');
    expect(unknownUser).toEqual(wrongPassword);
    expect(disabledUser).toEqual(wrongPassword);
    expect(JSON.stringify(disabledUser.body).toLowerCase()).not.toContain('disabled');

    // The disabled account's legacy-format row is not migrated by a refused login.
    await setStoredVerifier(disabled.email, disabled.masterPasswordHash);
    expect(await failure(await passwordForm(disabled.email, disabled.masterPasswordHash))).toEqual(wrongPassword);
    expect(await storedVerifier(disabled.email)).toBe(disabled.masterPasswordHash);
  });

  it('auth-request grants get the same error for unknown, disabled and wrong-code cases', async () => {
    const { account: active } = await makeUser('enum-ar-active');
    const { account: disabled, id: disabledId } = await makeUser('enum-ar-disabled');
    expect((await api('PUT', `/api/admin/users/${disabledId}/status`, adminToken, {
      status: 'banned',
      masterPasswordHash: admin.account.masterPasswordHash,
    })).status).toBe(200);

    const authRequest = { authRequest: crypto.randomUUID() };
    const wrongCode = await failure(await passwordForm(active.email, 'not-the-access-code', authRequest));
    const unknownUser = await failure(await passwordForm(`nobody-${crypto.randomUUID()}@vault.test`, 'code', authRequest));
    const disabledUser = await failure(await passwordForm(disabled.email, 'code', authRequest));
    const passwordFailure = await failure(await passwordForm(active.email, 'definitely-wrong'));

    expect(wrongCode.status).toBe(400);
    expect(unknownUser).toEqual(wrongCode);
    expect(disabledUser).toEqual(wrongCode);
    expect(wrongCode).toEqual(passwordFailure);
  });

  it('audits a refused disabled-account login as user_inactive without changing the response', async () => {
    const { account, id } = await makeUser('enum-audit');
    expect((await api('PUT', `/api/admin/users/${id}/status`, adminToken, {
      status: 'banned',
      masterPasswordHash: admin.account.masterPasswordHash,
    })).status).toBe(200);
    expect((await passwordForm(account.email, account.masterPasswordHash)).status).toBe(400);
    const row = await db
      .prepare("SELECT action FROM audit_logs WHERE target_id = ? AND action LIKE 'auth.login.failed.%' ORDER BY created_at DESC LIMIT 1")
      .bind(id)
      .first<{ action: string }>();
    expect(row?.action).toBe('auth.login.failed.user_inactive');
  });
});
