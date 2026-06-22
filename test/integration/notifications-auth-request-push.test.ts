import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// End-to-end auth-request approval push: an anonymous device opens a real
// WebSocket to the auth-request's hub, the account approves the request, and
// the hub broadcasts the auth-request-response over that socket. Real DO +
// real WS, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('authpush');
  token = session.accessToken;
});

const RECORD_SEPARATOR = String.fromCharCode(0x1e);

describe('auth-request approval broadcast', () => {
  it('pushes the auth-request-response to a connected anonymous socket', async () => {
    // 1. The signing-in device creates an auth request.
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

    // 2. The device opens the anonymous notifications socket keyed by the request id.
    const upgrade = await SELF.fetch(url(`/notifications/anonymous-hub?Token=${created.id}`), {
      headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '203.0.113.9' },
    });
    expect(upgrade.status).toBe(101);
    const ws = upgrade.webSocket!;
    ws.accept();

    const messages: string[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      messages.push(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
    });
    ws.send(`{"protocol":"json","version":1}${RECORD_SEPARATOR}`);

    async function waitFor(pred: (m: string) => boolean, timeoutMs = 4000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = messages.find(pred);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`timeout; got ${JSON.stringify(messages)}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await waitFor((m) => m.startsWith('{}')); // handshake ack

    // 3. The account approves the request -> the hub broadcasts to the socket.
    const approve = await api('PUT', `/api/auth-requests/${created.id}`, token, {
      requestApproved: true, key: ENC_STRING, deviceIdentifier: session.account.deviceIdentifier,
    });
    expect(approve.status).toBe(200);

    // 4. The socket receives the auth-request-response invocation (Type 16),
    //    carrying the request id.
    const push = await waitFor((m) => m.includes('AuthRequestResponseRecieved'));
    const frame = JSON.parse(push.replace(RECORD_SEPARATOR, ''));
    expect(frame.arguments[0].Type).toBe(16);
    expect(frame.arguments[0].Payload.Id).toBe(created.id);
    ws.close();
  });
});
