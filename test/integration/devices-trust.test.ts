import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';

// Trusted-device (device-key) endpoints: a device with stored keys is
// "authorized"; it can be revoked individually or in bulk.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('devtrust');
  token = session.accessToken;
  // Storing device keys makes the login device a trusted/authorized device.
  await api('PUT', `/api/devices/${session.account.deviceIdentifier}/keys`, token, {
    encryptedUserKey: ENC_STRING,
    encryptedPublicKey: 'cHVi',
    encryptedPrivateKey: ENC_STRING,
  });
});

describe('authorized devices', () => {
  it('lists the trusted device', async () => {
    const res = await api('GET', '/api/devices/authorized', token);
    expect(res.status).toBe(200);
  });

  it('rejects making an untrusted (no remember-token) device permanent (409)', async () => {
    const res = await api('POST', `/api/devices/authorized/${session.account.deviceIdentifier}/permanent`, token, {});
    expect(res.status).toBe(409);
  });

  it('revokes a single trusted device', async () => {
    const res = await api('DELETE', `/api/devices/authorized/${session.account.deviceIdentifier}`, token);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('revokes all trusted devices', async () => {
    const res = await api('DELETE', '/api/devices/authorized', token);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
