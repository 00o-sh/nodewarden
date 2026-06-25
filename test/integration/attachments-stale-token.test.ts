import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher } from './helpers';

// The public (token-authorized) attachment upload re-checks the cipher and
// attachment at upload time. If the cipher was permanently deleted, or the
// attachment removed, after the upload token was minted, the upload 404s even
// though the token is valid. Recreates a real delete-between-reserve-and-upload
// race. Real D1, no mocks.
let session: Session;
let token: string;

async function reserve(cipherId: string): Promise<{ url: string; attachmentId: string }> {
  const res = await api('POST', `/api/ciphers/${cipherId}/attachment/v2`, token, {
    fileName: ENC_STRING, key: ENC_STRING, fileSize: 8,
  });
  const body = (await res.json()) as any;
  return { url: body.url, attachmentId: body.attachmentId };
}

function upload(uploadUrl: string): Promise<Response> {
  return SELF.fetch(uploadUrl, {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/octet-stream', 'Content-Length': '8' }),
    body: new Uint8Array(8),
  });
}

beforeAll(async () => {
  session = await authenticate('attachstaletoken');
  token = session.accessToken;
});

describe('public attachment upload with a stale token', () => {
  it('404s when the cipher was permanently deleted after reserving', async () => {
    const cipher = await createCipher(token);
    const { url } = await reserve(cipher.id);
    expect((await api('POST', '/api/ciphers/delete-permanent', token, { ids: [cipher.id] })).status).toBeLessThan(300);
    expect((await upload(url)).status).toBe(404);
  });

  it('404s when the attachment was deleted after reserving', async () => {
    const cipher = await createCipher(token);
    const { url, attachmentId } = await reserve(cipher.id);
    expect((await api('DELETE', `/api/ciphers/${cipher.id}/attachment/${attachmentId}`, token)).status).toBeLessThan(300);
    expect((await upload(url)).status).toBe(404);
  });
});
