import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// The bearer-token auth guards of the V2 send-access endpoints
// (POST /api/sends/access and /api/sends/access/file/:fileId): a missing token
// and an invalid token both return 401. These public endpoints take the send
// access token as a bearer credential. Real JWT verification, no mocks.
function post(path: string, bearer?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return SELF.fetch(url(path), { method: 'POST', headers: baseHeaders(headers), body: '{}' });
}

describe('V2 send access auth guards', () => {
  it('401s POST /api/sends/access without a token', async () => {
    expect((await post('/api/sends/access')).status).toBe(401);
  });

  it('401s POST /api/sends/access with an invalid token', async () => {
    expect((await post('/api/sends/access', 'not-a-valid-token')).status).toBe(401);
  });

  it('401s POST /api/sends/access/file/:id without a token', async () => {
    expect((await post(`/api/sends/access/file/${crypto.randomUUID()}`)).status).toBe(401);
  });

  it('401s POST /api/sends/access/file/:id with an invalid token', async () => {
    expect((await post(`/api/sends/access/file/${crypto.randomUUID()}`, 'not-a-valid-token')).status).toBe(401);
  });
});
