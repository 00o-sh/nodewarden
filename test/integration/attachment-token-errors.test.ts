import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, url } from './helpers';

// Public attachment token paths: a download token used against the wrong
// attachment, a download of a reserved-but-never-uploaded attachment (no R2
// object), and the public upload token guards.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('attachtok');
  token = session.accessToken;
});

async function reserve(cipherId: string, size: number): Promise<string> {
  const res = await api('POST', `/api/ciphers/${cipherId}/attachment/v2`, token, {
    fileName: ENC_STRING, key: ENC_STRING, fileSize: size,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).attachmentId as string;
}

async function downloadUrl(cipherId: string, attachmentId: string): Promise<string> {
  const meta = await api('GET', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token);
  expect(meta.status).toBe(200);
  return ((await meta.json()) as any).url as string;
}

describe('public attachment download token errors', () => {
  it('rejects a valid token used against a different attachment (token mismatch)', async () => {
    const cipher = await createCipher(token);
    const bytes = new TextEncoder().encode('real-bytes');
    const attachmentId = await reserve(cipher.id, bytes.byteLength);
    const up = await SELF.fetch(
      url(`/api/ciphers/${cipher.id}/attachment/${attachmentId}`),
      { method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: bytes }
    );
    expect(up.status).toBe(201);

    const dl = await downloadUrl(cipher.id, attachmentId);
    const tok = new URL(dl).searchParams.get('token')!;

    // Reuse the token but point at a different attachment id.
    const res = await SELF.fetch(url(`/api/attachments/${cipher.id}/${crypto.randomUUID()}?token=${tok}`), { headers: baseHeaders() });
    expect(res.status).toBe(401);
  });

  it('404s downloading a reserved-but-never-uploaded attachment (no R2 object)', async () => {
    const cipher = await createCipher(token);
    const attachmentId = await reserve(cipher.id, 32); // reserved only — no bytes uploaded
    const dl = await downloadUrl(cipher.id, attachmentId);

    const res = await SELF.fetch(dl, { headers: baseHeaders() });
    expect(res.status).toBe(404);
  });
});

describe('public attachment upload token guards', () => {
  it('rejects a public upload with no token or an invalid token (401)', async () => {
    const cipher = await createCipher(token);
    const attachmentId = await reserve(cipher.id, 8);
    const body = new Uint8Array(8);

    // No auth + no token -> falls to the public upload handler -> Token required.
    const noToken = await SELF.fetch(url(`/api/ciphers/${cipher.id}/attachment/${attachmentId}`), {
      method: 'POST', headers: baseHeaders(), body,
    });
    expect(noToken.status).toBe(401);

    const badToken = await SELF.fetch(url(`/api/ciphers/${cipher.id}/attachment/${attachmentId}?token=not-a-jwt`), {
      method: 'POST', headers: baseHeaders(), body,
    });
    expect(badToken.status).toBe(401);
  });
});
