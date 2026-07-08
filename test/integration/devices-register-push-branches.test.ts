import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Device registration (POST /api/devices), lost-trust reporting, and the mobile
// push-token lifecycle that fans out to the Bitwarden push relay. The relay is
// opt-in (PUSH_RELAY_ENABLED); when enabled we swap fetch for a faithful
// in-memory push server (mirrors push-relay.test.ts) so we can assert both the
// register (/push/register) and unregister (/push/delete) relay calls fire with
// the right shape. Real worker + real D1 otherwise; only outbound fetch is stubbed.
let session: Session;
let token: string;
const userIdFromToken = (t: string): string => JSON.parse(atob(t.split('.')[1])).sub as string;

interface CapturedCall {
  method: string;
  path: string;
  body: string | null;
}

let calls: CapturedCall[];
let originalFetch: typeof fetch;

function bitwardenPushServer(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw);
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? await new Response(init.body as BodyInit).text() : null;
    calls.push({ method, path: u.pathname, body });

    if (u.pathname === '/installations') {
      return Response.json({ id: 'install-dev-1', key: 'install-dev-key-1', enabled: true });
    }
    if (u.pathname === '/connect/token') {
      return Response.json({ access_token: 'push-access-token', expires_in: 3600 });
    }
    if (u.pathname.startsWith('/push/')) {
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

beforeAll(async () => {
  session = await authenticate('dev-register-push');
  token = session.accessToken;
});

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = bitwardenPushServer();
  (env as { PUSH_RELAY_ENABLED?: string }).PUSH_RELAY_ENABLED = 'true';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (env as { PUSH_RELAY_ENABLED?: string }).PUSH_RELAY_ENABLED;
});

describe('POST /api/devices registration', () => {
  it('400s a non-JSON body', async () => {
    const res = await SELF.fetch(url('/api/devices'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('400s when the identifier or type is missing', async () => {
    const res = await api('POST', '/api/devices', token, { name: 'My Device' });
    expect(res.status).toBe(400);
  });

  it('registers a device and returns its device response', async () => {
    const identifier = crypto.randomUUID();
    const res = await api('POST', '/api/devices', token, {
      identifier,
      name: 'Registered Device',
      type: 8,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('device');
    expect(body.identifier).toBe(identifier);
    expect(body.name).toBe('Registered Device');
    expect(body.type).toBe(8);
    // No pushToken was supplied, so no relay registration happened.
    expect(calls.some((c) => c.path === '/push/register')).toBe(false);
  });

  it('registers a device with a push token and relays it to /push/register', async () => {
    const identifier = crypto.randomUUID();
    const res = await api('POST', '/api/devices', token, {
      identifier,
      name: 'Pushy Device',
      type: 0,
      pushToken: 'device-push-token-abc',
    });
    expect(res.status).toBe(200);

    const register = calls.find((c) => c.path === '/push/register');
    expect(register).toBeTruthy();
    expect(register!.method).toBe('POST');
    expect(JSON.parse(register!.body!)).toMatchObject({
      pushToken: 'device-push-token-abc',
      userId: userIdFromToken(token),
      identifier,
      type: 0,
    });
  });
});

describe('PUT /api/devices/identifier/:id/token', () => {
  it('400s when the push token is missing', async () => {
    const res = await api(
      'PUT',
      `/api/devices/identifier/${session.account.deviceIdentifier}/token`,
      token,
      {}
    );
    expect(res.status).toBe(400);
  });

  it('404s an unknown device identifier', async () => {
    const res = await api('PUT', `/api/devices/identifier/${crypto.randomUUID()}/token`, token, {
      pushToken: 'tok',
    });
    expect(res.status).toBe(404);
  });

  it('accepts a push token for a known device and relays it', async () => {
    const res = await api(
      'PUT',
      `/api/devices/identifier/${session.account.deviceIdentifier}/token`,
      token,
      { pushToken: 'refreshed-token' }
    );
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.path === '/push/register')).toBe(true);
  });
});

describe('DELETE /api/devices/:id relays an unregister', () => {
  it('unregisters the device push token via /push/delete on delete', async () => {
    // Register a throwaway device carrying a push token so it has a pushUuid.
    const identifier = crypto.randomUUID();
    expect(
      (await api('POST', '/api/devices', token, { identifier, name: 'Temp', type: 1, pushToken: 'temp-token' }))
        .status
    ).toBe(200);
    calls.length = 0;

    const del = await api('DELETE', `/api/devices/${identifier}`, token);
    expect(del.status).toBe(200);
    expect((await del.json()).success).toBe(true);

    const unregister = calls.find((c) => c.path === '/push/delete');
    expect(unregister).toBeTruthy();
    expect(unregister!.method).toBe('POST');
    // The relay delete carries only the opaque push uuid, keyed as { id }.
    expect(Object.keys(JSON.parse(unregister!.body!))).toEqual(['id']);
  });
});

describe('POST /api/devices/lost-trust', () => {
  it('400s when no device identifier is provided', async () => {
    const res = await api('POST', '/api/devices/lost-trust', token, {});
    expect(res.status).toBe(400);
  });

  it('records a lost-trust report for a device identifier (200)', async () => {
    const res = await api('POST', '/api/devices/lost-trust', token, {
      identifier: session.account.deviceIdentifier,
      type: '8',
    });
    expect(res.status).toBe(200);
  });
});
