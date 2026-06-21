import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { url } from './helpers';

// Top-level request-router guards exercised end-to-end through the live worker:
// the missing-client-IP rejection on a rate-limited public route, the
// request-body size cap, and the large-upload-path exemption from that cap.

describe('router guards', () => {
  it('rejects a rate-limited public request with no client IP (403)', async () => {
    // /api/web-bootstrap enforces the public rate limit; with no CF-Connecting-IP
    // / X-Real-IP / X-Forwarded-For (and a non-local host) the client is unknown.
    const res = await SELF.fetch(url('/api/web-bootstrap'), { method: 'GET' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error).toBe('Forbidden');
  });

  it('allows the same request once a client IP is provided', async () => {
    const res = await SELF.fetch(url('/api/web-bootstrap'), {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '203.0.113.5' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a request whose Content-Length exceeds the body cap (413)', async () => {
    const res = await SELF.fetch(url('/api/web-bootstrap'), {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '203.0.113.5', 'Content-Length': String(26 * 1024 * 1024) },
    });
    expect(res.status).toBe(413);
  });

  it('exempts large-upload paths from the body cap', async () => {
    // An attachment upload path is exempt from the size cap, so an oversized
    // Content-Length is not rejected with 413 — it falls through to auth (401).
    const res = await SELF.fetch(url(`/api/ciphers/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}`), {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.5', 'Content-Length': String(26 * 1024 * 1024) },
    });
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(401);
  });

  it('responds to a CORS preflight (OPTIONS)', async () => {
    const res = await SELF.fetch(url('/api/sync'), {
      method: 'OPTIONS',
      headers: { Origin: 'https://vault.test', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeTruthy();
  });
});
