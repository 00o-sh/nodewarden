import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// The device-verification-settings two-factor endpoints (distinct from the
// /api/accounts/verify-devices path): reading the current setting, toggling it
// with a verified master password, and the validation / verification-failure
// branches. Real authenticated API + D1, no mocks.
let session: Session;
let token: string;
let mph: string;

function raw(method: string, path: string, contentType: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': contentType }),
    body,
  });
}

beforeAll(async () => {
  session = await authenticate('devverify');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

describe('two-factor device-verification-settings', () => {
  it('reports device verification enabled by default', async () => {
    const res = await api('POST', '/api/two-factor/get-device-verification-settings', token, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Object).toBe('deviceVerificationSettings');
    // A freshly-registered account has verifyDevices !== false.
    expect(body.Enabled).toBe(true);
    expect(body.VerifyDevices).toBe(true);
  });

  it('400s a malformed device-verification-settings body', async () => {
    expect((await raw('PUT', '/api/two-factor/device-verification-settings', 'application/json', '{bad')).status).toBe(400);
  });

  it('400s when enabled is not a boolean', async () => {
    const res = await api('PUT', '/api/two-factor/device-verification-settings', token, { enabled: 'yes', masterPasswordHash: mph });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('enabled must be true or false');
  });

  it('400s when the master password verification fails', async () => {
    const res = await api('PUT', '/api/two-factor/device-verification-settings', token, { enabled: false, masterPasswordHash: 'definitely-wrong' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('verification failed');
  });

  it('disables device verification with a verified master password', async () => {
    const res = await api('PUT', '/api/two-factor/device-verification-settings', token, { enabled: false, masterPasswordHash: mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Enabled).toBe(false);
    expect(body.VerifyDevices).toBe(false);

    // The change is persisted: the read endpoint now reports disabled.
    const after = (await (await api('POST', '/api/two-factor/get-device-verification-settings', token, {})).json()) as any;
    expect(after.Enabled).toBe(false);
  });

  it('re-enables device verification via POST with a verified master password', async () => {
    // The route accepts POST as well as PUT.
    const res = await api('POST', '/api/two-factor/device-verification-settings', token, { enabled: true, masterPasswordHash: mph });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).Enabled).toBe(true);
  });
});
