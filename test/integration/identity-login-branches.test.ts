import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, TestAccount, api, authenticate, baseHeaders, login, newAccount, randomBase32, register, totpToken, url } from './helpers';

// Password-grant login branches: missing credentials, a disabled account, the
// recovery-code 2FA path at login, and the per-account failed-login lockout.
let admin: Session;
let adminToken: string;

beforeAll(async () => {
  admin = await authenticate('idlogin');
  adminToken = admin.accessToken;
});

async function makeUser(label: string): Promise<{ account: TestAccount; token: string; id: string }> {
  const invite = (await (await api('POST', '/api/admin/invites', adminToken, {})).json()) as any;
  const account = newAccount(label);
  expect((await register(account, invite.code)).status).toBe(200);
  const token = ((await (await login(account)).json()) as any).access_token;
  const profile = (await (await api('GET', '/api/accounts/profile', token)).json()) as any;
  return { account, token, id: profile.id ?? profile.Id };
}

function loginForm(account: TestAccount, extra: Record<string, string> = {}, ip = '203.0.113.7'): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip }),
    body: new URLSearchParams({
      grant_type: 'password',
      username: account.email,
      password: account.masterPasswordHash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: account.deviceIdentifier,
      deviceName: 'integration-test',
      ...extra,
    }).toString(),
  });
}

describe('password grant — login branches', () => {
  it('rejects a login missing email/password (invalid_request)', async () => {
    const res = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ grant_type: 'password', client_id: 'web', scope: 'api offline_access' }).toString(),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_request');
  });

  it('rejects login for a disabled (banned) account', async () => {
    const { account, id } = await makeUser('idlogin-banned');
    expect((await api('PUT', `/api/admin/users/${id}/status`, adminToken, { status: 'banned' })).status).toBe(200);

    const res = await loginForm(account);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json()).toLowerCase()).toContain('disabled');
  });

  it('accepts a recovery code as the 2FA at login and disables TOTP', async () => {
    const { account, token } = await makeUser('idlogin-recovery');

    // Enable TOTP; the response hands back the recovery code.
    const secret = randomBase32();
    const enable = await api('POST', '/api/accounts/totp', token, {
      enabled: true, secret, token: await totpToken(secret),
    });
    expect(enable.status).toBe(200);
    const recoveryCode = ((await enable.json()) as any).recoveryCode as string;
    expect(typeof recoveryCode).toBe('string');

    // A plain login is now challenged.
    expect(((await (await loginForm(account)).json()) as any).access_token).toBeUndefined();

    // Recovery code (provider 8) satisfies the challenge and disables TOTP.
    const recovered = await loginForm(account, { twoFactorProvider: '8', twoFactorToken: recoveryCode });
    expect(recovered.status).toBe(200);
    expect(typeof ((await recovered.json()) as any).access_token).toBe('string');

    // TOTP is now off: a plain login issues a token again.
    expect(typeof ((await (await loginForm(account)).json()) as any).access_token).toBe('string');
  });

  it('locks the account after repeated failed logins (429)', async () => {
    const { account } = await makeUser('idlogin-lockout');
    const ip = '198.51.100.77';
    const wrong = { ...account, masterPasswordHash: btoa('definitely-wrong') } as TestAccount;

    let status = 0;
    for (let i = 0; i < 10; i++) {
      status = (await loginForm(wrong, {}, ip)).status;
    }
    expect(status).toBe(429);
    // Even the correct password is refused while locked.
    expect((await loginForm(account, {}, ip)).status).toBe(429);
  });
});
