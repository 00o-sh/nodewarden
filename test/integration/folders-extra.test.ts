import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, createFolder } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('foldersx');
  token = session.accessToken;
});

describe('folder reads and bulk delete', () => {
  it('fetches a single folder by id', async () => {
    const folder = await createFolder(token);
    const res = await api('GET', `/api/folders/${folder.id}`, token);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(folder.id);
  });

  it('returns 404 for an unknown folder', async () => {
    const res = await api('GET', `/api/folders/${crypto.randomUUID()}`, token);
    expect(res.status).toBe(404);
  });

  it('bulk-deletes folders', async () => {
    const a = await createFolder(token);
    const b = await createFolder(token);
    const res = await api('POST', '/api/folders/delete', token, { ids: [a.id, b.id] });
    expect([200, 204]).toContain(res.status);
    expect((await api('GET', `/api/folders/${a.id}`, token)).status).toBe(404);
  });

  it('rejects a bulk delete with no ids (400)', async () => {
    const res = await api('POST', '/api/folders/delete', token, { ids: [] });
    expect(res.status).toBe(400);
  });
});
