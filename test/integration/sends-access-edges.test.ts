import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// Public send-access edge branches: the email-auth gate (unsupported -> 404),
// the v2 file-access file-id mismatch, and v2 access of an exhausted send.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendedge');
  token = session.accessToken;
});

async function sendAccessToken(sendId: string): Promise<string> {
  const res = await SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({ grant_type: 'send_access', send_id: sendId }).toString(),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).access_token as string;
}

describe('email-auth send', () => {
  it('refuses public access to an email-authenticated send (404)', async () => {
    const created = (await (await api('POST', '/api/sends', token, {
      type: 0, name: enc('s'), key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: enc('secret'), hidden: false },
      authType: 0, // SendAuthType.Email
      emails: ['recipient@vault.test'],
    })).json()) as any;

    const res = await SELF.fetch(url(`/api/sends/access/${created.accessId}`), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});

describe('v2 send access edges', () => {
  it('404s a v2 file access with a mismatched file id', async () => {
    const bytes = new TextEncoder().encode('file-bytes');
    const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
      type: 1, name: enc('f'), key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      fileLength: bytes.byteLength, file: { fileName: enc('doc'), size: bytes.byteLength },
    })).json()) as any;
    expect((await SELF.fetch(reserve.url, { method: 'POST', headers: baseHeaders(), body: bytes })).status).toBeLessThan(300);

    const accessToken = await sendAccessToken(reserve.sendResponse.id);
    const res = await SELF.fetch(url(`/api/sends/access/file/${crypto.randomUUID()}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${accessToken}` }),
    });
    expect(res.status).toBe(404);
  });

  it('404s a v2 access once the send is exhausted', async () => {
    const created = (await (await api('POST', '/api/sends', token, {
      type: 0, name: enc('s'), key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: enc('secret'), hidden: false },
      maxAccessCount: 1,
    })).json()) as any;
    const accessToken = await sendAccessToken(created.id);

    const access = () => SELF.fetch(url('/api/sends/access'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }),
      body: '{}',
    });

    expect((await access()).status).toBe(200); // first access consumes the single allowance
    expect((await access()).status).toBe(404); // now exhausted
  });
});
