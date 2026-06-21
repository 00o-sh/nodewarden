import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// The NotificationsHub DO's internal HTTP endpoints, driven directly through a
// real DO stub. With no sockets connected, the broadcast helpers short-circuit,
// so these deterministically exercise the request parsing, validation, and the
// online-device listing without needing a live WebSocket.
function hub(name: string) {
  const id = (env as any).NOTIFICATIONS_HUB.idFromName(name);
  return (env as any).NOTIFICATIONS_HUB.get(id);
}

function post(stub: any, path: string, body?: unknown) {
  return stub.fetch(`https://notifications${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('notifications hub internal endpoints', () => {
  it('accepts a vault-sync notify (default payload) -> 204', async () => {
    const stub = hub(`n-${crypto.randomUUID()}`);
    const res = await post(stub, '/internal/notify', { userId: crypto.randomUUID() });
    expect(res.status).toBe(204);
  });

  it('accepts a notify with an explicit payload and a target device -> 204', async () => {
    const stub = hub(`n2-${crypto.randomUUID()}`);
    const res = await post(stub, '/internal/notify', {
      userId: crypto.randomUUID(),
      updateType: 5,
      targetDeviceIdentifier: crypto.randomUUID(),
      payload: { Type: 5, foo: 'bar' },
    });
    expect(res.status).toBe(204);
  });

  it('validates the auth-request-response payload', async () => {
    const stub = hub(`a-${crypto.randomUUID()}`);
    expect((await post(stub, '/internal/auth-request-response', {})).status).toBe(400);
    expect((await post(stub, '/internal/auth-request-response', { userId: 'u1', authRequestId: 'r1' })).status).toBe(204);
  });

  it('reports online device identifiers (empty with no sockets)', async () => {
    const stub = hub(`o-${crypto.randomUUID()}`);
    const res = await stub.fetch('https://notifications/internal/online');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.deviceIdentifiers)).toBe(true);
    expect(body.deviceIdentifiers.length).toBe(0);
  });

  it('404s an unknown non-websocket path', async () => {
    const stub = hub(`u-${crypto.randomUUID()}`);
    const res = await stub.fetch('https://notifications/internal/does-not-exist');
    expect(res.status).toBe(404);
  });
});
