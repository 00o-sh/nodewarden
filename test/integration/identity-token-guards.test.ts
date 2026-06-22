import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// Guard branches of the OAuth token endpoint (POST /identity/connect/token):
// malformed body, JSON-bodied requests, unsupported grant types, and the
// client_credentials / refresh_token failure paths. Real D1, no mocks. Each
// case uses a distinct client IP to stay clear of the per-IP login limiter.
function token(body: string, contentType: string, ip: string): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': contentType, 'CF-Connecting-IP': ip }),
    body,
  });
}

function form(fields: Record<string, string>, ip: string): Promise<Response> {
  return token(new URLSearchParams(fields).toString(), 'application/x-www-form-urlencoded', ip);
}

describe('OAuth token endpoint guards', () => {
  it('400s a malformed JSON body', async () => {
    const res = await token('{bad', 'application/json', '203.0.113.40');
    expect(res.status).toBe(400);
  });

  it('400s an unsupported grant type (JSON body)', async () => {
    const res = await token(JSON.stringify({ grant_type: 'made_up' }), 'application/json', '203.0.113.41');
    expect(res.status).toBe(400);
  });

  it('400s an unsupported grant type (form body)', async () => {
    const res = await form({ grant_type: 'also_made_up' }, '203.0.113.42');
    expect(res.status).toBe(400);
  });

  it('400s client_credentials with bad credentials', async () => {
    const res = await form(
      { grant_type: 'client_credentials', client_id: 'user.deadbeef', client_secret: 'nope', scope: 'api' },
      '203.0.113.43'
    );
    expect(res.status).toBe(400);
  });

  it('400s refresh_token with an invalid token', async () => {
    const res = await form({ grant_type: 'refresh_token', refresh_token: 'not-a-real-token' }, '203.0.113.44');
    expect(res.status).toBe(400);
  });
});

describe('prelogin endpoint', () => {
  it('400s a malformed JSON body', async () => {
    expect((await token('{bad', 'application/json', '203.0.113.45')).status).toBe(400);
  });

  it('400s a missing email', async () => {
    const res = await SELF.fetch(url('/identity/accounts/prelogin'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.46' }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns default KDF params for an unknown email (no enumeration)', async () => {
    const res = await SELF.fetch(url('/identity/accounts/prelogin'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.47' }),
      body: JSON.stringify({ email: `ghost-${crypto.randomUUID()}@example.com` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof (body.kdf ?? body.Kdf)).toBe('number');
  });
});

describe('token revocation endpoint', () => {
  it('returns 200 for a malformed body', async () => {
    const res = await SELF.fetch(url('/identity/connect/revocation'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.48' }),
      body: '{bad',
    });
    expect(res.status).toBe(200);
  });

  it('returns 200 when revoking an unknown token (form body)', async () => {
    const res = await SELF.fetch(url('/identity/connect/revocation'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.49' }),
      body: new URLSearchParams({ token: 'unknown-refresh-token' }).toString(),
    });
    expect(res.status).toBe(200);
  });
});
