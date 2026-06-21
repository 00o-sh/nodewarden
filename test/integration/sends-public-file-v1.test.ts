import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// The v1 public file-access path: POST /api/sends/:idOrAccessId/access/file/:fileId
// (resolve by send id or access id, gate on password, mint a one-time download
// token). Complements the v2 (bearer) file access already covered elsewhere.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendpubfile');
  token = session.accessToken;
});

async function reserveAndUpload(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1,
    name: enc('file-send'),
    key: ENC_STRING,
    fileLength: bytes.byteLength,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: enc('doc'), size: bytes.byteLength },
    ...overrides,
  })).json()) as any;
  const fileId = new URL(reserve.url).pathname.split('/file/')[1];
  const up = await SELF.fetch(reserve.url, { method: 'POST', headers: baseHeaders(), body: bytes });
  expect(up.status).toBeLessThan(300);
  return { sendId: reserve.sendResponse.id as string, accessId: reserve.sendResponse.accessId as string, fileId };
}

function accessFileV1(idOrAccessId: string, fileId: string, body: unknown = {}): Promise<Response> {
  return SELF.fetch(url(`/api/sends/${idOrAccessId}/access/file/${fileId}`), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

describe('v1 public file access', () => {
  it('grants a download URL by send id and by access id, and the bytes round-trip', async () => {
    const bytes = new TextEncoder().encode('v1-file-access-content');
    const { sendId, accessId, fileId } = await reserveAndUpload(bytes);

    for (const ref of [sendId, accessId]) {
      const res = await accessFileV1(ref, fileId);
      expect(res.status).toBe(200);
      const downloadUrl = ((await res.json()) as any).url as string;
      expect(downloadUrl).toContain('t=');
      const dl = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
      expect(dl.status).toBe(200);
      expect(new Uint8Array(await dl.arrayBuffer())).toEqual(bytes);
    }
  });

  it('404s for a wrong file id or a non-file send', async () => {
    const { sendId } = await reserveAndUpload(new TextEncoder().encode('x'));
    expect((await accessFileV1(sendId, crypto.randomUUID())).status).toBe(404);

    // A text send is not a file send.
    const textSend = (await (await api('POST', '/api/sends', token, {
      type: 0, name: enc('t'), key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: enc('secret'), hidden: false },
    })).json()) as any;
    expect((await accessFileV1(textSend.id, crypto.randomUUID())).status).toBe(404);
  });

  it('gates a password-protected file send', async () => {
    const password = `pw-${crypto.randomUUID()}`;
    const bytes = new TextEncoder().encode('secret-file');
    const { sendId, fileId } = await reserveAndUpload(bytes, { password });

    // No password / wrong password -> not granted.
    expect((await accessFileV1(sendId, fileId, {})).status).not.toBe(200);
    expect((await accessFileV1(sendId, fileId, { password: 'nope' })).status).not.toBe(200);
    // Correct password -> granted.
    expect((await accessFileV1(sendId, fileId, { password })).status).toBe(200);
  });
});
