import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, totpToken, url } from './helpers';

// TOTP login replay protection: a one-time code that has already been accepted
// at login must not be accepted a second time within its validity window. The
// matched time-counter is atomically consumed, so a captured-and-replayed code
// fails. Real D1 + real TOTP, no mocks.
let session: Session;
let token: string;
let secret: string;

function loginWith(twoFactorToken: string): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({
      grant_type: 'password',
      username: session.account.email,
      password: session.account.masterPasswordHash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: session.account.deviceIdentifier,
      deviceName: 'integration-test',
      twoFactorProvider: '0',
      twoFactorToken,
    }).toString(),
  });
}

beforeAll(async () => {
  session = await authenticate('totp-replay');
  token = session.accessToken;

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

describe('TOTP login replay protection', () => {
  it('accepts a fresh TOTP code once and rejects the same code on replay', async () => {
    // One fixed code, used twice. The first login consumes its time-counter.
    const code = await totpToken(secret);

    const first = await loginWith(code);
    expect(first.status).toBe(200);
    expect(typeof ((await first.json()) as any).access_token).toBe('string');

    // Replaying the identical code must not issue another access token.
    const replay = await loginWith(code);
    const replayBody = (await replay.json()) as any;
    expect(replayBody.access_token).toBeUndefined();
  });

  it('still accepts a subsequent distinct code (protection is per-code, not a lockout)', async () => {
    // Advance one time step so a genuinely different code is produced.
    const future = Date.now() + 30_000;
    const ok = await loginWith(await totpToken(secret, future));
    expect(ok.status).toBe(200);
    expect(typeof ((await ok.json()) as any).access_token).toBe('string');
  });
});
