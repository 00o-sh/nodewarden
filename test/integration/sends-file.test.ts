import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc } from './helpers';

// File-send creation and the direct R2 upload path (sends-private + blob store).
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendfile');
  token = session.accessToken;
});

function fileSendBody(bytesLen: number, overrides: Record<string, unknown> = {}) {
  return {
    type: 1, // File
    name: enc('file-send'),
    key: ENC_STRING,
    fileLength: bytesLen,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: enc('document'), size: bytesLen },
    ...overrides,
  };
}

describe('file send', () => {
  it('reserves a file send and uploads the bytes to R2', async () => {
    const bytes = new TextEncoder().encode('encrypted-send-file-content');

    const reserve = await api('POST', '/api/sends/file/v2', token, fileSendBody(bytes.byteLength));
    expect(reserve.status).toBe(200);
    const body = (await reserve.json()) as any;
    expect(body.object).toBe('send-fileUpload');
    expect(body.sendResponse.type).toBe(1);
    const sendId = body.sendResponse.id;
    expect(typeof body.url).toBe('string');

    // Upload to the direct-upload URL (token is embedded in the URL).
    const upload = await SELF.fetch(body.url, {
      method: 'POST',
      headers: baseHeaders(),
      body: bytes,
    });
    expect([200, 201]).toContain(upload.status);

    // The authenticated upload-info endpoint returns a fresh upload URL.
    const fileId = new URL(body.url).pathname.split('/file/')[1];
    const info = await api('GET', `/api/sends/${sendId}/file/${fileId}`, token);
    expect(info.status).toBe(200);
    expect((await info.json()).object).toBe('send-fileUpload');
  });

  it('rejects a file send on the text-only /api/sends endpoint', async () => {
    // /api/sends create rejects file type (must use /file/v2).
    const res = await api('POST', '/api/sends', token, fileSendBody(10));
    expect(res.status).toBe(400);
  });

  it('requires a name (400)', async () => {
    const res = await api('POST', '/api/sends/file/v2', token, fileSendBody(10, { name: '' }));
    expect(res.status).toBe(400);
  });
});
