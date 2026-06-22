import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Guard branches of the single-cipher operations: not-found 404s for the
// delete / permanent-delete / partial-update endpoints, plus partial-update's
// malformed-JSON and unknown-folder guards and its happy path. Real D1, no
// mocks.
let session: Session;
let token: string;
let cipherId: string;

beforeAll(async () => {
  session = await authenticate('ciphersingleops');
  token = session.accessToken;
  const cipher = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any;
  cipherId = cipher.id;
});

describe('single-cipher operation not-found guards', () => {
  it('404s a compat delete of an unknown cipher', async () => {
    expect((await api('DELETE', `/api/ciphers/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('404s a soft delete of an unknown cipher', async () => {
    expect((await api('PUT', `/api/ciphers/${crypto.randomUUID()}/delete`, token)).status).toBe(404);
  });

  it('404s a permanent delete of an unknown cipher', async () => {
    expect((await api('DELETE', `/api/ciphers/${crypto.randomUUID()}/delete`, token)).status).toBe(404);
  });

  it('404s a partial update of an unknown cipher', async () => {
    expect((await api('PUT', `/api/ciphers/${crypto.randomUUID()}/partial`, token, { favorite: true })).status).toBe(404);
  });
});

describe('partial cipher update', () => {
  it('400s a malformed JSON body', async () => {
    const res = await SELF.fetch(url(`/api/ciphers/${cipherId}/partial`), {
      method: 'PUT',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });

  it('404s a move to an unknown folder', async () => {
    const res = await api('PUT', `/api/ciphers/${cipherId}/partial`, token, { folderId: crypto.randomUUID() });
    expect(res.status).toBe(404);
  });

  it('toggles favorite on a real cipher', async () => {
    const res = await api('PUT', `/api/ciphers/${cipherId}/partial`, token, { favorite: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).favorite).toBe(true);
  });
});
