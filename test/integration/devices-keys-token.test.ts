import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// Device key/token sub-routes: retrieve-keys (not-found + success),
// update-keys not-found, the no-op push-token / web-push-auth / clear-token
// handlers, and device deactivation. Real D1, no mocks.
//
// Deactivation deletes the session's own device (invalidating the access
// token), so it runs last.
let session: Session;
let token: string;
let deviceId: string;

beforeAll(async () => {
  session = await authenticate('devkeystoken');
  token = session.accessToken;
  const list = (await (await api('GET', '/api/devices', token)).json()) as any;
  deviceId = list.data[0].identifier;
});

describe('device keys and token sub-routes', () => {
  it('404s retrieve-keys for an unknown device', async () => {
    expect((await api('POST', `/api/devices/${crypto.randomUUID()}/retrieve-keys`, token, {})).status).toBe(404);
  });

  it('retrieves protected keys for a real device', async () => {
    const res = await api('POST', `/api/devices/${deviceId}/retrieve-keys`, token, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).identifier).toBe(deviceId);
  });

  it('404s update-keys for an unknown device', async () => {
    expect((await api('PUT', `/api/devices/${crypto.randomUUID()}/keys`, token, {})).status).toBe(404);
  });

  it('accepts a push-token update (no-op)', async () => {
    expect((await api('PUT', `/api/devices/identifier/${crypto.randomUUID()}/token`, token, { pushToken: 'x' })).status).toBe(200);
  });

  it('accepts a web-push-auth update (no-op)', async () => {
    expect((await api('PUT', `/api/devices/identifier/${crypto.randomUUID()}/web-push-auth`, token, {})).status).toBe(200);
  });

  it('accepts a clear-token request (no-op)', async () => {
    expect((await api('PUT', `/api/devices/identifier/${crypto.randomUUID()}/clear-token`, token, {})).status).toBe(200);
  });

  it('deactivates a real device', async () => {
    const res = await api('POST', `/api/devices/${deviceId}/deactivate`, token, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).success).toBe(true);
  });
});
