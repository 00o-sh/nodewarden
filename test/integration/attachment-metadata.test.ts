import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, enc } from './helpers';

// Attachment metadata rename (fileName/key) and the POST-style delete route,
// plus their validation and not-found paths.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('attachmeta');
  token = session.accessToken;
});

async function createAttachment(): Promise<{ cipherId: string; attachmentId: string }> {
  const cipher = await createCipher(token);
  const bytes = new TextEncoder().encode('meta-content');
  const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
    fileName: ENC_STRING,
    key: ENC_STRING,
    fileSize: bytes.byteLength,
  });
  const { attachmentId, url: uploadUrl } = (await reserve.json()) as any;
  const up = await SELF.fetch(uploadUrl, {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: bytes,
  });
  expect(up.status).toBe(201);
  return { cipherId: cipher.id, attachmentId };
}

describe('attachment metadata', () => {
  it('updates the attachment fileName and key', async () => {
    const { cipherId, attachmentId } = await createAttachment();
    const renamed = enc('renamed-file');

    const res = await api('PUT', `/api/ciphers/${cipherId}/attachment/${attachmentId}/metadata`, token, {
      fileName: renamed,
      key: enc('newkey'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.fileName).toBe(renamed);
    expect(body.key).toBe(enc('newkey'));
  });

  it('rejects an update with no fields (400) and an empty fileName (400)', async () => {
    const { cipherId, attachmentId } = await createAttachment();
    expect((await api('PUT', `/api/ciphers/${cipherId}/attachment/${attachmentId}/metadata`, token, {})).status).toBe(400);
    expect((await api('PUT', `/api/ciphers/${cipherId}/attachment/${attachmentId}/metadata`, token, { fileName: '' })).status).toBe(400);
  });

  it('returns 404 for a missing attachment or cipher', async () => {
    const { cipherId } = await createAttachment();
    expect((await api('PUT', `/api/ciphers/${cipherId}/attachment/${crypto.randomUUID()}/metadata`, token, { fileName: enc('x') })).status).toBe(404);
    expect((await api('PUT', `/api/ciphers/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}/metadata`, token, { fileName: enc('x') })).status).toBe(404);
  });

  it('deletes an attachment via the POST delete route', async () => {
    const { cipherId, attachmentId } = await createAttachment();
    const del = await api('POST', `/api/ciphers/${cipherId}/attachment/${attachmentId}/delete`, token, {});
    expect([200, 204]).toContain(del.status);
    expect((await api('GET', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token)).status).toBe(404);
  });
});
