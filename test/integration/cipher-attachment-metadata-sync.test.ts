import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, enc } from './helpers';

// The attachment-metadata merge applied during a cipher update (key-rotation /
// re-encryption): the attachments2 object map, the attachments2 array form, and
// the legacy attachments filename map. Real D1/R2, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipher-attach-sync');
  token = session.accessToken;
});

async function cipherWithAttachment(): Promise<{ cipherId: string; attachmentId: string }> {
  const cipher = await createCipher(token);
  const bytes = new TextEncoder().encode('attachment-content');
  const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
    fileName: ENC_STRING, key: ENC_STRING, fileSize: bytes.byteLength,
  });
  const { attachmentId, url } = (await reserve.json()) as any;
  const up = await SELF.fetch(url, { method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: bytes });
  expect(up.status).toBe(201);
  return { cipherId: cipher.id, attachmentId };
}

async function attachmentMeta(cipherId: string, attachmentId: string): Promise<any> {
  return (await (await api('GET', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token)).json()) as any;
}

const baseUpdate = { type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] } };

describe('cipher update attachment metadata sync', () => {
  it('applies attachments2 as an object map', async () => {
    const { cipherId, attachmentId } = await cipherWithAttachment();
    const newName = enc('renamed');
    const newKey = enc('rotated-key');

    const res = await api('PUT', `/api/ciphers/${cipherId}`, token, {
      ...baseUpdate,
      attachments2: { [attachmentId]: { fileName: newName, key: newKey, fileSize: 4242 } },
    });
    expect(res.status).toBe(200);

    const meta = await attachmentMeta(cipherId, attachmentId);
    expect(meta.fileName).toBe(newName);
    expect(meta.key).toBe(newKey);
    expect(meta.size).toBe('4242');
  });

  it('applies attachments2 as an array', async () => {
    const { cipherId, attachmentId } = await cipherWithAttachment();
    const newName = enc('array-renamed');

    const res = await api('PUT', `/api/ciphers/${cipherId}`, token, {
      ...baseUpdate,
      attachments2: [{ id: attachmentId, fileName: newName }],
    });
    expect(res.status).toBe(200);
    expect((await attachmentMeta(cipherId, attachmentId)).fileName).toBe(newName);
  });

  it('applies the legacy attachments filename map', async () => {
    const { cipherId, attachmentId } = await cipherWithAttachment();
    const newName = enc('legacy-renamed');

    const res = await api('PUT', `/api/ciphers/${cipherId}`, token, {
      ...baseUpdate,
      attachments: { [attachmentId]: newName },
    });
    expect(res.status).toBe(200);
    expect((await attachmentMeta(cipherId, attachmentId)).fileName).toBe(newName);
  });

  it('ignores metadata for an unknown attachment id', async () => {
    const { cipherId, attachmentId } = await cipherWithAttachment();
    const res = await api('PUT', `/api/ciphers/${cipherId}`, token, {
      ...baseUpdate,
      attachments2: { [crypto.randomUUID()]: { fileName: enc('ghost') } },
    });
    expect(res.status).toBe(200);
    // The real attachment is untouched.
    expect((await attachmentMeta(cipherId, attachmentId)).fileName).toBe(ENC_STRING);
  });
});
