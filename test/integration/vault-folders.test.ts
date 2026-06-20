import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, sync } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('folders');
  token = session.accessToken;
});

describe('folder CRUD', () => {
  it('creates a folder', async () => {
    const res = await api('POST', '/api/folders', token, { name: ENC_STRING });
    expect(res.status).toBe(200);
    const folder = (await res.json()) as any;
    expect(folder.object).toBe('folder');
    expect(typeof folder.id).toBe('string');
    expect(folder.name).toBe(ENC_STRING);
  });

  it('requires a name (400)', async () => {
    const res = await api('POST', '/api/folders', token, {});
    expect(res.status).toBe(400);
  });

  it('updates a folder name', async () => {
    const created = (await (await api('POST', '/api/folders', token, { name: ENC_STRING })).json()) as any;
    const newName = `2.${btoa('iv2')}|${btoa('renamed')}|${btoa('mac2')}`;
    const res = await api('PUT', `/api/folders/${created.id}`, token, { name: newName });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe(newName);
  });

  it('surfaces folders in /api/sync and removes them on delete', async () => {
    const created = (await (await api('POST', '/api/folders', token, { name: ENC_STRING })).json()) as any;

    let vault = (await (await sync(token)).json()) as any;
    expect(vault.folders.map((f: any) => f.id)).toContain(created.id);

    const del = await api('DELETE', `/api/folders/${created.id}`, token);
    expect(del.status).toBe(204);

    vault = (await (await sync(token)).json()) as any;
    expect(vault.folders.map((f: any) => f.id)).not.toContain(created.id);
  });

  it('returns 404 updating a non-existent folder', async () => {
    const res = await api('PUT', `/api/folders/${crypto.randomUUID()}`, token, { name: ENC_STRING });
    expect(res.status).toBe(404);
  });
});
