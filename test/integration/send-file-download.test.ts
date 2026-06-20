import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// End-to-end file Send retrieval: create -> upload (R2) -> send_access grant ->
// access-file (mint download token) -> download bytes. Covers sends-public file
// access, the send_access grant, and the streaming download handler.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendfiledl');
  token = session.accessToken;
});

describe('file send download flow', () => {
  it('reserves, uploads, grants access, and downloads the file', async () => {
    const bytes = new TextEncoder().encode('top-secret-encrypted-bytes');

    // Reserve + upload.
    const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
      type: 1,
      name: enc('file-send'),
      key: ENC_STRING,
      fileLength: bytes.byteLength,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      file: { fileName: enc('doc'), size: bytes.byteLength },
    })).json()) as any;
    const sendId = reserve.sendResponse.id;
    const fileId = new URL(reserve.url).pathname.split('/file/')[1];
    expect((await SELF.fetch(reserve.url, { method: 'POST', headers: baseHeaders(), body: bytes })).status).toBeLessThan(300);

    // send_access grant -> a scoped access token for this send.
    const grant = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ grant_type: 'send_access', send_id: sendId }).toString(),
    });
    expect(grant.status).toBe(200);
    const accessToken = ((await grant.json()) as any).access_token;
    expect(typeof accessToken).toBe('string');

    // Exchange the access token for a one-time download URL.
    const accessFile = await SELF.fetch(url(`/api/sends/access/file/${fileId}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${accessToken}` }),
    });
    expect(accessFile.status).toBe(200);
    const downloadUrl = ((await accessFile.json()) as any).url as string;
    expect(downloadUrl).toContain('t=');

    // Download and verify the bytes round-trip through R2.
    const download = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  it('rejects access-file without a valid send_access token (401)', async () => {
    const res = await SELF.fetch(url(`/api/sends/access/file/${crypto.randomUUID()}`), {
      method: 'POST',
      headers: baseHeaders(),
    });
    expect(res.status).toBe(401);
  });
});
