import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// Cross-cutting request handling in the router/entrypoint: CORS preflight,
// trailing-slash normalization, and the auth gate ordering.
describe('http edges', () => {
  it('answers a CORS preflight with 204 and allow headers', async () => {
    const res = await SELF.fetch(url('/api/sync'), { method: 'OPTIONS', headers: baseHeaders() });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('normalizes a trailing slash on a public route', async () => {
    // Without normalization, "/config/" would miss the exact-match route.
    const res = await SELF.fetch(url('/config/'), { headers: baseHeaders() });
    expect(res.status).toBe(200);
    expect((await res.json()).object).toBe('config');
  });

  it('normalizes a trailing slash on /api/version', async () => {
    const res = await SELF.fetch(url('/api/version/'), { headers: baseHeaders() });
    expect(res.status).toBe(200);
  });

  it('applies the auth gate before routing (unknown protected path -> 401)', async () => {
    const res = await SELF.fetch(url('/api/nope'), { headers: baseHeaders() });
    expect(res.status).toBe(401);
  });

  it('rejects requests with no client IP on a rate-limited public route (403)', async () => {
    // No CF-Connecting-IP / X-Real-IP / X-Forwarded-For and a non-local host.
    const res = await SELF.fetch(url('/api/accounts/register'), {
      method: 'POST',
      headers: { Origin: url(''), 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});
