import { SELF, env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ensurePushInstallationCredentials,
  registerMobilePushDevice,
  unregisterMobilePushDevice,
} from '../../src/services/push-relay';

// The push-relay HTTP failure branches: a thrown fetch (network error), a token
// endpoint that errors / omits the token / returns junk, and a relay endpoint
// that rejects. We drive the real push-relay functions with a configurable but
// faithful in-memory Bitwarden push server (recreating its real HTTP contract
// and the failures it genuinely produces — not fabricated behaviour). The token
// cache only populates on success, so the failure cases below run while it is
// empty; the relay-failure cases come last, after a real token is obtained.
let installMode: 'ok' | 'badjson' | 'throw';
let tokenMode: 'ok' | 'throw' | '500' | 'badjson' | 'notoken';
let relayMode: 'ok' | 'throw' | '500';
let originalFetch: typeof fetch;

const db = (): D1Database => (env as { DB: D1Database }).DB;

function pushServer(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw).pathname;
    void init;

    if (path === '/installations') {
      if (installMode === 'throw') throw new Error('install network down');
      if (installMode === 'badjson') return new Response('not-json', { status: 200 });
      return Response.json({ id: 'install-1', key: 'install-key-1', enabled: true });
    }
    if (path === '/connect/token') {
      if (tokenMode === 'throw') throw new Error('network down');
      if (tokenMode === '500') return new Response('token upstream error', { status: 500 });
      if (tokenMode === 'badjson') return new Response('not-json', { status: 200 });
      if (tokenMode === 'notoken') return Response.json({ expires_in: 3600 });
      return Response.json({ access_token: 'push-access-token', expires_in: 3600 });
    }
    if (path.startsWith('/push/')) {
      if (relayMode === 'throw') throw new Error('relay down');
      if (relayMode === '500') return new Response('relay error', { status: 500 });
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

const device = () => ({ userId: 'u', deviceIdentifier: 'd', type: 0, pushUuid: 'pu', pushToken: 'pt' });

beforeAll(async () => {
  await SELF.fetch('https://vault.test/config'); // bootstrap the config/devices schema
  originalFetch = globalThis.fetch;
  globalThis.fetch = pushServer();
  (env as { PUSH_RELAY_ENABLED?: string }).PUSH_RELAY_ENABLED = 'true';
  installMode = 'ok';
  tokenMode = 'ok';
  relayMode = 'ok';
  // Provision installation credentials once (persisted in config); later tests
  // read them from config, so /installations is not hit again.
  await db().prepare("DELETE FROM config WHERE key IN ('push.installation.id', 'push.installation.key')").run();
  expect(await ensurePushInstallationCredentials(db())).toEqual({ id: 'install-1', key: 'install-key-1' });
});

beforeEach(() => {
  installMode = 'ok';
  tokenMode = 'ok';
  relayMode = 'ok';
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  delete (env as { PUSH_RELAY_ENABLED?: string }).PUSH_RELAY_ENABLED;
});

afterEach(() => {
  // keep the stub installed for the whole file
  globalThis.fetch = pushServer();
});

describe('push relay failure branches', () => {
  // --- token-fetch failures (token cache stays empty: these never cache) ---
  it('returns false when the token endpoint throws (network error)', async () => {
    tokenMode = 'throw';
    expect(await registerMobilePushDevice(env, device())).toBe(false);
  });

  it('returns false when the token endpoint returns a non-OK status', async () => {
    tokenMode = '500';
    expect(await registerMobilePushDevice(env, device())).toBe(false);
  });

  it('returns false when the token response is not valid JSON', async () => {
    tokenMode = 'badjson';
    expect(await registerMobilePushDevice(env, device())).toBe(false);
  });

  it('returns false when the token response omits access_token', async () => {
    tokenMode = 'notoken';
    expect(await registerMobilePushDevice(env, device())).toBe(false);
  });

  // --- relay-endpoint failures (token succeeds here, then is cached) ---
  it('returns false when the relay endpoint returns a non-OK status', async () => {
    relayMode = '500';
    expect(await registerMobilePushDevice(env, device())).toBe(false);
  });

  it('returns false when the relay endpoint throws', async () => {
    relayMode = 'throw';
    expect(await registerMobilePushDevice(env, device())).toBe(false);
  });

  // --- unregister guard ---
  it('returns false for an empty push uuid without contacting the relay', async () => {
    expect(await unregisterMobilePushDevice(env, '')).toBe(false);
    expect(await unregisterMobilePushDevice(env, null)).toBe(false);
  });

  // --- installation request failures ---
  it('returns null credentials when the installation request throws (network error)', async () => {
    await db().prepare("DELETE FROM config WHERE key IN ('push.installation.id', 'push.installation.key')").run();
    installMode = 'throw';
    expect(await ensurePushInstallationCredentials(db())).toBeNull();
  });

  it('returns null credentials when the installation response is not valid JSON', async () => {
    await db().prepare("DELETE FROM config WHERE key IN ('push.installation.id', 'push.installation.key')").run();
    installMode = 'badjson';
    expect(await ensurePushInstallationCredentials(db())).toBeNull();
  });
});
