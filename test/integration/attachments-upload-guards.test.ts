import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Upload-attachment guards: the authenticated upload's cipher/attachment
// not-found checks, and the public token-based upload's invalid-token guard.
// Real D1 + R2, no mocks.
let session: Session;
let token: string;
let cipherId: string;

beforeAll(async () => {
  session = await authenticate('attachupload');
  token = session.accessToken;
  const cipher = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any;
  cipherId = cipher.id;
});

describe('authenticated attachment upload guards', () => {
  it('404s an upload to an unknown cipher', async () => {
    const res = await SELF.fetch(url(`/api/ciphers/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(404);
  });

  it('404s an upload to an unknown attachment on a real cipher', async () => {
    const res = await SELF.fetch(url(`/api/ciphers/${cipherId}/attachment/${crypto.randomUUID()}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(404);
  });
});

describe('public attachment upload guards', () => {
  it('401s a public upload with an invalid token', async () => {
    const res = await SELF.fetch(url(`/api/ciphers/${cipherId}/attachment/${crypto.randomUUID()}?token=not-a-valid-token`), {
      method: 'POST',
      headers: baseHeaders({}),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(401);
  });
});
