import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// The batch trust endpoints: POST /api/devices/update-trust (current + other
// devices) and POST /api/devices/untrust.
let session: Session;
let token: string;
let deviceId: string;

beforeAll(async () => {
  session = await authenticate('devtrust2');
  token = session.accessToken;
  deviceId = session.account.deviceIdentifier;
});

function postJson(path: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra }),
    body: JSON.stringify(body),
  });
}

describe('batch device trust', () => {
  it('updates the current device key set via update-trust', async () => {
    const res = await postJson(
      '/api/devices/update-trust',
      {
        currentDevice: { encryptedUserKey: ENC_STRING, encryptedPublicKey: ENC_STRING, encryptedPrivateKey: ENC_STRING },
        otherDevices: [{ deviceId: crypto.randomUUID(), encryptedUserKey: ENC_STRING }],
      },
      { 'Device-Identifier': deviceId }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    // The current device updates; the unknown other device does not.
    expect(body.updated).toBe(1);
  });

  it('is a no-op update-trust when no devices are supplied', async () => {
    const res = await postJson('/api/devices/update-trust', {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).updated).toBe(0);
  });

  it('untrusts a batch of devices', async () => {
    const res = await postJson('/api/devices/untrust', { devices: [deviceId] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(typeof body.removed).toBe('number');
  });

  it('handles an untrust with no devices', async () => {
    const res = await api('POST', '/api/devices/untrust', token, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).removed).toBe(0);
  });
});
