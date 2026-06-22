import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// The public send-file upload endpoint rejects an invalid upload token (401).
// Real JWT verification, no mocks.
describe('public send file upload guard', () => {
  it('401s an upload with an invalid token', async () => {
    const res = await SELF.fetch(url(`/api/sends/${crypto.randomUUID()}/file/${crypto.randomUUID()}?token=not-valid`), {
      method: 'POST',
      headers: baseHeaders({}),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(401);
  });
});
