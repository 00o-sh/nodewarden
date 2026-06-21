import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, TestAccount, authenticate, baseHeaders, url } from './helpers';

// The web-session variant of the password + refresh_token grants: instead of a
// JSON refresh_token, the server sets an HttpOnly refresh cookie and reads it
// back on refresh. Drives parseCookieValue / buildRefreshCookie /
// withWebRefreshCookie end-to-end through the live worker.
let session: Session;
let account: TestAccount;

beforeAll(async () => {
  session = await authenticate('webn');
  account = session.account;
});

const WEB_COOKIE = 'nodewarden_web_refresh';

function webLogin(): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'CF-Connecting-IP': '203.0.113.61',
      'X-NodeWarden-Web-Session': '1',
    }),
    body: new URLSearchParams({
      grant_type: 'password',
      username: account.email,
      password: account.masterPasswordHash,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: account.deviceIdentifier,
      deviceName: 'web-session-test',
    }).toString(),
  });
}

function webRefresh(cookie: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'CF-Connecting-IP': '203.0.113.61',
    'X-NodeWarden-Web-Session': '1',
  };
  if (cookie) headers.Cookie = cookie;
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders(headers),
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'web' }).toString(),
  });
}

function extractCookie(res: Response): string | null {
  const setCookie = res.headers.get('Set-Cookie') || '';
  const match = new RegExp(`${WEB_COOKIE}=([^;]*)`).exec(setCookie);
  return match ? `${WEB_COOKIE}=${match[1]}` : null;
}

describe('web-session token flow', () => {
  it('issues a refresh cookie on login instead of a JSON refresh token', async () => {
    const res = await webLogin();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.access_token).toBeTruthy();
    expect(body.web_session).toBe(true);
    expect(body.refresh_token).toBeUndefined();

    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain(`${WEB_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
  });

  it('refreshes using the cookie and rotates it', async () => {
    const cookie = extractCookie(await webLogin());
    expect(cookie).toBeTruthy();

    const refreshed = await webRefresh(cookie);
    expect(refreshed.status).toBe(200);
    const body = (await refreshed.json()) as any;
    expect(typeof body.access_token).toBe('string');
    expect(body.web_session).toBe(true);
    expect((refreshed.headers.get('Set-Cookie') || '')).toContain(`${WEB_COOKIE}=`);
  });

  it('clears the cookie when the refresh cookie is invalid', async () => {
    const res = await webRefresh(`${WEB_COOKIE}=not-a-real-token`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_grant');
    // The cleared cookie carries Max-Age=0.
    expect((res.headers.get('Set-Cookie') || '')).toMatch(/Max-Age=0/i);
  });

  it('requires a refresh token when the web session has no cookie', async () => {
    const res = await webRefresh(null);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('invalid_request');
  });
});
