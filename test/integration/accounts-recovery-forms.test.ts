import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, randomBase32, totpToken, url } from './helpers';

// Form-encoded body variants and the per-IP lockout of the account recovery
// endpoints (the JSON paths are covered elsewhere). Real D1 + real TOTP, no
// mocks.
let session: Session;
let token: string;
let mph: string;
let recoveryCode: string;

beforeAll(async () => {
  session = await authenticate('recforms');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
  const secret = randomBase32();
  const enable = await api('POST', '/api/accounts/totp', token, { enabled: true, secret, token: await totpToken(secret) });
  expect(enable.status).toBe(200);
  recoveryCode = ((await enable.json()) as any).recoveryCode;
});

function form(path: string, fields: Record<string, string>, ip = '198.51.100.200', auth = false): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip };
  if (auth) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(url(path), { method: 'POST', headers: baseHeaders(headers), body: new URLSearchParams(fields).toString() });
}

describe('form-encoded recovery endpoints', () => {
  it('serves the TOTP recovery code from a form-encoded request', async () => {
    const res = await form('/api/accounts/totp/recovery-code', { masterPasswordHash: mph }, '198.51.100.201', true);
    expect(res.status).toBe(200);
    expect((await res.json() as any).code).toBe(recoveryCode);
  });

  it('accepts a form-encoded recover-2fa request', async () => {
    // Wrong code via the form path -> 400 (exercises the form-body branch).
    const res = await form('/api/accounts/recover-2fa', {
      email: session.account.email, masterPasswordHash: mph, recoveryCode: 'wrong-code',
    }, '198.51.100.202');
    expect(res.status).toBe(400);
  });
});

describe('recover-2fa per-IP lockout', () => {
  it('locks out after repeated failed attempts from one IP (429)', async () => {
    const ip = '198.51.100.250';
    let status = 0;
    for (let i = 0; i < 12; i += 1) {
      status = (await form('/api/accounts/recover-2fa', {
        email: session.account.email, masterPasswordHash: mph, recoveryCode: 'still-wrong',
      }, ip)).status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
  });
});
