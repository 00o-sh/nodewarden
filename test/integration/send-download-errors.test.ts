import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// Token validation on the public send-file download endpoint.
describe('send file download token errors', () => {
  it('rejects a download with no token (401)', async () => {
    const res = await SELF.fetch(url(`/api/sends/${crypto.randomUUID()}/${crypto.randomUUID()}`), {
      headers: baseHeaders(),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a download with an invalid token (401)', async () => {
    const res = await SELF.fetch(
      url(`/api/sends/${crypto.randomUUID()}/${crypto.randomUUID()}?t=not-a-jwt`),
      { headers: baseHeaders() }
    );
    expect(res.status).toBe(401);
  });
});
