import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// Branches of the v2 send-access/download handlers that require a real
// send_access grant: accessing a non-file send through the file endpoint (type
// mismatch -> 404) and downloading a file send whose blob was never uploaded
// (missing object -> 404). Real grant + R2, no mocks.
let session: Session;
let token: string;

const futureDeletion = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function sendAccessToken(sendId: string): Promise<string> {
  const grant = await SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({ grant_type: 'send_access', send_id: sendId }).toString(),
  });
  expect(grant.status).toBe(200);
  return ((await grant.json()) as any).access_token as string;
}

beforeAll(async () => {
  session = await authenticate('sendsv2branches');
  token = session.accessToken;
});

describe('v2 send-access handler branches', () => {
  it('404s the file-access endpoint for a non-file (text) send', async () => {
    const textSend = (await (await api('POST', '/api/sends', token, {
      type: 0, name: ENC_STRING, key: ENC_STRING, deletionDate: futureDeletion(),
      text: { text: ENC_STRING, hidden: false },
    })).json()) as any;
    const accessToken = await sendAccessToken(textSend.id);
    const res = await SELF.fetch(url(`/api/sends/access/file/${crypto.randomUUID()}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${accessToken}` }),
    });
    expect(res.status).toBe(404);
  });

  it('404s downloading a file send whose blob was never uploaded', async () => {
    const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
      type: 1, name: enc('file'), key: ENC_STRING, fileLength: 16, deletionDate: futureDeletion(),
      file: { fileName: enc('doc'), size: 16 },
    })).json()) as any;
    const sendId = reserve.sendResponse.id;
    const fileId = new URL(reserve.url).pathname.split('/file/')[1];

    // Skip the upload, then mint a real download token via the access flow.
    const accessToken = await sendAccessToken(sendId);
    const accessFile = await SELF.fetch(url(`/api/sends/access/file/${fileId}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${accessToken}` }),
    });
    expect(accessFile.status).toBe(200);
    const downloadUrl = ((await accessFile.json()) as any).url as string;

    // The token is valid and matches, but the R2 object is missing -> 404.
    const download = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
    expect(download.status).toBe(404);
  });
});
