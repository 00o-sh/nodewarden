import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, TestAccount, api, authenticate, baseHeaders, randomBase32, sync, totpToken, url } from './helpers';

// Identity session-revocation and a two-factor login edge:
//   - POST /identity/connect/revocation with a presented access token revokes
//     the underlying session. Exercises revokePresentedAccessTokenSession for
//     both a device-scoped token (has `did`) and a device-less token.
//   - the remember-device (provider 5) branch when no device identifier is
//     supplied falls back to the 2FA challenge.
// Real worker + D1, no mocks.
let session: Session;

beforeAll(async () => {
  session = await authenticate('idrevoke');
});

function revoke(accessToken: string | null, refreshToken: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return SELF.fetch(url('/identity/connect/revocation'), {
    method: 'POST',
    headers: baseHeaders(headers),
    body: new URLSearchParams({ token: refreshToken }).toString(),
  });
}

function loginForm(account: TestAccount, extra: Record<string, string> = {}, includeDevice = true): Promise<Response> {
  const fields: Record<string, string> = {
    grant_type: 'password',
    username: account.email,
    password: account.masterPasswordHash,
    scope: 'api offline_access',
    client_id: 'web',
    deviceType: '10',
    deviceName: 'integration-test',
    ...extra,
  };
  if (includeDevice) fields.deviceIdentifier = account.deviceIdentifier;
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams(fields).toString(),
  });
}

describe('presented-token session revocation', () => {
  it('revokes the device-scoped session behind a presented access token', async () => {
    // A fresh login gives a device-scoped access token (carries `did`).
    const login = (await (await loginForm(session.account)).json()) as any;
    expect(typeof login.access_token).toBe('string');

    // The access token authenticates a sync before revocation.
    expect((await sync(login.access_token)).status).toBe(200);

    const res = await revoke(login.access_token, login.refresh_token);
    expect(res.status).toBe(200);

    // The device session stamp was rotated: the presented access token no
    // longer authenticates.
    expect((await sync(login.access_token)).status).toBe(401);

    // The device's refresh token was deleted: it can no longer mint tokens.
    const refresh = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'web', refresh_token: login.refresh_token }).toString(),
    });
    expect(refresh.status).toBe(400);
    expect(((await refresh.json()) as any).error).toBe('invalid_grant');
  });

  it('revokes the user session behind a device-less presented access token', async () => {
    // Logging in without a device identifier yields a token with no `did`, so
    // revocation rotates the user security stamp instead of a device stamp.
    const login = (await (await loginForm(session.account, {}, false)).json()) as any;
    expect(typeof login.access_token).toBe('string');
    expect((await sync(login.access_token)).status).toBe(200);

    const res = await revoke(login.access_token, login.refresh_token);
    expect(res.status).toBe(200);

    // Security stamp rotation invalidates the presented access token.
    expect((await sync(login.access_token)).status).toBe(401);
  });
});

describe('remember-device provider without a device identifier', () => {
  it('falls back to the 2FA challenge when no device identifier accompanies provider 5', async () => {
    // A fresh login (prior revocation tests rotated the original stamp).
    const freshToken = ((await (await loginForm(session.account)).json()) as any).access_token as string;
    expect(typeof freshToken).toBe('string');

    // Enable TOTP so the account requires a second factor at login.
    const secret = randomBase32();
    const enable = await api('PUT', '/api/accounts/totp', freshToken, {
      enabled: true,
      secret,
      token: await totpToken(secret),
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(enable.status).toBe(200);

    // Provider 5 (remember) with a token but NO device identifier cannot match a
    // trusted device, so the login re-enters the 2FA challenge (no access token).
    const res = await loginForm(session.account, { twoFactorProvider: '5', twoFactorToken: 'no-device-token' }, false);
    const body = (await res.json()) as any;
    expect(body.access_token).toBeUndefined();
    expect(body.TwoFactorProviders).toBeTruthy();
  });
});
