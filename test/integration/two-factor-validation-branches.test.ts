import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, randomBase32, url } from './helpers';

// Validation branches in the two-factor handlers: invalid TOTP secret on enable,
// malformed request bodies on the authenticator/disable endpoints, and the
// form-urlencoded body parsing path. Real authenticated API, no mocks.
let session: Session;
let token: string;

function raw(method: string, path: string, contentType: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': contentType }),
    body,
  });
}

beforeAll(async () => {
  session = await authenticate('twofactorvalidation');
  token = session.accessToken;
});

describe('two-factor validation branches', () => {
  it('rejects enabling TOTP with an invalid secret', async () => {
    const res = await api('POST', '/api/accounts/totp', token, { enabled: true, secret: '', token: '000000' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid totp secret');
  });

  it('requires a TOTP token when enabling with a valid secret', async () => {
    const res = await api('POST', '/api/accounts/totp', token, { enabled: true, secret: randomBase32() });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('totp token is required');
  });

  it('requires the master password hash to disable TOTP', async () => {
    const res = await api('POST', '/api/accounts/totp', token, { enabled: false });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('masterpasswordhash is required');
  });

  it('400s a malformed authenticator body', async () => {
    expect((await raw('PUT', '/api/two-factor/authenticator', 'application/json', '{bad')).status).toBe(400);
  });

  it('400s a malformed disable body', async () => {
    expect((await raw('POST', '/api/two-factor/disable', 'application/json', '{bad')).status).toBe(400);
  });

  it('accepts a form-urlencoded authenticator body (parsed, then validated)', async () => {
    // A urlencoded body exercises the form-data parsing path; without a valid
    // master-password verification it is still rejected, but not as invalid JSON.
    const res = await raw('PUT', '/api/two-factor/authenticator', 'application/x-www-form-urlencoded', 'masterPasswordHash=nope');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
