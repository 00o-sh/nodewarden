import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, randomBase32, totpToken } from './helpers';

// Enabling TOTP verifies the supplied token against the secret. A
// correctly-shaped but wrong token is rejected with 400 "Invalid TOTP token"
// (distinct from the missing-token and invalid-secret branches). Real TOTP
// verification, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('totpenable');
  token = session.accessToken;
});

describe('TOTP enable verification', () => {
  it('rejects enabling when user verification fails (wrong master password)', async () => {
    const res = await api('POST', '/api/accounts/totp', token, {
      enabled: true, secret: randomBase32(), token: '000000', masterPasswordHash: 'wrong-password',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('user verification failed');
  });

  it('rejects a valid-format but incorrect TOTP token after user verification', async () => {
    const secret = randomBase32();
    const real = await totpToken(secret);
    // Pick any 6-digit value that is not the current code.
    const wrong = real === '000000' ? '000001' : '000000';
    const res = await api('POST', '/api/accounts/totp', token, {
      enabled: true, secret, token: wrong, masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid totp token');
  });
});
