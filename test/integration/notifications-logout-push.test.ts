import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, url } from './helpers';

// The logout broadcast: a connected authenticated socket receives a LogOut
// (Type 11) push when the account deletes all its devices. Real DO + real WS,
// no mocks.
let session: Session;

beforeAll(async () => {
  session = await authenticate('notiflogout');
});

const RECORD_SEPARATOR = String.fromCharCode(0x1e);

describe('logout broadcast', () => {
  it('pushes a LogOut notification to a connected socket on delete-all-devices', async () => {
    const upgrade = await SELF.fetch(url('/notifications/hub'), {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${session.accessToken}`, 'CF-Connecting-IP': '203.0.113.10' },
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

    // Deleting all devices broadcasts a LogOut to every connected socket.
    expect((await api('DELETE', '/api/devices', session.accessToken)).status).toBe(200);

    const push = await waitFor((m) => m.includes('"Type":11'));
    const frame = JSON.parse(push.replace(RECORD_SEPARATOR, ''));
    expect(frame.arguments[0].Type).toBe(11);
    ws.close();
  });
});
