import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, url } from './helpers';

// Repeated wrong-password logins for a real account trip the per-IP login
// lockout: the password grant then returns the "account locked" response built
// by recordFailedLoginAndBuildResponse. Real D1-backed lockout, no mocks.
let session: Session;

beforeAll(async () => {
  session = await authenticate('pwlockout');
});

describe('password grant lockout', () => {
  it('returns the account-locked response after repeated wrong passwords', async () => {
    const ip = '198.51.112.1';
    let last: Response | null = null;
    let body = '';
    // The login lockout trips after the configured attempt budget (10).
    for (let i = 0; i < 12; i++) {
      last = await SELF.fetch(url('/identity/connect/token'), {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: session.account.email,
          password: 'wrong-password',
          scope: 'api offline_access',
          client_id: 'web',
          deviceType: '10',
          deviceIdentifier: crypto.randomUUID(),
          deviceName: 't',
        }).toString(),
      });
      body = (await last.clone().text()).toLowerCase();
    }
    expect(body).toContain('too many failed login attempts');
  });
});
