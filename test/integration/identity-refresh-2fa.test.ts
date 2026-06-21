import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, sync, totpToken, url } from './helpers';

// Identity token endpoint: the refresh_token grant and the 2FA remember-device
// (trusted device token) path of the password grant. Complements the TOTP
// challenge lifecycle suite.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('idrefresh');
  token = session.accessToken;
});

function tokenRequest(fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams(fields).toString(),
  });
}

function passwordLogin(extra: Record<string, string> = {}): Promise<Response> {
  return tokenRequest({
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
}

describe('refresh_token grant', () => {
  it('exchanges a refresh token for a fresh, usable access token', async () => {
    const refreshToken = session.refreshToken;
    const res = await tokenRequest({ grant_type: 'refresh_token', client_id: 'web', refresh_token: refreshToken });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.access_token).toBe('string');

    // The freshly minted access token authenticates a sync.
    const synced = await sync(body.access_token);
    expect(synced.status).toBe(200);
  });

  it('rejects a missing refresh token (invalid_request 400)', async () => {
    const res = await tokenRequest({ grant_type: 'refresh_token', client_id: 'web' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_request');
  });

  it('rejects an invalid refresh token (invalid_grant 400)', async () => {
    const res = await tokenRequest({ grant_type: 'refresh_token', client_id: 'web', refresh_token: `nope-${crypto.randomUUID()}` });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_grant');
  });
});

describe('password grant — 2FA remember device', () => {
  let secret: string;

  it('enables TOTP for the account', async () => {
    const setup = (await (await api('POST', '/api/two-factor/get-authenticator', token, {
      secret: session.account.masterPasswordHash,
      masterPasswordHash: session.account.masterPasswordHash,
    })).json()) as any;
    secret = setup.Key;

    const enable = await api('PUT', '/api/two-factor/authenticator', token, {
      key: secret,
      token: await totpToken(secret),
      userVerificationToken: setup.UserVerificationToken,
    });
    expect(enable.status).toBe(200);
  });

  it('issues a remember token and accepts it on a later login from the same device', async () => {
    // Authenticator login with remember=true returns a trusted-device token.
    const first = await passwordLogin({
      twoFactorProvider: '0',
      twoFactorToken: await totpToken(secret),
      twoFactorRemember: '1',
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as any;
    expect(typeof firstBody.access_token).toBe('string');
    const rememberToken = firstBody.TwoFactorToken as string;
    expect(typeof rememberToken).toBe('string');

    // Re-login using the remember provider (5) + that token, no TOTP needed.
    const second = await passwordLogin({ twoFactorProvider: '5', twoFactorToken: rememberToken });
    expect(second.status).toBe(200);
    expect(typeof ((await second.json()) as any).access_token).toBe('string');
  });

  it('falls back to a 2FA challenge when the remember token is invalid', async () => {
    const res = await passwordLogin({ twoFactorProvider: '5', twoFactorToken: `bogus-${crypto.randomUUID()}` });
    const body = (await res.json()) as any;
    // No access token; the response is the 2FA-required challenge.
    expect(body.access_token).toBeUndefined();
    expect(body.TwoFactorProviders ?? body.error).toBeTruthy();
  });
});
