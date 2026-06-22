import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { url } from './helpers';

// The same-origin write guard (isSameOriginWriteRequest) and the public read
// endpoints. Origin/Referer are set explicitly (bypassing the default-Origin
// helper) to exercise the CSRF-style checks. Real worker routing, no mocks.
const TARGET = 'https://vault.test';

let ip = 0;
function post(path: string, headers: Record<string, string>): Promise<Response> {
  ip += 1;
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.102.${ip}`, ...headers },
    body: JSON.stringify({ email: 'someone@example.com' }),
  });
}

function get(path: string): Promise<Response> {
  ip += 1;
  return SELF.fetch(url(path), { headers: { 'CF-Connecting-IP': `198.51.103.${ip}` } });
}

describe('same-origin write guard', () => {
  it('403s a password-hint request from a foreign origin', async () => {
    expect((await post('/api/accounts/password-hint', { Origin: 'https://evil.example' })).status).toBe(403);
  });

  it('403s a register request from a foreign origin', async () => {
    expect((await post('/api/accounts/register', { Origin: 'https://evil.example' })).status).toBe(403);
  });

  it('allows a request whose Referer matches (no Origin header)', async () => {
    const res = await post('/api/accounts/password-hint', { Referer: `${TARGET}/#/login` });
    expect(res.status).not.toBe(403);
  });

  it('403s a request with an unparseable Referer and no Origin', async () => {
    expect((await post('/api/accounts/password-hint', { Referer: 'not a url' })).status).toBe(403);
  });

  it('403s a request with neither Origin nor Referer', async () => {
    expect((await post('/api/accounts/password-hint', {})).status).toBe(403);
  });
});

describe('public read endpoints', () => {
  it('serves /config', async () => {
    const res = await get('/config');
    expect(res.status).toBe(200);
  });

  it('serves /api/version', async () => {
    expect((await get('/api/version')).status).toBe(200);
  });

  it('serves webauthn assertion options', async () => {
    const res = await get('/identity/accounts/webauthn/assertion-options');
    expect(res.status).toBe(200);
  });
});
