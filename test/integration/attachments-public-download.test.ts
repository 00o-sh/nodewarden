import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// The public attachment download endpoint's token guards: a missing token and
// an invalid token both return 401. Real JWT verification, no mocks.
function get(path: string): Promise<Response> {
  return SELF.fetch(url(path), { headers: baseHeaders({}) });
}

describe('public attachment download guards', () => {
  it('401s without a token', async () => {
    expect((await get(`/api/attachments/${crypto.randomUUID()}/${crypto.randomUUID()}`)).status).toBe(401);
  });

  it('401s with an invalid token', async () => {
    expect((await get(`/api/attachments/${crypto.randomUUID()}/${crypto.randomUUID()}?token=not-a-valid-token`)).status).toBe(401);
  });
});
