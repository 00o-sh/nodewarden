import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// The v2 send-access endpoint (POST /api/sends/access) authenticated by a
// send_access bearer token minted via the send_access grant.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendv2');
  token = session.accessToken;
});

async function createTextSend(): Promise<any> {
  const res = await api('POST', '/api/sends', token, {
    type: 0,
    name: enc('s'),
    key: ENC_STRING,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    text: { text: enc('secret'), hidden: false },
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function sendAccessToken(sendId: string): Promise<string> {
  const res = await SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({ grant_type: 'send_access', send_id: sendId }).toString(),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).access_token;
}

describe('send access v2', () => {
  it('serves a send for a valid send_access bearer token', async () => {
    const send = await createTextSend();
    const accessToken = await sendAccessToken(send.id);

    const res = await SELF.fetch(url('/api/sends/access'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id ?? body.Id).toBeTruthy();
  });

  it('rejects the v2 access endpoint without a token (401)', async () => {
    const res = await SELF.fetch(url('/api/sends/access'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('rejects a send_access grant for an unknown send', async () => {
    const res = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ grant_type: 'send_access', send_id: crypto.randomUUID() }).toString(),
    });
    expect(res.status).not.toBe(200);
  });
});
