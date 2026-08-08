import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session, api, authenticate, freshToken } from './helpers';

let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('acctextra');
  mph = session.account.masterPasswordHash;
});

beforeEach(async () => {
  token = await freshToken(session.account);
});

describe('key updates', () => {
  it('updates only the public key', async () => {
    const res = await api('POST', '/api/accounts/keys', token, {
      masterPasswordHash: mph,
      publicKey: 'bmV3LXB1Yg==',
    });
    expect(res.status).toBe(200);
  });

  it('rejects a non-encrypted key string (400)', async () => {
    const res = await api('POST', '/api/accounts/keys', token, {
      masterPasswordHash: mph,
      key: 'not-an-enc-string',
    });
    expect(res.status).toBe(400);
  });
});

describe('verify devices toggle', () => {
  it('rejects enabling verify-devices even with a valid secret (feature disabled)', async () => {
    // v1.8.0: new-device verification is unsupported; the endpoint always 400s
    // and never changes state.
    const res = await api('POST', '/api/accounts/verify-devices', token, {
      verifyDevices: true,
      secret: mph,
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('not available');
  });
});
