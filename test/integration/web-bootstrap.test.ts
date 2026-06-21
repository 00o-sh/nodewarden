import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, newAccount, register, url } from './helpers';

// The web vault reads `registrationInviteRequired` from /api/web-bootstrap to
// decide whether to surface the "Create account" button on the login screen:
// it is shown only during first-run setup (no users yet) and hidden once an
// admin exists, because every subsequent registration requires an invite code.
// Each integration test file runs against its own fresh D1, so the instance
// below starts with zero users.
async function getBootstrap(): Promise<{ registrationInviteRequired: boolean }> {
  const res = await SELF.fetch(url('/api/web-bootstrap'), {
    method: 'GET',
    headers: baseHeaders(),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { registrationInviteRequired: boolean };
}

describe('GET /api/web-bootstrap registrationInviteRequired', () => {
  it('reports invite not required before the first user registers', async () => {
    const boot = await getBootstrap();
    expect(boot.registrationInviteRequired).toBe(false);
  });

  it('reports invite required once the first admin exists', async () => {
    const reg = await register(newAccount('admin'));
    expect(reg.status).toBe(200);

    const boot = await getBootstrap();
    expect(boot.registrationInviteRequired).toBe(true);
  });
});
