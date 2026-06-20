import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, createCipher, createFolder, sync } from './helpers';

// Completes cipher CRUD coverage: bulk delete/restore/permanent-delete, single
// and bulk archive/unarchive, bulk move, partial update.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('bulk');
  token = session.accessToken;
});

describe('cipher archive lifecycle', () => {
  it('archives and unarchives a single cipher', async () => {
    const c = await createCipher(token);
    const archived = await api('PUT', `/api/ciphers/${c.id}/archive`, token);
    expect(archived.status).toBe(200);
    expect((await archived.json()).archivedDate).toBeTruthy();

    const unarchived = await api('PUT', `/api/ciphers/${c.id}/unarchive`, token);
    expect(unarchived.status).toBe(200);
    expect((await unarchived.json()).archivedDate).toBeNull();
  });

  it('bulk archives and unarchives', async () => {
    const a = await createCipher(token);
    const b = await createCipher(token);
    const res = await api('PUT', '/api/ciphers/archive', token, { ids: [a.id, b.id] });
    expect(res.status).toBe(200);

    const un = await api('PUT', '/api/ciphers/unarchive', token, { ids: [a.id, b.id] });
    expect(un.status).toBe(200);
  });

  it('rejects a bulk archive without an ids array (400)', async () => {
    const res = await api('PUT', '/api/ciphers/archive', token, {});
    expect(res.status).toBe(400);
  });
});

describe('cipher bulk soft-delete / restore / permanent-delete', () => {
  it('soft-deletes in bulk, restores, then permanently deletes', async () => {
    const a = await createCipher(token);
    const b = await createCipher(token);
    const ids = [a.id, b.id];

    expect((await api('POST', '/api/ciphers/delete', token, { ids })).status).toBe(204);
    // Trashed: absent from the default (non-deleted) list.
    let list = (await (await api('GET', '/api/ciphers', token)).json()) as any;
    let listed = (list.data ?? []).map((c: any) => c.id);
    expect(listed).not.toContain(a.id);

    expect((await api('POST', '/api/ciphers/restore', token, { ids })).status).toBe(204);
    list = (await (await api('GET', '/api/ciphers', token)).json()) as any;
    listed = (list.data ?? []).map((c: any) => c.id);
    expect(listed).toContain(a.id);

    expect((await api('POST', '/api/ciphers/delete-permanent', token, { ids })).status).toBe(204);
    expect((await api('GET', `/api/ciphers/${a.id}`, token)).status).toBe(404);
  });
});

describe('cipher bulk move', () => {
  it('moves ciphers into a folder and back out', async () => {
    const folder = await createFolder(token);
    const a = await createCipher(token);
    const b = await createCipher(token);

    expect((await api('POST', '/api/ciphers/move', token, { ids: [a.id, b.id], folderId: folder.id })).status).toBe(204);
    let vault = (await (await sync(token)).json()) as any;
    let moved = vault.ciphers.filter((c: any) => [a.id, b.id].includes(c.id));
    expect(moved.every((c: any) => c.folderId === folder.id)).toBe(true);

    // Move back to no folder.
    expect((await api('POST', '/api/ciphers/move', token, { ids: [a.id, b.id], folderId: null })).status).toBe(204);
    vault = (await (await sync(token)).json()) as any;
    moved = vault.ciphers.filter((c: any) => [a.id, b.id].includes(c.id));
    expect(moved.every((c: any) => c.folderId === null)).toBe(true);
  });

  it('rejects a move to a folder owned by nobody (404)', async () => {
    const a = await createCipher(token);
    const res = await api('POST', '/api/ciphers/move', token, { ids: [a.id], folderId: crypto.randomUUID() });
    expect(res.status).toBe(404);
  });
});

describe('cipher partial update', () => {
  it('updates favorite and folder via the partial endpoint', async () => {
    const folder = await createFolder(token);
    const c = await createCipher(token);

    const res = await api('PUT', `/api/ciphers/${c.id}/partial`, token, {
      favorite: true,
      folderId: folder.id,
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as any;
    expect(updated.favorite).toBe(true);
    expect(updated.folderId).toBe(folder.id);
  });
});

describe('single restore / permanent delete', () => {
  it('soft-deletes then restores a single cipher', async () => {
    const c = await createCipher(token);
    expect((await api('DELETE', `/api/ciphers/${c.id}`, token)).status).toBe(200); // soft delete
    const restored = await api('PUT', `/api/ciphers/${c.id}/restore`, token);
    expect(restored.status).toBe(200);
    expect((await restored.json()).deletedDate).toBeNull();
  });

  it('permanently deletes a single cipher via the /delete endpoint', async () => {
    const c = await createCipher(token);
    expect((await api('DELETE', `/api/ciphers/${c.id}/delete`, token)).status).toBe(204);
    expect((await api('GET', `/api/ciphers/${c.id}`, token)).status).toBe(404);
  });
});
