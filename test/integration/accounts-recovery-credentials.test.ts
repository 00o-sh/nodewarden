import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, randomBase32, totpToken, url } from './helpers';

// On-demand TOTP recovery-code generation, the recover-2fa success/failure
// paths, master-password verification, and the API-key create/rotate endpoints
// (including form-encoded bodies). Real D1 + real TOTP, no mocks.
//
// Ordering note: the access token is rejected once the user's securityStamp
// changes, so every session-authenticated case runs before rotate-api-key (the
// last session op) and the public recover-2fa cases.
let session: Session;
let token: string;
let email: string;
let mph: string;
let recoveryCode: string;

beforeAll(async () => {
  session = await authenticate('recoverycreds');
  token = session.accessToken;
  email = session.account.email;
  mph = session.account.masterPasswordHash;
});

// Unauthenticated POST with a controllable client IP (recover-2fa is rate
// limited per IP, so each case uses its own).
function pub(path: string, body: Record<string, unknown>, ip: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }),
    body: JSON.stringify(body),
  });
}

function form(path: string, fields: Record<string, string>): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` }),
    body: new URLSearchParams(fields).toString(),
  });
}

describe('account recovery and credentials', () => {
  it('generates a TOTP recovery code on demand for a user without TOTP', async () => {
    const res = await api('POST', '/api/accounts/totp/recovery-code', token, { masterPasswordHash: mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.code).toBe('string');
    expect(body.code.length).toBeGreaterThan(0);
  });

  it('rejects the recovery-code request with a wrong password', async () => {
    const res = await api('POST', '/api/accounts/totp/recovery-code', token, { masterPasswordHash: 'wrong-hash' });
    expect(res.status).toBe(400);
  });

  it('verifies the correct master password', async () => {
    expect((await api('POST', '/api/accounts/verify-password', token, { masterPasswordHash: mph })).status).toBe(200);
  });

  it('requires masterPasswordHash for verify-password', async () => {
    expect((await api('POST', '/api/accounts/verify-password', token, {})).status).toBe(400);
  });

  it('rejects a malformed verify-password body', async () => {
    const res = await SELF.fetch(url('/api/accounts/verify-password'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });

  it('creates an API key', async () => {
    const res = await api('POST', '/api/accounts/api-key', token, { masterPasswordHash: mph });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.apiKey).toBe('string');
    expect(body.apiKey.length).toBeGreaterThan(0);
  });

  it('accepts a form-encoded API-key request', async () => {
    const res = await form('/api/accounts/api-key', { masterPasswordHash: mph });
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as any).apiKey).toBe('string');
  });

  it('rejects an API-key request with a wrong password', async () => {
    expect((await api('POST', '/api/accounts/api-key', token, { masterPasswordHash: 'nope' })).status).toBe(400);
  });

  it('enables TOTP (issuing a fresh recovery code)', async () => {
    const secret = randomBase32();
    const res = await api('POST', '/api/accounts/totp', token, { enabled: true, secret, token: await totpToken(secret) });
    expect(res.status).toBe(200);
    recoveryCode = ((await res.json()) as any).recoveryCode;
    expect(typeof recoveryCode).toBe('string');
  });

  it('rotates the API key', async () => {
    const res = await api('POST', '/api/accounts/rotate-api-key', token, { masterPasswordHash: mph });
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as any).apiKey).toBe('string');
  });

  it('recovers 2FA with a valid recovery code', async () => {
    const res = await pub('/api/accounts/recover-2fa', { email, masterPasswordHash: mph, recoveryCode }, '198.51.100.71');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.twoFactorEnabled).toBe(false);
    expect(typeof body.newRecoveryCode).toBe('string');
  });

  it('rejects recover-2fa with a wrong password', async () => {
    const res = await pub('/api/accounts/recover-2fa', { email, masterPasswordHash: 'wrong', recoveryCode: 'irrelevant' }, '198.51.100.72');
    expect(res.status).toBe(400);
  });

  it('rejects recover-2fa for an unknown email', async () => {
    const res = await pub('/api/accounts/recover-2fa', { email: `nobody-${crypto.randomUUID()}@example.com`, masterPasswordHash: mph, recoveryCode: 'x' }, '198.51.100.73');
    expect(res.status).toBe(400);
  });
});
