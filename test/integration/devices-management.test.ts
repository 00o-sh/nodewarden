import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';

// Device management endpoints beyond list/authorized: get by id, key
// update/retrieve, name change, the push-token no-op endpoints, and deactivate.
let session: Session;
let token: string;
let deviceId: string;

beforeAll(async () => {
  session = await authenticate('devmgmt');
  token = session.accessToken;
  deviceId = session.account.deviceIdentifier;
});

describe('device management', () => {
  it('gets the current device by identifier and by id', async () => {
    const byIdentifier = await api('GET', `/api/devices/identifier/${deviceId}`, token);
    expect(byIdentifier.status).toBe(200);
    const byId = await api('GET', `/api/devices/${deviceId}`, token);
    expect(byId.status).toBe(200);
  });

  it('updates and retrieves device keys', async () => {
    const update = await api('PUT', `/api/devices/${deviceId}/keys`, token, {
      encryptedUserKey: ENC_STRING,
      encryptedPublicKey: ENC_STRING,
      encryptedPrivateKey: ENC_STRING,
    });
    expect(update.status).toBe(200);

    const retrieve = await api('POST', `/api/devices/${deviceId}/retrieve-keys`, token, {});
    expect(retrieve.status).toBe(200);
    const body = (await retrieve.json()) as any;
    expect(body.encryptedUserKey ?? body.EncryptedUserKey).toBeTruthy();
  });

  it('accepts the push-token no-op endpoints (token / web-push-auth / clear-token)', async () => {
    expect((await api('PUT', `/api/devices/identifier/${deviceId}/token`, token, { pushToken: 'x' })).status).toBe(200);
    expect((await api('PUT', `/api/devices/identifier/${deviceId}/web-push-auth`, token, { endpoint: 'x' })).status).toBe(200);
    expect((await api('PUT', `/api/devices/identifier/${deviceId}/clear-token`, token, {})).status).toBe(200);
  });

  it('renames a device, and validates the name', async () => {
    const ok = await api('PUT', `/api/devices/${deviceId}/name`, token, { name: 'renamed-device' });
    expect(ok.status).toBe(200);

    expect((await api('PUT', `/api/devices/${deviceId}/name`, token, { name: '' })).status).toBe(400);
    expect((await api('PUT', `/api/devices/${crypto.randomUUID()}/name`, token, { name: 'ghost' })).status).toBe(404);
  });

  it('reports success deactivating the device (run last — it removes the device)', async () => {
    const res = await api('POST', `/api/devices/${deviceId}/deactivate`, token, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).success).toBe(true);
  });
});
