import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// The public attachment upload route dispatches whenever a `token` query param
// is present; an empty token is then rejected by the handler with 401. Real
// worker (valid JWT secret), no mocks.
describe('public attachment upload token', () => {
  it('401s an upload presenting an empty token', async () => {
    const res = await SELF.fetch(url(`/api/ciphers/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}?token=`), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(401);
  });
});
