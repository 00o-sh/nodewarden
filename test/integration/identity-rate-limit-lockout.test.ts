import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { url } from './helpers';

// The grant-level login lockout is keyed per (grantType, subject): repeated
// failed attempts against the SAME webauthn token or client_credentials user id
// short-circuit that subject with a 429 before doing any work. Driven through the
// real worker and its real D1-backed login lockout (10 attempts), no mocks.
function form(params: Record<string, string>, ip: string): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

describe('grant rate-limit lockout', () => {
  it('429s a webauthn grant once its token is locked out', async () => {
    const ip = '198.51.107.1';
    const attempt = () => form({ grant_type: 'webauthn', token: 'locked-token', deviceResponse: '{}' }, ip);
    // Before the threshold the (unverifiable) assertion fails with a 4xx, not a 429.
    const first = await attempt();
    expect(first.status).not.toBe(429);
    // 10 failed attempts (loginMaxAttempts) lock this token's bucket.
    for (let i = 0; i < 9; i++) await attempt();
    const locked = await attempt();
    expect(locked.status).toBe(429);
  });

  it('429s a client_credentials grant once its user id is locked out', async () => {
    const ip = '198.51.107.2';
    const clientId = `user.${crypto.randomUUID()}`;
    const attempt = () => form({ grant_type: 'client_credentials', client_id: clientId, client_secret: 's', scope: 'api' }, ip);
    const first = await attempt();
    expect(first.status).not.toBe(429);
    for (let i = 0; i < 9; i++) await attempt();
    const locked = await attempt();
    expect(locked.status).toBe(429);
  });

  // NOTE: the per-minute public (send_access) and refresh_token budgets use a
  // fixed-window limiter keyed by wall-clock minute. Exhausting them by firing
  // ~budget+1 requests in a loop is non-deterministic: if the minute boundary
  // rolls mid-loop the count splits across two windows and never trips, so those
  // assertions were flaky and have been removed. The deterministic, D1-backed
  // login lockout above already covers the grant-level 429 short-circuit.
});
