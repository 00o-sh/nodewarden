import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, createCipher, createFolder, enc, url } from './helpers';

// handleUpdateCipher edge branches: stale-update guard, key rejection, type
// change (field null-out), custom-field clearing, folder ownership, the
// preserve-revision-date path, and validation failures.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipherupd');
  token = session.accessToken;
});

describe('handleUpdateCipher edge branches', () => {
  it('404s updating an unknown cipher and 400s invalid JSON', async () => {
    expect((await api('PUT', `/api/ciphers/${crypto.randomUUID()}`, token, { type: 1, name: enc('x') })).status).toBe(404);

    const cipher = await createCipher(token);
    const badJson = await SELF.fetch(url(`/api/ciphers/${cipher.id}`), {
      method: 'PUT',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);
  });

  it('rejects a stale update (client revision older than the stored copy)', async () => {
    const cipher = await createCipher(token);
    const res = await api('PUT', `/api/ciphers/${cipher.id}`, token, {
      type: 1,
      name: enc('item'),
      login: { username: enc('u'), password: enc('p'), uris: [] },
      lastKnownRevisionDate: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported cipher key and a non-encrypted name', async () => {
    const cipher = await createCipher(token);
    expect((await api('PUT', `/api/ciphers/${cipher.id}`, token, { type: 1, name: enc('item'), key: 'not-an-enc-key' })).status).toBe(400);
    expect((await api('PUT', `/api/ciphers/${cipher.id}`, token, { type: 1, name: 'plain-name' })).status).toBe(400);
  });

  it('changes a cipher type and nulls the old type-specific data', async () => {
    const cipher = await createCipher(token); // type 1 (login)
    const res = await api('PUT', `/api/ciphers/${cipher.id}`, token, {
      type: 2,
      name: enc('now-a-note'),
      secureNote: { type: 0 },
      notes: enc('a note'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.type).toBe(2);
    expect(body.login == null).toBe(true);
    expect(body.secureNote).toBeTruthy();
  });

  it('clears custom fields on a full update that omits them', async () => {
    const cipher = await createCipher(token, {
      fields: [{ type: 0, name: enc('f'), value: enc('v') }],
    });
    const res = await api('PUT', `/api/ciphers/${cipher.id}`, token, {
      type: 1,
      name: enc('item'),
      login: { username: enc('u'), password: enc('p'), uris: [] },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).fields == null).toBe(true);
  });

  it('moves a cipher to a folder, and 404s an unknown folder', async () => {
    const cipher = await createCipher(token);
    const folder = await createFolder(token);
    const ok = await api('PUT', `/api/ciphers/${cipher.id}`, token, {
      type: 1, name: enc('item'), login: { username: enc('u'), password: enc('p'), uris: [] },
      folderId: folder.id,
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).folderId).toBe(folder.id);

    const bad = await api('PUT', `/api/ciphers/${cipher.id}`, token, {
      type: 1, name: enc('item'), login: { username: enc('u'), password: enc('p'), uris: [] },
      folderId: crypto.randomUUID(),
    });
    expect(bad.status).toBe(404);
  });

  it('preserves the revision date when the web client requests it', async () => {
    const cipher = await createCipher(token);
    const res = await SELF.fetch(url(`/api/ciphers/${cipher.id}`), {
      method: 'PUT',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-NodeWarden-Web': '1' }),
      body: JSON.stringify({
        type: 1,
        name: enc('item'),
        login: { username: enc('u'), password: enc('p'), uris: [] },
        preserveRevisionDate: true,
      }),
    });
    expect(res.status).toBe(200);
  });
});
