import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, createCipher, url } from './helpers';

// MessagePack SignalR path on the real NotificationsHub Durable Object: complete
// a messagepack handshake, then trigger a vault change and receive the binary
// invocation frame (exercising the full MessagePack encoder), plus the
// post-handshake binary echo branch. Complements the JSON-protocol suite.
let session: Session;

beforeAll(async () => {
  session = await authenticate('notifympack');
});

const RECORD_SEPARATOR = String.fromCharCode(0x1e);

async function connect(token: string): Promise<WebSocket> {
  const res = await SELF.fetch(url('/notifications/hub'), {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '203.0.113.7' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  return ws;
}

interface Frame { text: string | null; bytes: Uint8Array | null; }

function collector(ws: WebSocket) {
  const buffer: Frame[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data === 'string') {
      buffer.push({ text: event.data, bytes: null });
    } else {
      buffer.push({ text: null, bytes: new Uint8Array(event.data as ArrayBuffer) });
    }
  });
  return async function waitFor(pred: (f: Frame) => boolean, timeoutMs = 4000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = buffer.find(pred);
      if (found) return found;
      if (Date.now() > deadline) throw new Error('timeout waiting for frame');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
}

// Locate an ASCII needle inside a byte array (the msgpack frame embeds the
// "ReceiveMessage" target as a UTF-8 string).
function bytesContain(haystack: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (haystack[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
}

// The SignalR handshake ack ("{}" + record separator) is delivered as a binary
// frame; accept it whether surfaced as text or bytes.
function isHandshakeAck(f: Frame): boolean {
  const s = f.text ?? (f.bytes ? new TextDecoder().decode(f.bytes) : '');
  return s.startsWith('{}');
}

describe('notifications hub — messagepack protocol', () => {
  it('completes a messagepack handshake and pushes a binary invocation frame', async () => {
    const ws = await connect(session.accessToken);
    const waitFor = collector(ws);

    ws.send(`{"protocol":"messagepack","version":1}${RECORD_SEPARATOR}`);
    // The handshake ack is the empty-object frame, delivered as binary bytes.
    await waitFor(isHandshakeAck);

    await createCipher(session.accessToken);
    const push = await waitFor((f) => f.bytes !== null && bytesContain(f.bytes, 'ReceiveMessage'));
    expect(push.bytes!.byteLength).toBeGreaterThan(0);

    ws.close();
  });

  it('echoes a post-handshake binary frame back to the sender', async () => {
    const ws = await connect(session.accessToken);
    const waitFor = collector(ws);

    ws.send(`{"protocol":"messagepack","version":1}${RECORD_SEPARATOR}`);
    await waitFor(isHandshakeAck);

    const probe = new Uint8Array([0x91, 0x06]); // a small msgpack-shaped payload
    ws.send(probe);
    const echoed = await waitFor((f) => f.bytes !== null && f.bytes.length === probe.length && f.bytes[0] === 0x91 && f.bytes[1] === 0x06);
    expect(echoed.bytes).toEqual(probe);

    ws.close();
  });
});
