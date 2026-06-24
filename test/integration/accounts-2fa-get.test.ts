import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, randomBase32, totpToken } from './helpers';

// The read-side two-factor endpoints: TOTP status, provider list (before and
// after enabling), and the get-authenticator key/verification-token issuance
// (success and failed verification). Real D1 + real TOTP, no mocks.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('twofactorget');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

describe('two-factor read endpoints', () => {
  it('reports TOTP disabled before setup', async () => {
    const res = await api('GET', '/api/accounts/totp', token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).enabled).toBe(false);
  });

  it('lists no providers before setup', async () => {
    const res = await api('GET', '/api/two-factor', token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).Data).toEqual([]);
  });

  it('rejects get-authenticator with a wrong secret', async () => {
    const res = await api('POST', '/api/two-factor/get-authenticator', token, { masterPasswordHash: 'wrong' });
    expect(res.status).toBe(400);
  });

  it('issues an authenticator key with a correct secret', async () => {
    const res = await api('POST', '/api/two-factor/get-authenticator', token, { masterPasswordHash: mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.Key).toBe('string');
    expect(typeof body.UserVerificationToken).toBe('string');
  });

  it('lists the authenticator provider once TOTP is enabled', async () => {
    const secret = randomBase32();
    expect((await api('POST', '/api/accounts/totp', token, { enabled: true, secret, token: await totpToken(secret), masterPasswordHash: mph })).status).toBe(200);
    const res = await api('GET', '/api/two-factor', token);
    expect(res.status).toBe(200);
    const data = ((await res.json()) as any).Data;
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].Object).toBe('twoFactorProvider');
  });
});
