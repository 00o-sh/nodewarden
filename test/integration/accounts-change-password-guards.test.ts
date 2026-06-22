import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';

// Validation guards of the change-password endpoint. Each returns before the
// password is actually rotated (which would change the security stamp and
// invalidate the session), so they are safe to run against a shared session.
// Real D1, no mocks.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('changepwguards');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

function change(body: Record<string, unknown>): Promise<Response> {
  return api('POST', '/api/accounts/password', token, body);
}

describe('change password guards', () => {
  it('400s a missing current password hash', async () => {
    expect((await change({ newMasterPasswordHash: 'x' })).status).toBe(400);
  });

  it('400s an incorrect current password', async () => {
    expect((await change({ currentPasswordHash: 'wrong', newMasterPasswordHash: 'x' })).status).toBe(400);
  });

  it('400s a missing new master password hash', async () => {
    expect((await change({ currentPasswordHash: mph })).status).toBe(400);
  });

  it('400s a new key that is not a valid encrypted string', async () => {
    expect((await change({ currentPasswordHash: mph, newMasterPasswordHash: 'x', newKey: 'plain-key' })).status).toBe(400);
  });

  it('400s a new encrypted private key that is invalid', async () => {
    expect((await change({ currentPasswordHash: mph, newMasterPasswordHash: 'x', newKey: ENC_STRING, newEncryptedPrivateKey: 'plain' })).status).toBe(400);
  });

  it('400s invalid Argon2id KDF parameters', async () => {
    expect((await change({ currentPasswordHash: mph, newMasterPasswordHash: 'x', kdf: 1, kdfIterations: 1 })).status).toBe(400);
  });
});
