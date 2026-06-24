import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, url } from './helpers';

// Connecting with the SignalR MessagePack protocol makes the NotificationsHub
// encode every push through its hand-written MessagePack encoder (integers,
// strings, arrays, maps, nulls). Existing notification tests use the JSON
// protocol, so this drives the binary path. Real DO + real WebSocket, no mocks.
let session: Session;

beforeAll(async () => {
  session = await authenticate('notifmsgpack');
});

const RECORD_SEPARATOR = String.fromCharCode(0x1e);

describe('MessagePack notification protocol', () => {
  it('delivers a binary MessagePack-encoded push to a connected socket', async () => {
    const upgrade = await SELF.fetch(url('/notifications/hub'), {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${session.accessToken}`, 'CF-Connecting-IP': '203.0.113.60' },
    });
    expect(upgrade.status).toBe(101);
    const ws = upgrade.webSocket!;
    ws.accept();

    const binaryFrames: Uint8Array[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') binaryFrames.push(new Uint8Array(event.data as ArrayBuffer));
    });

    // The SignalR handshake frame is JSON text; selecting the messagepack
    // protocol makes the handshake ack and every later push arrive as binary.
    ws.send(`{"protocol":"messagepack","version":1}${RECORD_SEPARATOR}`);

    async function waitFor<T>(get: () => T | undefined, timeoutMs = 4000): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = get();
        if (hit !== undefined) return hit;
        if (Date.now() > deadline) throw new Error('timeout waiting for frame');
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // The 3-byte binary handshake ack ({}\x1e) arrives first.
    await waitFor(() => binaryFrames.find((f) => f.byteLength === 3));

    // Deleting all devices broadcasts a LogOut push to every connected socket,
    // encoded via the MessagePack invocation builder for this connection.
    expect((await api('DELETE', '/api/devices', session.accessToken)).status).toBe(200);

    // The push is a framed MessagePack invocation, much larger than the ack.
    const frame = await waitFor(() => binaryFrames.find((f) => f.byteLength > 8));
    expect(frame.byteLength).toBeGreaterThan(8);
    ws.close();
  });
});
