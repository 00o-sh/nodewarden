import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, createCipher, url } from './helpers';

// Real WebSocket against the NotificationsHub Durable Object: connect, complete
// the SignalR handshake, then trigger a vault change and receive the broadcast
// push. No mocks — a genuine WS to the actual DO.
let session: Session;

beforeAll(async () => {
  session = await authenticate('notifyws');
});

const RECORD_SEPARATOR = String.fromCharCode(0x1e);

async function connect(token: string): Promise<WebSocket> {
  const res = await SELF.fetch(url('/notifications/hub'), {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '203.0.113.7' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).toBeTruthy();
  ws!.accept();
  return ws!;
}

function collector(ws: WebSocket) {
  const buffer: string[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    buffer.push(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
  });
  return async function waitFor(pred: (m: string) => boolean, timeoutMs = 4000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = buffer.find(pred);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timeout; received: ${JSON.stringify(buffer)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
}

describe('notifications hub websocket', () => {
  it('completes the SignalR handshake and pushes a vault-sync notification', async () => {
    const ws = await connect(session.accessToken);
    const waitFor = collector(ws);

    // SignalR JSON handshake -> the hub replies with an empty-object ack frame.
    ws.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);
    await waitFor((m) => m.startsWith('{}'));

    // A vault change broadcasts a SignalR invocation (Type 5 = SyncVault).
    await createCipher(session.accessToken);
    const push = await waitFor((m) => m.includes('"Type":5'));
    const frame = JSON.parse(push.replace(RECORD_SEPARATOR, ''));
    expect(frame.target).toBe('ReceiveMessage');
    expect(frame.arguments[0].Type).toBe(5);

    ws.close();
  });

  it('rejects an unauthenticated websocket connection (401)', async () => {
    const res = await SELF.fetch(url('/notifications/hub'), {
      headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '203.0.113.7' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a non-websocket request to the hub (426)', async () => {
    const res = await SELF.fetch(url('/notifications/hub'), {
      headers: { Authorization: `Bearer ${session.accessToken}`, 'CF-Connecting-IP': '203.0.113.7' },
    });
    expect(res.status).toBe(426);
  });
});
