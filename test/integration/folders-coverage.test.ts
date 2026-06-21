import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, createCipher, createFolder, url } from './helpers';

// Folder handler branches not exercised by the existing CRUD tests: the
// paginated listing + continuation token, the invalid-JSON guards on
// create/update/bulk-delete, the empty-name no-op update, and a single
// DELETE that also clears the folder reference from an assigned cipher.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('folders-cov');
  token = session.accessToken;
});

function rawJson(method: string, path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body,
  });
}

describe('folder pagination', () => {
  it('pages through folders with pageSize + continuationToken', async () => {
    const created = [];
    for (let i = 0; i < 3; i += 1) created.push(await createFolder(token));
    const createdIds = new Set(created.map((f) => f.id));

    const seen = new Set<string>();
    let cont: string | null = null;
    let guard = 0;
    do {
      const q = `/api/folders?pageSize=1${cont ? `&continuationToken=${encodeURIComponent(cont)}` : ''}`;
      const page = (await (await api('GET', q, token)).json()) as any;
      expect(page.object).toBe('list');
      expect(page.data.length).toBeLessThanOrEqual(1);
      for (const f of page.data) seen.add(f.id);
      cont = page.continuationToken;
      guard += 1;
    } while (cont && guard < 50);

    // Every folder we created shows up across the pages.
    for (const id of createdIds) expect(seen.has(id)).toBe(true);
  });
});

describe('folder invalid-JSON guards', () => {
  it('400s on malformed JSON when creating', async () => {
    expect((await rawJson('POST', '/api/folders', '{not json')).status).toBe(400);
  });

  it('400s on malformed JSON when updating', async () => {
    const folder = await createFolder(token);
    expect((await rawJson('PUT', `/api/folders/${folder.id}`, '{nope')).status).toBe(400);
  });

  it('400s on malformed JSON when bulk-deleting', async () => {
    expect((await rawJson('POST', '/api/folders/delete', '{bad')).status).toBe(400);
  });
});

describe('folder update edge', () => {
  it('keeps the existing name when the update body omits a name', async () => {
    const folder = await createFolder(token);
    const updated = await api('PUT', `/api/folders/${folder.id}`, token, {});
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as any;
    expect(body.name).toBe(folder.name);
    // revisionDate advances even though the name is unchanged.
    expect(body.revisionDate).not.toBe(folder.revisionDate);
  });
});

describe('single folder delete', () => {
  it('deletes a folder and clears it from an assigned cipher', async () => {
    const folder = await createFolder(token);
    const cipher = await createCipher(token, { folderId: folder.id });
    expect(cipher.folderId).toBe(folder.id);

    const del = await api('DELETE', `/api/folders/${folder.id}`, token);
    expect(del.status).toBe(204);

    // The folder is gone and the cipher no longer references it.
    expect((await api('GET', `/api/folders/${folder.id}`, token)).status).toBe(404);
    const refreshed = (await (await api('GET', `/api/ciphers/${cipher.id}`, token)).json()) as any;
    expect(refreshed.folderId == null).toBe(true);
  });
});
