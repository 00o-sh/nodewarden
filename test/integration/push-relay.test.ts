import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/services/storage';
import {
  ensurePushInstallationCredentials,
  notifyMobilePush,
  registerMobilePushDevice,
  unregisterMobilePushDevice,
} from '../../src/services/push-relay';
import { authenticate, url } from './helpers';

// The mobile push relay is opt-in (PUSH_RELAY_ENABLED). When enabled it talks to
// Bitwarden's public push service; we swap fetch for a faithful in-memory push
// server (real store/return semantics, every request captured) so we can assert
// the request shaping AND the security boundary (only metadata is transmitted).
// No mocks of our own code — the real push-relay functions run end to end.

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
      return Response.json({ id: 'install-1', key: 'install-key-1', enabled: true });
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

const db = (): D1Database => (env as { DB: D1Database }).DB;
const userIdFromToken = (token: string): string => JSON.parse(atob(token.split('.')[1])).sub as string;

beforeAll(async () => {
  // Bootstrap the D1 schema (config/devices tables) via a real request.
  await SELF.fetch(url('/config'));
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

describe('mobile push relay', () => {
  it('is a complete no-op (no outbound calls) when PUSH_RELAY_ENABLED is not set', async () => {
    delete (env as { PUSH_RELAY_ENABLED?: string }).PUSH_RELAY_ENABLED;

    expect(
      await registerMobilePushDevice(env, {
        userId: 'u',
        deviceIdentifier: 'd',
        type: 0,
        pushUuid: 'pu',
        pushToken: 'pt',
      })
    ).toBe(false);
    expect(await unregisterMobilePushDevice(env, 'pu')).toBe(false);
    await notifyMobilePush(env, {
      userId: 'u',
      updateType: 1,
      revisionDate: '2024-01-01T00:00:00Z',
      contextId: null,
      payload: { Id: 'x' },
    });

    expect(calls).toHaveLength(0);
  });

  it('provisions installation credentials once and then serves them from config', async () => {
    await db()
      .prepare("DELETE FROM config WHERE key IN ('push.installation.id', 'push.installation.key')")
      .run();

    const creds = await ensurePushInstallationCredentials(db());
    expect(creds).toEqual({ id: 'install-1', key: 'install-key-1' });
    expect(calls.filter((c) => c.path === '/installations')).toHaveLength(1);

    // A second call reads the persisted credentials — no new installation request.
    const before = calls.length;
    const again = await ensurePushInstallationCredentials(db());
    expect(again).toEqual({ id: 'install-1', key: 'install-key-1' });
    expect(calls.slice(before).filter((c) => c.path === '/installations')).toHaveLength(0);
  });

  it('registers a device push token with the relay', async () => {
    const ok = await registerMobilePushDevice(env, {
      userId: 'user-7',
      deviceIdentifier: 'device-7',
      type: 0,
      pushUuid: 'push-uuid-7',
      pushToken: 'push-token-7',
    });
    expect(ok).toBe(true);

    const register = calls.find((c) => c.path === '/push/register');
    expect(register).toBeTruthy();
    expect(JSON.parse(register!.body!)).toMatchObject({
      deviceId: 'push-uuid-7',
      pushToken: 'push-token-7',
      userId: 'user-7',
    });
  });

  it('unregisters a device push token with the relay', async () => {
    expect(await unregisterMobilePushDevice(env, 'push-uuid-7')).toBe(true);
    expect(calls.some((c) => c.path === '/push/delete/push-uuid-7')).toBe(true);
  });

  it('sends only non-secret metadata when notifying a user who has a push device', async () => {
    const session = await authenticate(`pushrelay-${crypto.randomUUID().slice(0, 8)}`);
    const userId = userIdFromToken(session.accessToken);
    const storage = new StorageService(db());
    // The login above created the device; attach a push token to it.
    await storage.updateDevicePushToken(userId, session.account.deviceIdentifier, 'push-uuid-n', 'push-token-n');

    await notifyMobilePush(env, {
      userId,
      updateType: 1,
      revisionDate: '2024-05-05T00:00:00Z',
      contextId: session.account.deviceIdentifier,
      payload: { Id: 'cipher-secret', Name: 'do-not-leak', Login: { password: 'do-not-leak-pw' } },
    });

    const send = calls.find((c) => c.path === '/push/send');
    expect(send).toBeTruthy();
    const sent = JSON.parse(send!.body!);
    expect(sent.userId).toBe(userId);
    expect(sent.payload.id).toBe('cipher-secret');
    // The vault secrets in the source payload must never be transmitted.
    expect(send!.body).not.toContain('do-not-leak');
  });

  it('degrades gracefully when the installation endpoint fails', async () => {
    await db()
      .prepare("DELETE FROM config WHERE key IN ('push.installation.id', 'push.installation.key')")
      .run();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ method: 'POST', path: new URL(raw).pathname, body: null });
      return new Response('upstream blew up', { status: 500 });
    }) as typeof fetch;

    expect(await ensurePushInstallationCredentials(db())).toBeNull();
    // Registration cannot proceed without installation credentials.
    expect(
      await registerMobilePushDevice(env, {
        userId: 'u',
        deviceIdentifier: 'd',
        type: 0,
        pushUuid: 'pu',
        pushToken: 'pt',
      })
    ).toBe(false);
    expect(calls.some((c) => c.path === '/push/register')).toBe(false);
  });

  it('returns null credentials when the installation response omits id/key', async () => {
    await db()
      .prepare("DELETE FROM config WHERE key IN ('push.installation.id', 'push.installation.key')")
      .run();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw).pathname === '/installations') return Response.json({ enabled: true });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    expect(await ensurePushInstallationCredentials(db())).toBeNull();
  });

  it('does not contact the relay when the user has no push-enabled device', async () => {
    // A user with no device rows: notifyMobilePush only reads the devices table,
    // so a synthetic id is sufficient and must short-circuit before any send.
    await notifyMobilePush(env, {
      userId: crypto.randomUUID(),
      updateType: 1,
      revisionDate: '2024-05-05T00:00:00Z',
      contextId: null,
      payload: { Id: 'x' },
    });

    expect(calls.some((c) => c.path === '/push/send')).toBe(false);
  });
});
