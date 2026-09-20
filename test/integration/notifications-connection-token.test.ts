import { SELF, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { handleNotificationsHub, handleNotificationsNegotiate } from '../../src/handlers/notifications';
import { createJWT } from '../../src/utils/jwt';
import { createWebSocketConnectionToken } from '../../src/utils/websocket-connection-token';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// The websocket connection-ticket flow: negotiate (Authorization header) hands
// out a short-lived one-time ticket that the websocket upgrade is authenticated
// with (`?id=`), so the built-in web vault never puts the access JWT in the
// websocket URL. The `?access_token=` query form stays accepted on the upgrade
// only, because the official Bitwarden browser-based clients (web vault,
// extension, desktop) cannot set headers on a WebSocket. Real worker + real DO.
let session: Session;
let userId: string;
let email: string;

const WS_HEADERS = { Upgrade: 'websocket', 'CF-Connecting-IP': '203.0.113.21' };

beforeAll(async () => {
  session = await authenticate('wsticket');
  const profile = (await (await api('GET', '/api/accounts/profile', session.accessToken)).json()) as any;
  userId = profile.id;
  email = profile.email;
});

function hubStub() {
  const id = (env as any).NOTIFICATIONS_HUB.idFromName(userId);
  return (env as any).NOTIFICATIONS_HUB.get(id);
}

async function negotiate(): Promise<{ status: number; body: any; cacheControl: string | null }> {
  const res = await SELF.fetch(url('/notifications/hub/negotiate?negotiateVersion=1'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${session.accessToken}` }),
  });
  return { status: res.status, body: await res.json(), cacheControl: res.headers.get('Cache-Control') };
}

async function upgrade(query: string): Promise<Response> {
  return SELF.fetch(url(`/notifications/hub${query}`), { headers: WS_HEADERS });
}

async function storedTicketKeys(): Promise<string[]> {
  return runInDurableObject(hubStub(), async (_instance: unknown, state: DurableObjectState) => {
    const entries = await state.storage.list({ prefix: 'ws-token:' });
    return Array.from(entries.keys());
  });
}

describe('negotiate issues a one-time websocket connection ticket', () => {
  it('returns a signed ticket that upgrades exactly once', async () => {
    const { status, body, cacheControl } = await negotiate();
    expect(status).toBe(200);
    expect(cacheControl).toBe('no-store');
    expect(typeof body.connectionId).toBe('string');
    expect(typeof body.connectionToken).toBe('string');
    expect(body.connectionToken).not.toBe(body.connectionId);
    expect(body.availableTransports[0].transport).toBe('WebSockets');

    const first = await upgrade(`?id=${encodeURIComponent(body.connectionToken)}`);
    expect(first.status).toBe(101);
    first.webSocket!.accept();
    first.webSocket!.close();

    // Replaying the same ticket must fail: it was consumed by the first upgrade.
    expect((await upgrade(`?id=${encodeURIComponent(body.connectionToken)}`)).status).toBe(401);
  });

  it('does not consume the ticket on a non-upgrade request', async () => {
    const { body } = await negotiate();
    const query = `?id=${encodeURIComponent(body.connectionToken)}`;

    const plain = await SELF.fetch(url(`/notifications/hub${query}`), { headers: baseHeaders() });
    expect(plain.status).toBe(426);

    const ws = await upgrade(query);
    expect(ws.status).toBe(101);
    ws.webSocket!.accept();
    ws.webSocket!.close();
  });

  it('rejects the access token in the negotiate query string', async () => {
    const res = await SELF.fetch(
      url(`/notifications/hub/negotiate?access_token=${encodeURIComponent(session.accessToken)}`),
      { method: 'POST', headers: baseHeaders() }
    );
    expect(res.status).toBe(401);
  });

  it('surfaces a hub that refuses to store the ticket', async () => {
    const refusingEnv = {
      ...env,
      NOTIFICATIONS_HUB: {
        idFromName: () => 'refusing',
        get: () => ({ fetch: async () => new Response('nope', { status: 500 }) }),
      },
    } as unknown as typeof env;
    const request = new Request(url('/notifications/hub/negotiate'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${session.accessToken}` }),
    });
    await expect(handleNotificationsNegotiate(request, refusingEnv as any)).rejects.toThrow(/connection token/);
  });
});

