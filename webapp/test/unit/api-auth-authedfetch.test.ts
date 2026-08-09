import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthedFetch, registerAccount } from '@/lib/api/auth';
import type { SessionState } from '@/lib/types';

// Unit coverage for the two api/auth functions previously exercised only at the
// contract/component level: the authed-fetch retry/refresh core (security
// critical) and account registration.

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const okResponse = (status = 200) => Promise.resolve(new Response('ok', { status }));

const tokenSession = (over: Partial<SessionState> = {}): SessionState =>
  ({ email: 'a@b.com', authMode: 'token', accessToken: 'old-at', refreshToken: 'rt', ...over }) as SessionState;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('createAuthedFetch — auth + happy path', () => {
  it('throws when the session has no access token', async () => {
    const af = createAuthedFetch(() => tokenSession({ accessToken: undefined }), vi.fn());
    await expect(af('/api/sync')).rejects.toThrow();
  });

  it('sends a Bearer header and returns the response on success', async () => {
    const fetchMock = vi.fn(() => okResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const af = createAuthedFetch(() => tokenSession(), vi.fn());
    const res = await af('/api/sync');
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer old-at');
  });
});

describe('createAuthedFetch — retry on transient failures', () => {
  it('retries a 500 and returns the eventual 200', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const af = createAuthedFetch(() => tokenSession(), vi.fn());
    const p = af('/api/sync');
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the max attempts and returns the last failing response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(new Response('err', { status: 503 })));
    vi.stubGlobal('fetch', fetchMock);
    const af = createAuthedFetch(() => tokenSession(), vi.fn());
    const p = af('/api/sync');
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3); // maxAttempts
  });
});

describe('createAuthedFetch — 401 refresh flow', () => {
  it('refreshes the token on 401 and retries the request with the new token', async () => {
    const setSession = vi.fn();
    const fetchMock = vi
      .fn()
      // 1) app request -> 401
      .mockResolvedValueOnce(new Response('unauth', { status: 401 }))
      // 2) token endpoint -> new access token
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-at' }), { status: 200 }))
      // 3) retried app request -> 200
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const af = createAuthedFetch(() => tokenSession({ refreshToken: `rt-${crypto.randomUUID()}` }), setSession);
    const res = await af('/api/sync');
    expect(res.status).toBe(200);
    // The token endpoint was hit.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/identity/connect/token'))).toBe(true);
    // The session was updated with the refreshed access token.
    expect(setSession).toHaveBeenCalled();
    const saved = setSession.mock.calls.at(-1)?.[0];
    expect(saved?.accessToken).toBe('new-at');
    // The retried app request carried the new Bearer token.
    const lastAppCall = fetchMock.mock.calls.at(-1);
    expect((lastAppCall?.[1]?.headers as Headers).get('Authorization')).toBe('Bearer new-at');
  });

  it('does not refresh a token-mode 401 when there is no refresh token', async () => {
    const setSession = vi.fn();
    const fetchMock = vi.fn(() => Promise.resolve(new Response('unauth', { status: 401 })));
    vi.stubGlobal('fetch', fetchMock);
    const af = createAuthedFetch(() => tokenSession({ refreshToken: undefined }), setSession);
    const res = await af('/api/sync');
    expect(res.status).toBe(401);
    expect(setSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh, no retry
  });

  it('clears the session on a permanent refresh failure (invalid_grant)', async () => {
    const setSession = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unauth', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const af = createAuthedFetch(() => tokenSession({ refreshToken: `rt-${crypto.randomUUID()}` }), setSession);
    await expect(af('/api/sync')).rejects.toThrow();
    expect(setSession).toHaveBeenCalledWith(null);
  });
});

describe('registerAccount', () => {
  it('POSTs a lowercased email + kdf:0 body and returns ok on success', async () => {
    const fetchMock = vi.fn(() => jsonResponse({}, 200));
    vi.stubGlobal('fetch', fetchMock);
    const result = await registerAccount({
      email: 'User@Example.COM',
      name: 'Ada',
      password: 'pw',
      fallbackIterations: 600000,
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/accounts/register');
    const body = JSON.parse(init.body as string);
    expect(body.email).toBe('user@example.com');
    expect(body.name).toBe('Ada');
    expect(body.kdf).toBe(0);
    expect(body.kdfIterations).toBe(600000);
    // Crypto material is present and string-shaped (values are random).
    expect(typeof body.masterPasswordHash).toBe('string');
    expect(typeof body.key).toBe('string');
    expect(typeof body.keys.publicKey).toBe('string');
    expect(typeof body.keys.encryptedPrivateKey).toBe('string');
  });

  it('returns a translated failure message when the server rejects', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ error_description: 'email already taken' }, 400));
    vi.stubGlobal('fetch', fetchMock);
    const result = await registerAccount({ email: 'a@b.com', name: 'A', password: 'pw', fallbackIterations: 600000 });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain('email already taken');
  });

  it('reports web-crypto-unavailable without calling the network', async () => {
    const fetchMock = vi.fn(() => jsonResponse({}, 200));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('isSecureContext', false);
    const result = await registerAccount({ email: 'a@b.com', name: 'A', password: 'pw', fallbackIterations: 600000 });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
