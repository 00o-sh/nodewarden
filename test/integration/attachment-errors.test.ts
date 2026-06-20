import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, createCipher, url } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('attacherr');
  token = session.accessToken;
});

describe('attachment download token errors', () => {
  it('rejects a download with no token (401)', async () => {
    const res = await SELF.fetch(url(`/api/attachments/${crypto.randomUUID()}/${crypto.randomUUID()}`), {
      headers: baseHeaders(),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a download with an invalid token (401)', async () => {
    const res = await SELF.fetch(
      url(`/api/attachments/${crypto.randomUUID()}/${crypto.randomUUID()}?token=not-a-jwt`),
      { headers: baseHeaders() }
    );
    expect(res.status).toBe(401);
  });
});

describe('attachment metadata errors', () => {
  it('returns 404 fetching an attachment that does not exist', async () => {
    const cipher = await createCipher(token);
    const res = await api('GET', `/api/ciphers/${cipher.id}/attachment/${crypto.randomUUID()}`, token);
    expect(res.status).toBe(404);
  });

  it('returns 404 fetching an attachment on a missing cipher', async () => {
    const res = await api('GET', `/api/ciphers/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}`, token);
    expect(res.status).toBe(404);
  });
});
