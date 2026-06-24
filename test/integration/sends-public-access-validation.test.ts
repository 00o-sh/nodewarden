import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { url } from './helpers';

// Unauthenticated public send-access endpoints reject malformed access ids and
// missing/invalid bearer tokens. Driven through the real worker; no mocks.
let ipCounter = 20;
function post(path: string, opts: { auth?: string; body?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'CF-Connecting-IP': `198.51.104.${ipCounter++}`,
    Origin: 'https://vault.test',
    'Content-Type': 'application/json',
  };
  if (opts.auth) headers.Authorization = opts.auth;
  return SELF.fetch(url(path), { method: 'POST', headers, body: opts.body ?? '{}' });
}

function randomAccessId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('public send access validation', () => {
  it('404s an access id that is not a valid 16-byte identifier', async () => {
    expect((await post('/api/sends/access/short')).status).toBe(404);
  });

  it('404s a well-formed access id with no matching send', async () => {
    expect((await post(`/api/sends/access/${randomAccessId()}`)).status).toBe(404);
  });

  it('401s send access v2 with no bearer token', async () => {
    expect((await post('/api/sends/access')).status).toBe(401);
  });

  it('401s send access v2 with an invalid bearer token', async () => {
    expect((await post('/api/sends/access', { auth: 'Bearer not.a.valid.token' })).status).toBe(401);
  });

  it('401s send file access v2 with no bearer token', async () => {
    expect((await post(`/api/sends/access/file/${crypto.randomUUID()}`)).status).toBe(401);
  });

  it('401s send file access v2 with an invalid bearer token', async () => {
    expect((await post(`/api/sends/access/file/${crypto.randomUUID()}`, { auth: 'Bearer not.a.valid.token' })).status).toBe(401);
  });
});
