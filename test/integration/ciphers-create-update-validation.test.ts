import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Create/update cipher validation: malformed JSON and unsupported-key guards on
// create, and the key / passwordHistory / fields handling plus unknown-folder
// guard on update. Real D1, no mocks.
let session: Session;
let token: string;
let cipherId: string;

beforeAll(async () => {
  session = await authenticate('ciphercreateupdate');
  token = session.accessToken;
  const cipher = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any;
  cipherId = cipher.id;
});

function rawPost(path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    body,
  });
}

describe('create cipher validation', () => {
  it('rejects a malformed JSON body', async () => {
    expect((await rawPost('/api/ciphers', '{bad')).status).toBe(400);
  });

  it('rejects an unsupported cipher key', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 1, name: ENC_STRING, key: 'not-a-valid-encrypted-key',
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    });
    expect(res.status).toBe(400);
  });
});

describe('update cipher field handling', () => {
  it('accepts a key, passwordHistory and fields on update', async () => {
    const res = await api('PUT', `/api/ciphers/${cipherId}`, token, {
      type: 1,
      name: ENC_STRING,
      key: ENC_STRING,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
      passwordHistory: [{ password: ENC_STRING, lastUsedDate: new Date().toISOString() }],
      fields: [{ name: ENC_STRING, value: ENC_STRING, type: 0 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.passwordHistory)).toBe(true);
    expect(Array.isArray(body.fields)).toBe(true);
  });

  it('404s an update that references an unknown folder', async () => {
    const res = await api('PUT', `/api/ciphers/${cipherId}`, token, {
      type: 1,
      name: ENC_STRING,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
      folderId: crypto.randomUUID(),
    });
    expect(res.status).toBe(404);
  });
});
