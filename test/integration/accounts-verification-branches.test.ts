import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';
import { SELF } from 'cloudflare:test';

// Password-verification and validation branches of several account endpoints,
// exercised through the real authenticated API with genuinely-invalid inputs.
let session: Session;
let token: string;
let goodHash: string;
let ipCounter = 40;

function rawAuthed(method: string, path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body,
  });
}

function rawPublic(path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `198.51.106.${ipCounter++}`, Origin: 'https://vault.test', 'Content-Type': 'application/json' },
    body,
  });
}

beforeAll(async () => {
  session = await authenticate('accountsverify');
  token = session.accessToken;
  goodHash = session.account.masterPasswordHash;
});

describe('handleVerifyPassword branches', () => {
  it('400s malformed JSON', async () => {
    expect((await rawAuthed('POST', '/api/accounts/verify-password', '{bad')).status).toBe(400);
  });
  it('400s a missing masterPasswordHash', async () => {
    expect((await api('POST', '/api/accounts/verify-password', token, {})).status).toBe(400);
  });
  it('400s a wrong password', async () => {
    expect((await api('POST', '/api/accounts/verify-password', token, { masterPasswordHash: 'wrong' })).status).toBe(400);
  });
  it('200s the correct password', async () => {
    expect((await api('POST', '/api/accounts/verify-password', token, { masterPasswordHash: goodHash })).status).toBe(200);
  });
});

describe('handleGetTotpRecoveryCode branches', () => {
  it('400s malformed JSON', async () => {
    expect((await rawAuthed('POST', '/api/accounts/totp/recovery-code', '{bad')).status).toBe(400);
  });
  it('400s a missing masterPasswordHash', async () => {
    expect((await api('POST', '/api/accounts/totp/recovery-code', token, {})).status).toBe(400);
  });
  it('400s a wrong password', async () => {
    expect((await api('POST', '/api/accounts/totp/recovery-code', token, { masterPasswordHash: 'wrong' })).status).toBe(400);
  });
});

describe('account api-key branches', () => {
  it('400s malformed JSON', async () => {
    expect((await rawAuthed('POST', '/api/accounts/api-key', '{bad')).status).toBe(400);
  });
  it('400s a missing masterPasswordHash', async () => {
    expect((await api('POST', '/api/accounts/api-key', token, {})).status).toBe(400);
  });
  it('400s a wrong password', async () => {
    expect((await api('POST', '/api/accounts/api-key', token, { masterPasswordHash: 'wrong' })).status).toBe(400);
  });
});

describe('handleRecoverTwoFactor branches', () => {
  it('400s malformed JSON', async () => {
    expect((await rawPublic('/identity/accounts/recover-2fa', '{bad')).status).toBe(400);
  });
  it('400s missing required fields', async () => {
    expect((await rawPublic('/identity/accounts/recover-2fa', JSON.stringify({ email: 'a@b.test' }))).status).toBe(400);
  });
  it('400s invalid credentials', async () => {
    const res = await rawPublic('/identity/accounts/recover-2fa', JSON.stringify({
      email: 'nobody@vault.test', masterPasswordHash: 'wrong', recoveryCode: 'ABCD1234',
    }));
    expect(res.status).toBe(400);
  });
});
