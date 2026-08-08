import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, login } from './helpers';

// A change-password request that also rotates the public key, the encrypted
// private key, and sets a master-password hint exercises the optional assignment
// branches in handleChangePassword that a minimal key-only rotation leaves
// untouched. v1.8.0: the password endpoint no longer changes KDF settings — the
// KDF params in the body must match the account's current KDF or the request is
// rejected. Real worker + real D1 + real password hashing, no mocks.
let session: Session;

beforeAll(async () => {
  session = await authenticate('pwfull');
});

describe('change master password (full rotation body)', () => {
  it('applies public key, encrypted private key, and a hint, then authenticates with the new password', async () => {
    const newHash = btoa(`full-${crypto.randomUUID()}`);
    const res = await api('POST', '/api/accounts/password', session.accessToken, {
      masterPasswordHash: session.account.masterPasswordHash,
      newMasterPasswordHash: newHash,
      newKey: ENC_STRING,
      newEncryptedPrivateKey: ENC_STRING,
      newPublicKey: ENC_STRING,
      // KDF must be unchanged: match the account's registration KDF (PBKDF2,
      // 600000 iterations). Changing it via this endpoint is rejected in v1.8.0.
      kdf: 0,
      kdfIterations: 600000,
      masterPasswordHint: 'my hint',
    });
    expect(res.status).toBe(200);

    // The rotation took effect: the new password authenticates, the old fails.
    expect((await login(session.account)).status).toBe(400);
    expect((await login({ ...session.account, masterPasswordHash: newHash })).status).toBe(200);
  });
});
