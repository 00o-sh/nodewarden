import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, login } from './helpers';

// Changing the master password rotates the security stamp and the password
// itself, so this lives in its own file with a dedicated first-account admin.
let session: Session;

beforeAll(async () => {
  session = await authenticate('pw');
});

describe('change master password', () => {
  it('rejects a change with the wrong current password (400)', async () => {
    // Runs before the successful change, while the token is still valid.
    const res = await api('POST', '/api/accounts/password', session.accessToken, {
      masterPasswordHash: 'wrong',
      newMasterPasswordHash: btoa('whatever'),
      newKey: ENC_STRING,
      newEncryptedPrivateKey: ENC_STRING,
    });
    expect(res.status).toBe(400);
  });

  it('changes the password: the new one authenticates and the old one fails', async () => {
    const newHash = btoa(`new-${crypto.randomUUID()}`);
    const res = await api('POST', '/api/accounts/password', session.accessToken, {
      masterPasswordHash: session.account.masterPasswordHash,
      newMasterPasswordHash: newHash,
      newKey: ENC_STRING,
      newEncryptedPrivateKey: ENC_STRING,
    });
    expect(res.status).toBe(200);

    expect((await login(session.account)).status).toBe(400);
    expect((await login({ ...session.account, masterPasswordHash: newHash })).status).toBe(200);
  });
});
