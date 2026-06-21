import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher } from './helpers';

// Attachment branches the lifecycle suite misses: the one-time download token
// (second use rejected), the public upload-token mismatch, and clearing an
// attachment key via the metadata endpoint. Real R2/D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('attach-extra');
  token = session.accessToken;
});

async function reserveAndUpload(cipherId: string, bytes: Uint8Array): Promise<{ attachmentId: string; uploadUrl: string }> {
  const reserve = await api('POST', `/api/ciphers/${cipherId}/attachment/v2`, token, {
    fileName: ENC_STRING, key: ENC_STRING, fileSize: bytes.byteLength,
  });
  expect(reserve.status).toBe(200);
  const { attachmentId, url } = (await reserve.json()) as any;
  const up = await SELF.fetch(url, { method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: bytes });
  expect(up.status).toBe(201);
  return { attachmentId, uploadUrl: url };
}

describe('attachment download token is one-time', () => {
  it('rejects reusing a download token after the first download', async () => {
    const cipher = await createCipher(token);
    const bytes = new TextEncoder().encode('one-time-content');
    const { attachmentId } = await reserveAndUpload(cipher.id, bytes);

    const meta = await api('GET', `/api/ciphers/${cipher.id}/attachment/${attachmentId}`, token);
    const downloadUrl = ((await meta.json()) as any).url as string;

    const first = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);

    // The same token cannot be used a second time.
    const second = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
    expect(second.status).toBe(401);
  });
});

describe('public upload token mismatch', () => {
  it('rejects an upload token used against a different attachment id', async () => {
    const cipher = await createCipher(token);
    const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
      fileName: ENC_STRING, key: ENC_STRING, fileSize: 4,
    });
    const { attachmentId, url } = (await reserve.json()) as any;
    // Swap the attachment id in the path while keeping the (now-mismatched) token.
    const tamperedUrl = url.replace(attachmentId, crypto.randomUUID());
    const res = await SELF.fetch(tamperedUrl, {
      method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: new Uint8Array(4),
    });
    expect(res.status).toBe(401);
  });
});

describe('attachment metadata key clearing', () => {
  it('clears the attachment key when metadata is updated with key: null', async () => {
    const cipher = await createCipher(token);
    const { attachmentId } = await reserveAndUpload(cipher.id, new TextEncoder().encode('x'));

    const res = await api('PUT', `/api/ciphers/${cipher.id}/attachment/${attachmentId}/metadata`, token, { key: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).key).toBeNull();
  });
});
