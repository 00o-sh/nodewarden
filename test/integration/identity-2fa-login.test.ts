import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, randomBase32, totpToken, url } from './helpers';

// With TOTP enabled, the password grant requires a second factor. Cover the
// recovery-code and unsupported-provider rejection branches: each records a
// failed 2FA attempt and returns "Two-step token is invalid". Real TOTP + D1.
let session: Session;
let totpSecret: string;

function login2fa(provider: string, twoFactorToken: string, ip: string): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: session.account.email,
      password: session.account.masterPasswordHash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: crypto.randomUUID(),
      deviceName: 't',
      twoFactorProvider: provider,
      twoFactorToken,
    }).toString(),
  });
}

beforeAll(async () => {
  session = await authenticate('twofalogin');
  // Enable TOTP with a real current code.
  totpSecret = randomBase32();
  const code = await totpToken(totpSecret);
  const res = await api('POST', '/api/accounts/totp', session.accessToken, {
    enabled: true, secret: totpSecret, token: code, masterPasswordHash: session.account.masterPasswordHash,
  });
  expect(res.status).toBe(200);
});

describe('two-factor login rejection branches', () => {
  it('rejects a wrong recovery code', async () => {
    const res = await login2fa('8', 'not-the-recovery-code', '198.51.113.1');
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('two-step token is invalid');
  });

  it('rejects an unsupported 2FA provider', async () => {
    const res = await login2fa('99', 'whatever', '198.51.113.2');
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('two-step token is invalid');
  });

  it('completes login with a valid authenticator code', async () => {
    const code = await totpToken(totpSecret);
    const res = await login2fa('0', code, '198.51.113.3');
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as any).access_token).toBe('string');
  });
});
