import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

// The anonymous notifications hub (used for passwordless auth-request flows)
// and the query-string access_token path of the authenticated negotiate
// endpoint. The websocket case is a genuine WS to the real DO — no mocks.
let session: Session;

beforeAll(async () => {
  session = await authenticate('notify-anon');
});

const RECORD_SEPARATOR = String.fromCharCode(0x1e);

describe('anonymous notifications hub', () => {
  it('requires a Token query parameter (400)', async () => {
    const res = await SELF.fetch(url('/notifications/anonymous-hub'), {
      headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '203.0.113.7' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-websocket request even with a Token (426)', async () => {
    const res = await SELF.fetch(url(`/notifications/anonymous-hub?Token=${crypto.randomUUID()}`), {
      headers: { 'CF-Connecting-IP': '203.0.113.7' },
    });
    expect(res.status).toBe(426);
  });

  it('upgrades a websocket with a Token and completes the SignalR handshake', async () => {
    const res = await SELF.fetch(url(`/notifications/anonymous-hub?Token=${crypto.randomUUID()}`), {
      headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '203.0.113.7' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    expect(ws).toBeTruthy();
    ws!.accept();

    const acked = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('handshake ack timeout')), 4000);
      ws!.addEventListener('message', (event: MessageEvent) => {
        const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        if (data.startsWith('{}')) {
          clearTimeout(timer);
          resolve(data);
        }
      });
    });
    ws!.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    expect(await acked).toContain('{}');
    ws!.close();
  });
});

describe('negotiate via query access_token', () => {
  it('accepts the token from the access_token query parameter', async () => {
    const res = await SELF.fetch(
      url(`/notifications/hub/negotiate?access_token=${encodeURIComponent(session.accessToken)}`),
      { method: 'POST', headers: baseHeaders() }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.connectionId).toBe('string');
  });
});
