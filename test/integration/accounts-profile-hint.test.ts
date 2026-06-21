import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Profile master-password-hint update, the public password-hint lookup, the
// two-factor providers listing, and verify-password — handlers and branches the
// existing accounts suites don't reach.
let session: Session;
let token: string;
let mph: string;

beforeAll(async () => {
  session = await authenticate('acctprofile');
  token = session.accessToken;
  mph = session.account.masterPasswordHash;
});

// The password-hint endpoint is rate-limited to 1/min per IP, so each lookup
// uses a distinct client IP to stay independent.
function passwordHint(body: unknown, ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`): Promise<Response> {
  return SELF.fetch(url('/api/accounts/password-hint'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }),
    body: JSON.stringify(body),
  });
}

describe('profile + password hint', () => {
  it('lists the enabled two-factor providers', async () => {
    const res = await api('GET', '/api/two-factor', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data ?? body.Data ?? [])).toBe(true);
  });

  it('sets a master password hint and serves it back via the public lookup', async () => {
    const hint = 'my-recovery-hint';
    const update = await api('PUT', '/api/accounts/profile', token, { masterPasswordHint: hint });
    expect(update.status).toBe(200);

    const res = await passwordHint({ email: session.account.email });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.hasHint).toBe(true);
    expect(body.masterPasswordHint).toBe(hint);
  });

  it('does not reveal a hint for an unknown email (no enumeration)', async () => {
    const res = await passwordHint({ email: `ghost-${crypto.randomUUID()}@vault.test` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.hasHint).toBe(false);
    expect(body.masterPasswordHint).toBeNull();
  });

  it('rejects a password-hint request without an email (400)', async () => {
    expect((await passwordHint({})).status).toBe(400);
  });

  it('rejects an over-long master password hint (400)', async () => {
    const res = await api('PUT', '/api/accounts/profile', token, { masterPasswordHint: 'x'.repeat(121) });
    expect(res.status).toBe(400);
  });
});

describe('verify-password', () => {
  it('accepts the correct master password hash', async () => {
    const res = await api('POST', '/api/accounts/verify-password', token, { masterPasswordHash: mph });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong hash (400) and a missing hash (400)', async () => {
    expect((await api('POST', '/api/accounts/verify-password', token, { masterPasswordHash: btoa('wrong') })).status).toBe(400);
    expect((await api('POST', '/api/accounts/verify-password', token, {})).status).toBe(400);
  });
});
