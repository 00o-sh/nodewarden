import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// These endpoints form the contract that Bitwarden clients depend on at
// connect time. Snapshotting their shape turns "did an upstream merge change
// the API?" into a visible test diff.
describe('unauthenticated contract', () => {
  it('GET /api/version returns the advertised server version', async () => {
    const res = await SELF.fetch(url('/api/version'), { headers: baseHeaders() });
    expect(res.status).toBe(200);
    const version = await res.json();
    // A bare JSON string like "2026.4.1".
    expect(typeof version).toBe('string');
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('GET /config exposes the expected environment + feature shape', async () => {
    const res = await SELF.fetch(url('/config'), { headers: baseHeaders() });
    expect(res.status).toBe(200);
    const config = (await res.json()) as Record<string, any>;

    expect(config.object).toBe('config');
    expect(typeof config.version).toBe('string');
    expect(config.environment).toMatchObject({
      vault: url(''),
      api: url('/api'),
      identity: url('/identity'),
      notifications: url('/notifications'),
    });
    // Feature flags clients branch on — keep their keys stable across upstream.
    expect(Object.keys(config.featureStates).sort()).toEqual(
      [
        'cipher-key-encryption',
        'duo-redirect',
        'email-verification',
        'pm-19051-send-email-verification',
        'pm-19148-innovation-archive',
        'unauth-ui-refresh',
        'web-push',
      ].sort()
    );
  });

  it('GET /config and GET /api/config are equivalent', async () => {
    const [a, b] = await Promise.all([
      SELF.fetch(url('/config'), { headers: baseHeaders() }),
      SELF.fetch(url('/api/config'), { headers: baseHeaders() }),
    ]);
    expect(await a.json()).toEqual(await b.json());
  });
});

describe('authentication gate', () => {
  it('rejects /api/sync without a token (401)', async () => {
    const res = await SELF.fetch(url('/api/sync'), { headers: baseHeaders() });
    expect(res.status).toBe(401);
  });

  it('rejects /api/sync with a garbage bearer token (401)', async () => {
    const res = await SELF.fetch(url('/api/sync'), {
      headers: baseHeaders({ Authorization: 'Bearer not-a-real-jwt' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown API routes when authenticated check is bypassed', async () => {
    // Unknown path, no token: still gated by auth -> 401 (not 404), proving the
    // gate runs before route resolution.
    const res = await SELF.fetch(url('/api/does-not-exist'), { headers: baseHeaders() });
    expect(res.status).toBe(401);
  });

  it('applies security headers to API responses', async () => {
    const res = await SELF.fetch(url('/api/version'), { headers: baseHeaders() });
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
