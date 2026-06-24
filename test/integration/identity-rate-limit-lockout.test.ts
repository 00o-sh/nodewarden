import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { url } from './helpers';

// Once an IP is locked out by repeated failed password logins, the webauthn and
// client_credentials grants short-circuit with a 429 before doing any work.
// Driven through the real worker and its real D1-backed login lockout (10
// attempts), no mocks.
function form(params: Record<string, string>, ip: string): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

async function lockOut(ip: string): Promise<void> {
  // 10 failed password logins (loginMaxAttempts) lock the IP for the lockout window.
  for (let i = 0; i < 11; i++) {
    await form({ grant_type: 'password', username: `nobody-${i}@vault.test`, password: 'wrong', scope: 'api offline_access', client_id: 'web', deviceIdentifier: crypto.randomUUID(), deviceType: '10', deviceName: 't' }, ip);
  }
}

describe('grant rate-limit lockout', () => {
  it('429s a webauthn grant from a locked-out IP', async () => {
    const ip = '198.51.107.1';
    await lockOut(ip);
    const res = await form({ grant_type: 'webauthn', token: 'x', deviceResponse: '{}' }, ip);
    expect(res.status).toBe(429);
  });

  it('429s a client_credentials grant from a locked-out IP', async () => {
    const ip = '198.51.107.2';
    await lockOut(ip);
    const res = await form({ grant_type: 'client_credentials', client_id: `user.${crypto.randomUUID()}`, client_secret: 's', scope: 'api' }, ip);
    expect(res.status).toBe(429);
  });

  it('429s a send_access grant once the per-minute public budget is spent', async () => {
    const ip = '198.51.107.3';
    let last: Response | null = null;
    // publicRequestsPerMinute is 60; the 61st request trips the limiter. Each
    // call lacks send_id (400) until the budget is exhausted (429).
    for (let i = 0; i < 62; i++) {
      last = await form({ grant_type: 'send_access' }, ip);
    }
    expect(last!.status).toBe(429);
  });

  it('429s a refresh_token grant once the per-minute refresh budget is spent', async () => {
    const ip = '198.51.107.4';
    let last: Response | null = null;
    // refreshTokenRequestsPerMinute is 30; the 31st request trips the limiter.
    for (let i = 0; i < 32; i++) {
      last = await form({ grant_type: 'refresh_token', refresh_token: 'invalid' }, ip);
    }
    expect(last!.status).toBe(429);
  });
});
