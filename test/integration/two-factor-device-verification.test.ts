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
  it('reports device verification disabled by default', async () => {
    // v1.8.0: new-device verification is unsupported (no email delivery channel),
    // so the settings endpoint always reports it disabled.
    const res = await api('POST', '/api/two-factor/get-device-verification-settings', token, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Object).toBe('deviceVerificationSettings');
    expect(body.Enabled).toBe(false);
    expect(body.VerifyDevices).toBe(false);
  });

  it('400s a malformed device-verification-settings body', async () => {
    expect((await raw('PUT', '/api/two-factor/device-verification-settings', 'application/json', '{bad')).status).toBe(400);
  });

  it('ignores a non-boolean enabled value and stays disabled', async () => {
    // A non-`true` value is not an enable attempt: the endpoint returns the
    // disabled state (master password is no longer consulted).
    const res = await api('PUT', '/api/two-factor/device-verification-settings', token, { enabled: 'yes', masterPasswordHash: mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Enabled).toBe(false);
    expect(body.VerifyDevices).toBe(false);
  });

  it('rejects enabling device verification via PUT', async () => {
    // Enabling is unsupported and rejected regardless of the master password.
    const res = await api('PUT', '/api/two-factor/device-verification-settings', token, { enabled: true, masterPasswordHash: mph });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('not available');
  });

  it('keeps device verification disabled and reports it as such', async () => {
    const res = await api('PUT', '/api/two-factor/device-verification-settings', token, { enabled: false, masterPasswordHash: mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.Enabled).toBe(false);
    expect(body.VerifyDevices).toBe(false);

    // The read endpoint continues to report disabled.
    const after = (await (await api('POST', '/api/two-factor/get-device-verification-settings', token, {})).json()) as any;
    expect(after.Enabled).toBe(false);
  });

  it('rejects re-enabling device verification via POST', async () => {
    // The route accepts POST as well as PUT; enabling is rejected either way.
    const res = await api('POST', '/api/two-factor/device-verification-settings', token, { enabled: true, masterPasswordHash: mph });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('not available');
  });
});
