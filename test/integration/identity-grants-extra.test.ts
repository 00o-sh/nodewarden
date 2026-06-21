import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

// Identity-endpoint branches the existing grant suites miss: the unsupported
// grant type, prelogin guards, the client_credentials parameter checks, and the
// revocation endpoint's web-session / malformed-body paths.
let session: Session;

beforeAll(async () => {
  session = await authenticate('idgx');
});

function tokenForm(fields: Record<string, string>, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders }),
    body: new URLSearchParams(fields).toString(),
  });
}

describe('unsupported grant type', () => {
  it('rejects an unknown grant_type', async () => {
    const res = await tokenForm({ grant_type: 'magic_beans', client_id: 'web', scope: 'api' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('unsupported_grant_type');
  });
});

describe('prelogin guards', () => {
  it('400s on invalid JSON', async () => {
    const res = await SELF.fetch(url('/identity/accounts/prelogin'), {
      method: 'POST', headers: baseHeaders({ 'Content-Type': 'application/json' }), body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('400s when the email is missing', async () => {
    const res = await SELF.fetch(url('/identity/accounts/prelogin'), {
      method: 'POST', headers: baseHeaders({ 'Content-Type': 'application/json' }), body: '{}',
    });
    expect(res.status).toBe(400);
  });
});

describe('client_credentials parameter checks', () => {
  it('rejects a client_id that is not a user api key', async () => {
    const res = await tokenForm({
      grant_type: 'client_credentials', client_id: 'web', client_secret: 'something', scope: 'api',
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty client_secret', async () => {
    const res = await tokenForm({
      grant_type: 'client_credentials', client_id: 'user.abc', client_secret: '', scope: 'api',
    });
    expect(res.status).toBe(400);
  });
});

describe('token revocation edges', () => {
  it('returns 200 for a malformed JSON revocation body (best effort)', async () => {
    const res = await SELF.fetch(url('/identity/connect/revocation'), {
      method: 'POST', headers: baseHeaders({ 'Content-Type': 'application/json' }), body: '{bad',
    });
    expect(res.status).toBe(200);
  });

  it('accepts a JSON-body revocation of the refresh token', async () => {
    const res = await SELF.fetch(url('/identity/connect/revocation'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ token: session.refreshToken }),
    });
    expect(res.status).toBe(200);
    // The refresh token no longer works.
    const refresh = await tokenForm({ grant_type: 'refresh_token', client_id: 'web', refresh_token: session.refreshToken });
    expect(refresh.status).toBe(400);
  });

  it('clears the web-session cookie on revocation', async () => {
    const res = await SELF.fetch(url('/identity/connect/revocation'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'X-NodeWarden-Web-Session': '1' }),
      body: new URLSearchParams({ token: '' }).toString(),
    });
    expect(res.status).toBe(200);
    expect((res.headers.get('Set-Cookie') || '')).toMatch(/nodewarden_web_refresh=/);
  });
});
