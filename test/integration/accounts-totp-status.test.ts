import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, randomBase32, totpToken } from './helpers';

// The /api/accounts/totp enable/disable path (distinct from the
// /api/two-factor/authenticator ceremony).
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('totpstatus');
  token = session.accessToken;
});

describe('TOTP enable/disable via accounts/totp', () => {
  it('enables TOTP with a valid secret + token and returns a recovery code', async () => {
    const secret = randomBase32();
    const res = await api('PUT', '/api/accounts/totp', token, {
      enabled: true,
      secret,
      token: await totpToken(secret),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.enabled).toBe(true);
    expect(typeof body.recoveryCode).toBe('string');

    expect(((await (await api('GET', '/api/accounts/totp', token)).json()) as any).enabled).toBe(true);
  });

  it('rejects enabling with a wrong token (400)', async () => {
    const res = await api('PUT', '/api/accounts/totp', token, {
      enabled: true,
      secret: randomBase32(),
      token: '000000',
    });
    expect(res.status).toBe(400);
  });

  it('disables TOTP with the master password', async () => {
    const res = await api('PUT', '/api/accounts/totp', token, {
      enabled: false,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(200);
    expect(((await (await api('GET', '/api/accounts/totp', token)).json()) as any).enabled).toBe(false);
  });

  it('rejects disabling with a wrong password (400)', async () => {
    // Re-enable first so there is something to disable.
    const secret = randomBase32();
    await api('PUT', '/api/accounts/totp', token, { enabled: true, secret, token: await totpToken(secret) });

    const res = await api('PUT', '/api/accounts/totp', token, { enabled: false, masterPasswordHash: 'wrong' });
    expect(res.status).toBe(400);
  });
});
