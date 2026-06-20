import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, login } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('devices');
  token = session.accessToken;
});

describe('device management', () => {
  it('lists the device created at login', async () => {
    const res = await api('GET', '/api/devices', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('list');
    expect(body.data.map((d: any) => d.identifier)).toContain(session.account.deviceIdentifier);
  });

  it('fetches a device by identifier', async () => {
    const res = await api('GET', `/api/devices/identifier/${session.account.deviceIdentifier}`, token);
    expect(res.status).toBe(200);
    expect((await res.json()).object).toBe('device');
  });

  it('renames a device', async () => {
    const res = await api('PUT', `/api/devices/${session.account.deviceIdentifier}/name`, token, {
      name: 'Renamed Device',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Renamed Device');
  });

  it('lists authorized (trusted) devices', async () => {
    const res = await api('GET', '/api/devices/authorized', token);
    expect(res.status).toBe(200);
  });

  it('deletes a device', async () => {
    // Register a throwaway second device by logging in with a new identifier.
    const other = { ...session.account, deviceIdentifier: crypto.randomUUID() };
    expect((await login(other)).status).toBe(200);

    const del = await api('DELETE', `/api/devices/${other.deviceIdentifier}`, token);
    expect(del.status).toBe(200);
    expect((await del.json()).success).toBe(true);
  });

  it('returns 404 for an unknown device identifier', async () => {
    const res = await api('GET', `/api/devices/identifier/${crypto.randomUUID()}`, token);
    expect(res.status).toBe(404);
  });
});

describe('device keys and tokens', () => {
  const id = () => session.account.deviceIdentifier;

  it('updates and retrieves device keys (trusted device)', async () => {
    const update = await api('PUT', `/api/devices/${id()}/keys`, token, {
      encryptedUserKey: ENC_STRING,
      encryptedPublicKey: 'cHVi',
      encryptedPrivateKey: ENC_STRING,
    });
    expect(update.status).toBe(200);

    const retrieve = await api('POST', `/api/devices/${id()}/retrieve-keys`, token, {});
    expect(retrieve.status).toBe(200);
  });

  it('accepts push-token, web-push, and clear-token updates', async () => {
    expect((await api('PUT', `/api/devices/identifier/${id()}/token`, token, { pushToken: 'tok' })).status).toBe(200);
    expect((await api('PUT', `/api/devices/identifier/${id()}/web-push-auth`, token, { endpoint: 'https://push.example' })).status).toBe(200);
    expect((await api('PUT', `/api/devices/identifier/${id()}/clear-token`, token, {})).status).toBe(200);
  });

  it('deactivates a throwaway device', async () => {
    const other = { ...session.account, deviceIdentifier: crypto.randomUUID() };
    expect((await login(other)).status).toBe(200);
    const res = await api('POST', `/api/devices/${other.deviceIdentifier}/deactivate`, token, {});
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
