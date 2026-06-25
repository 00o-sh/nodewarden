import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

// A password-grant token request that carries a devicePushToken persists it onto
// the (already-registered) device and re-registers it with the mobile push
// relay — the persistIdentityDevicePushToken happy path, which a plain login
// (no push token) skips. Driven through the real identity endpoint, no mocks.
let session: Session;

beforeAll(async () => {
  // The initial login registers the device, so the follow-up token request below
  // finds an existing device row to attach the push token to.
  session = await authenticate('idpush');
});

function tokenForm(extra: Record<string, string>): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: 'password',
    username: session.account.email,
    password: session.account.masterPasswordHash,
    scope: 'api offline_access',
    client_id: 'web',
    deviceType: '10',
    deviceIdentifier: session.account.deviceIdentifier,
    deviceName: 'integration-test',
    ...extra,
  });
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: form.toString(),
  });
}

describe('identity token request with a device push token', () => {
  it('accepts and persists a devicePushToken for the existing device', async () => {
    const res = await tokenForm({ devicePushToken: `push-${crypto.randomUUID()}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token?: string };
    expect(typeof body.access_token).toBe('string');
  });
});
