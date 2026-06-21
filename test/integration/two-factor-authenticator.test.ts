import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, totpToken } from './helpers';

// The official Bitwarden 2FA-authenticator flow: get-authenticator (returns a
// key + user-verification token), enable it with a real TOTP token, then
// disable it. Real D1 + real TOTP, no mocks.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('tfauth');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

async function getAuthenticator(masterPasswordHash: string) {
  return api('POST', '/api/two-factor/get-authenticator', token, { masterPasswordHash });
}

describe('two-factor authenticator setup', () => {
  it('rejects get-authenticator with a missing or wrong master password', async () => {
    expect((await getAuthenticator('')).status).toBe(400);
    expect((await getAuthenticator('wrong')).status).toBe(400);
  });

  it('returns a key and user-verification token for the correct password', async () => {
    const res = await getAuthenticator(mph);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.Key).toBe('string');
    expect(typeof body.UserVerificationToken).toBe('string');
    expect(body.Enabled).toBe(false);
  });

  it('requires key, token, and userVerificationToken to enable', async () => {
    const res = await api('PUT', '/api/two-factor/authenticator', token, { key: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects enabling with an invalid user-verification token', async () => {
    const { Key } = (await (await getAuthenticator(mph)).json()) as any;
    const res = await api('PUT', '/api/two-factor/authenticator', token, {
      key: Key, token: await totpToken(Key), userVerificationToken: 'forged-token',
    });
    expect(res.status).toBe(400);
  });

  it('enables TOTP with a real token, then disables it', async () => {
    const { Key, UserVerificationToken } = (await (await getAuthenticator(mph)).json()) as any;

    const enable = await api('PUT', '/api/two-factor/authenticator', token, {
      key: Key, token: await totpToken(Key), userVerificationToken: UserVerificationToken,
    });
    expect(enable.status).toBe(200);
    expect(((await enable.json()) as any).Enabled).toBe(true);

    // Disabling an unsupported provider type is refused.
    const badType = await api('PUT', '/api/two-factor/disable', token, { type: 6, masterPasswordHash: mph });
    expect(badType.status).toBe(400);

    // Disable the authenticator via the master password.
    const disable = await api('PUT', '/api/two-factor/disable', token, {
      type: 0, masterPasswordHash: mph,
    });
    expect(disable.status).toBe(200);
    expect(((await disable.json()) as any).Enabled).toBe(false);
  });
});
