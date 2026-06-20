import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher } from './helpers';

// Attachment lifecycle against the R2 binding: reserve (v2) -> upload bytes ->
// get a download URL -> download -> delete.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('attach');
  token = session.accessToken;
});

describe('attachment lifecycle', () => {
  it('reserves, uploads, downloads, and deletes an attachment', async () => {
    const cipher = await createCipher(token);
    const fileBytes = new TextEncoder().encode('encrypted-attachment-content');

    // 1. Reserve the attachment (v2 returns a direct-upload URL).
    const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
      fileName: ENC_STRING,
      key: ENC_STRING,
      fileSize: fileBytes.byteLength,
    });
    expect(reserve.status).toBe(200);
    const { attachmentId, url } = (await reserve.json()) as any;
    expect(typeof attachmentId).toBe('string');
    expect(typeof url).toBe('string');

    // 2. Upload the encrypted bytes to the direct-upload URL.
    const upload = await SELF.fetch(url, {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: fileBytes,
    });
    expect(upload.status).toBe(201);

    // 3. Request a download URL for the attachment.
    const meta = await api('GET', `/api/ciphers/${cipher.id}/attachment/${attachmentId}`, token);
    expect(meta.status).toBe(200);
    const downloadUrl = ((await meta.json()) as any).url as string;
    expect(downloadUrl).toContain('token=');

    // 4. Download the bytes (public, token-authorized) and verify the content.
    const download = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(fileBytes);

    // 5. Delete the attachment.
    const del = await api('DELETE', `/api/ciphers/${cipher.id}/attachment/${attachmentId}`, token);
    expect([200, 204]).toContain(del.status);
    expect((await api('GET', `/api/ciphers/${cipher.id}/attachment/${attachmentId}`, token)).status).toBe(404);
  });

  it('rejects reserving an attachment without fileName/key (400)', async () => {
    const cipher = await createCipher(token);
    const res = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, { fileSize: 10 });
    expect(res.status).toBe(400);
  });

  it('returns 404 reserving an attachment on a missing cipher', async () => {
    const res = await api('POST', `/api/ciphers/${crypto.randomUUID()}/attachment/v2`, token, {
      fileName: ENC_STRING,
      key: ENC_STRING,
      fileSize: 1,
    });
    expect(res.status).toBe(404);
  });
});
