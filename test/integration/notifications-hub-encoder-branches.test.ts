import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// The MessagePack encoder's wider branches (multi-byte integers, >255-char
// strings, booleans) and the binary-incoming decode path only run when a real
// notification with those value shapes is pushed to a connected messagepack
// client. We connect a WS through the worker (routed to the per-user
// NOTIFICATIONS_HUB DO by user id) and push a custom payload to that same DO via
// its /internal/notify endpoint, then assert the encoded frame arrives. Real DO,
// no mocks.
let session: Session;
let userId: string;

const RS = String.fromCharCode(0x1e);

beforeAll(async () => {
  session = await authenticate('hubencoder');
  userId = ((await (await api('GET', '/api/accounts/profile', session.accessToken)).json()) as any).id;
});

function hubStub() {
  const id = (env as any).NOTIFICATIONS_HUB.idFromName(userId);
  return (env as any).NOTIFICATIONS_HUB.get(id);
}

async function connect(): Promise<WebSocket> {
  const res = await SELF.fetch(url('/notifications/hub'), {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${session.accessToken}`, 'CF-Connecting-IP': '203.0.113.9' },
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
    if (typeof event.data === 'string') buffer.push({ text: event.data, bytes: null });
    else buffer.push({ text: null, bytes: new Uint8Array(event.data as ArrayBuffer) });
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

function bytesContain(haystack: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

function isHandshakeAck(f: Frame): boolean {
  const s = f.text ?? (f.bytes ? new TextDecoder().decode(f.bytes) : '');
  return s.startsWith('{}');
}

function notify(payload: Record<string, unknown>): Promise<Response> {
  return hubStub().fetch('https://notifications/internal/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-NodeWarden-UserId': userId },
    body: JSON.stringify({ userId, updateType: 5, payload }),
  });
}

describe('notifications hub — messagepack encoder branches', () => {
  it('encodes multi-byte integers, a long string, and a boolean for a connected client', async () => {
    const ws = await connect();
    const waitFor = collector(ws);
    ws.send(`{"protocol":"messagepack","version":1}${RS}`);
    await waitFor(isHandshakeAck);

    const longNote = 'x'.repeat(300); // > 255 chars -> 0xda string header
    const res = await notify({
      Type: 5,
      U8: 200, // 128..255 -> 0xcc
      U16: 5000, // 256..65535 -> 0xcd
      U32: 70000, // > 65535 -> 0xce
      Note: longNote,
      Flag: true, // boolean
      Off: false,
    });
    expect(res.status).toBe(204);

    const frame = await waitFor((f) => f.bytes !== null && bytesContain(f.bytes, 'ReceiveMessage'));
    // The long string alone guarantees a sizeable frame, confirming it was encoded.
    expect(frame.bytes!.byteLength).toBeGreaterThan(longNote.length);
    expect(bytesContain(frame.bytes!, longNote)).toBe(true);

    ws.close();
  });

  it('handles a binary frame sent before the handshake, then completes normally', async () => {
    const ws = await connect();
    const waitFor = collector(ws);
    // Binary frame pre-handshake -> decodeIncomingMessage's ArrayBuffer branch;
    // it is not valid JSON, so it is ignored and the handshake still completes.
    ws.send(new Uint8Array([0x81, 0x01, 0x02]).buffer);
    ws.send(`{"protocol":"messagepack","version":1}${RS}`);
    await waitFor(isHandshakeAck);
    ws.close();
  });

  it('encodes a messagepack auth-request-response to a connected anonymous client', async () => {
    // The existing auth-push test uses the JSON protocol; this drives the
    // MessagePack branch of broadcastAuthRequestResponse end to end.
    const created = (await (await SELF.fetch(url('/api/auth-requests'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', 'X-Request-Email': session.account.email }),
      body: JSON.stringify({
        email: session.account.email,
        publicKey: 'cHVibGljLWtleQ==',
        accessCode: crypto.randomUUID().slice(0, 24),
        deviceIdentifier: crypto.randomUUID(),
        type: 0,
      }),
    })).json()) as any;
    expect(typeof created.id).toBe('string');

    const upgrade = await SELF.fetch(url(`/notifications/anonymous-hub?Token=${created.id}`), {
      headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '203.0.113.9' },
    });
    expect(upgrade.status).toBe(101);
    const ws = upgrade.webSocket!;
    ws.accept();
    const waitFor = collector(ws);
    ws.send(`{"protocol":"messagepack","version":1}${RS}`);
    await waitFor(isHandshakeAck);

    const approve = await api('PUT', `/api/auth-requests/${created.id}`, session.accessToken, {
      requestApproved: true, key: ENC_STRING, deviceIdentifier: session.account.deviceIdentifier,
    });
    expect(approve.status).toBe(200);

    const push = await waitFor((f) => f.bytes !== null && bytesContain(f.bytes, 'AuthRequestResponseRecieved'));
    expect(push.bytes!.byteLength).toBeGreaterThan(0);
    ws.close();
  });
});