describe('websocket upgrade authentication', () => {
  it('rejects a forged or malformed ticket without touching a Durable Object', async () => {
    expect((await upgrade('?id=attacker-controlled.invalid-signature')).status).toBe(401);
    expect((await upgrade('?id=not-a-ticket')).status).toBe(401);
    expect((await upgrade('')).status).toBe(401);
  });

  it('rejects a validly signed ticket whose stored owner does not match', async () => {
    const expiresAt = Date.now() + 30_000;
    const token = await createWebSocketConnectionToken(userId, expiresAt, (env as any).JWT_SECRET);
    const stored = await hubStub().fetch('https://notifications/internal/ws-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userId: 'someone-else', deviceIdentifier: null, expiresAt }),
    });
    expect(stored.status).toBe(204);
    expect((await upgrade(`?id=${encodeURIComponent(token)}`)).status).toBe(401);
  });

  it('still accepts the access token from the query string for browser SignalR clients', async () => {
    const res = await upgrade(`?access_token=${encodeURIComponent(session.accessToken)}`);
    expect(res.status).toBe(101);
    res.webSocket!.accept();
    res.webSocket!.close();

    expect((await upgrade('?access_token=not-a-jwt')).status).toBe(401);
  });

  it('issues and consumes a ticket for a device-less access token', async () => {
    // Tokens minted without a device claim (e.g. API-key style sessions) carry no
    // device identifier through negotiate or into the hub attachment.
    const row = await (env as any).DB.prepare('SELECT security_stamp FROM users WHERE id = ?').bind(userId).first();
    const deviceless = await createJWT({ sub: userId, email, name: 'Ticket Test', sstamp: row.security_stamp } as any, (env as any).JWT_SECRET);

    const res = await SELF.fetch(url('/notifications/hub/negotiate'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${deviceless}` }),
    });
    expect(res.status).toBe(200);
    const { connectionToken } = (await res.json()) as { connectionToken: string };

    const ws = await upgrade(`?id=${encodeURIComponent(connectionToken)}`);
    expect(ws.status).toBe(101);
    ws.webSocket!.accept();
    ws.webSocket!.close();
  });

  it('rejects a ticket whose hub consume reply is unusable', async () => {
    const consumeReplies = [
      new Response('not json', { status: 200 }),
      Response.json({ userId: 'someone-else' }),
    ];
    const brokenEnv = {
      ...env,
      NOTIFICATIONS_HUB: {
        idFromName: () => 'broken',
        get: () => ({ fetch: async () => consumeReplies.shift()! }),
      },
    } as unknown as typeof env;
    const token = await createWebSocketConnectionToken(userId, Date.now() + 30_000, (env as any).JWT_SECRET);
    const request = () => new Request(url(`/notifications/hub?id=${encodeURIComponent(token)}`), { headers: WS_HEADERS });

    expect((await handleNotificationsHub(request(), brokenEnv as any)).status).toBe(401);
    expect((await handleNotificationsHub(request(), brokenEnv as any)).status).toBe(401);
    expect(consumeReplies).toHaveLength(0);
  });

  it('falls back to the query access token when the ticket is stale', async () => {
    const { body } = await negotiate();
    const ticket = encodeURIComponent(body.connectionToken);
    const first = await upgrade(`?id=${ticket}`);
    expect(first.status).toBe(101);
    first.webSocket!.accept();
    first.webSocket!.close();

    const reconnect = await upgrade(`?id=${ticket}&access_token=${encodeURIComponent(session.accessToken)}`);
    expect(reconnect.status).toBe(101);
    reconnect.webSocket!.accept();
    reconnect.webSocket!.close();
  });
});

describe('NotificationsHub ticket storage', () => {
  it('validates ticket registration and consumption bodies', async () => {
    const stub = hubStub();
    const post = (path: string, body: string) => stub.fetch(`https://notifications${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect((await post('/internal/ws-token', 'not json')).status).toBe(400);
    expect((await post('/internal/ws-token', JSON.stringify({ token: 't', userId, expiresAt: Date.now() - 1 }))).status).toBe(400);
    expect((await post('/internal/ws-token', JSON.stringify({ token: 't', userId, expiresAt: Date.now() + 600_000 }))).status).toBe(400);
    expect((await post('/internal/ws-token', JSON.stringify({ token: '', userId, expiresAt: Date.now() + 1000 }))).status).toBe(400);
    expect((await post('/internal/ws-token/consume', 'not json')).status).toBe(400);
    expect((await post('/internal/ws-token/consume', JSON.stringify({ token: 'unknown' }))).status).toBe(401);
  });

  it('refuses to consume an expired ticket and sweeps it from storage on the alarm', async () => {
    const stub = hubStub();
    const shortLived = `short-${crypto.randomUUID()}`;
    // Registered in key order (a, b, c) so the alarm's next-expiration scan
    // sees a later-expiring ticket first, then an earlier one, then a later one.
    const longLived = `a-live-${crypto.randomUUID()}`;
    const soonerLived = `b-live-${crypto.randomUUID()}`;
    const laterLived = `c-live-${crypto.randomUUID()}`;
    const register = (token: string, expiresAt: number) => stub.fetch('https://notifications/internal/ws-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userId, deviceIdentifier: 'device-1', expiresAt }),
    });
    expect((await register(longLived, Date.now() + 50_000)).status).toBe(204);
    expect((await register(soonerLived, Date.now() + 30_000)).status).toBe(204);
    expect((await register(laterLived, Date.now() + 55_000)).status).toBe(204);
    expect((await register(shortLived, Date.now() + 40)).status).toBe(204);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const consumed = await stub.fetch('https://notifications/internal/ws-token/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: shortLived }),
    });
    expect(consumed.status).toBe(401);

    // Re-register another short ticket so the sweep has something expired to remove.
    const expiredLater = `expired-${crypto.randomUUID()}`;
    expect((await register(expiredLater, Date.now() + 40)).status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const keys = await storedTicketKeys();
    expect(keys).not.toContain(`ws-token:${expiredLater}`);
    expect(keys).toContain(`ws-token:${longLived}`);
    expect(keys).toContain(`ws-token:${soonerLived}`);
    expect(keys).toContain(`ws-token:${laterLived}`);

    // The long-lived ticket keeps the alarm armed; running it again is a no-op sweep.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await storedTicketKeys()).toContain(`ws-token:${longLived}`);
  });
});
