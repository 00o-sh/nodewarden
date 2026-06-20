import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, createCipher, createFolder, enc, sync } from './helpers';

// Single-cipher lifecycle endpoints (partial update, archive/unarchive, soft
// delete + restore, permanent delete) and their not-found / validation paths.
// These complement the bulk-operation suite, driving the per-id handlers.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipherlc');
  token = session.accessToken;
});

async function getCipher(id: string): Promise<any> {
  const after = (await (await sync(token)).json()) as any;
  return after.ciphers.find((c: any) => c.id === id);
}

describe('single-cipher lifecycle', () => {
  it('partially updates folder and favorite', async () => {
    const folder = await createFolder(token);
    const cipher = await createCipher(token);

    const res = await api('PUT', `/api/ciphers/${cipher.id}/partial`, token, { folderId: folder.id, favorite: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.favorite).toBe(true);
    expect(body.folderId).toBe(folder.id);

    // Clearing the folder back to null is accepted.
    const cleared = await api('PUT', `/api/ciphers/${cipher.id}/partial`, token, { folderId: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as any).folderId).toBeNull();
  });

  it('rejects a partial update onto a non-existent folder (404)', async () => {
    const cipher = await createCipher(token);
    const res = await api('PUT', `/api/ciphers/${cipher.id}/partial`, token, { folderId: crypto.randomUUID() });
    expect(res.status).toBe(404);
  });

  it('archives and unarchives a cipher', async () => {
    const cipher = await createCipher(token);

    const archived = await api('PUT', `/api/ciphers/${cipher.id}/archive`, token, {});
    expect(archived.status).toBe(200);
    expect(typeof ((await archived.json()) as any).archivedDate).toBe('string');

    const unarchived = await api('PUT', `/api/ciphers/${cipher.id}/unarchive`, token, {});
    expect(unarchived.status).toBe(200);
    const body = (await unarchived.json()) as any;
    expect(body.archivedDate == null).toBe(true);
  });

  it('refuses to archive a soft-deleted cipher (400)', async () => {
    const cipher = await createCipher(token);
    expect((await api('PUT', `/api/ciphers/${cipher.id}/delete`, token, {})).status).toBe(200);
    const res = await api('PUT', `/api/ciphers/${cipher.id}/archive`, token, {});
    expect(res.status).toBe(400);
  });

  it('soft-deletes, then restores a cipher', async () => {
    const cipher = await createCipher(token);

    const del = await api('PUT', `/api/ciphers/${cipher.id}/delete`, token, {});
    expect(del.status).toBe(200);
    expect(typeof (await getCipher(cipher.id)).deletedDate).toBe('string');

    const restored = await api('PUT', `/api/ciphers/${cipher.id}/restore`, token, {});
    expect(restored.status).toBe(200);
    const after = await getCipher(cipher.id);
    expect(after.deletedDate == null).toBe(true);
  });

  it('permanently deletes a cipher via DELETE /:id/delete', async () => {
    const cipher = await createCipher(token);
    const del = await api('DELETE', `/api/ciphers/${cipher.id}/delete`, token);
    expect([200, 204]).toContain(del.status);
    expect(await getCipher(cipher.id)).toBeFalsy();
  });

  it('serves cipher details and updates via the compat (no-subpath) routes', async () => {
    const cipher = await createCipher(token);

    const details = await api('GET', `/api/ciphers/${cipher.id}/details`, token);
    expect(details.status).toBe(200);
    expect(((await details.json()) as any).id).toBe(cipher.id);

    // PUT to the bare id updates the cipher.
    const updated = await api('PUT', `/api/ciphers/${cipher.id}`, token, {
      type: 1,
      name: enc('renamed'),
      login: { username: enc('u2'), password: enc('p2'), uris: [] },
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as any).name).toBe(enc('renamed'));

    // DELETE on the bare id soft-deletes (compat).
    const del = await api('DELETE', `/api/ciphers/${cipher.id}`, token);
    expect([200, 204]).toContain(del.status);
  });

  it('returns 404 for lifecycle actions on an unknown cipher', async () => {
    const ghost = crypto.randomUUID();
    expect((await api('PUT', `/api/ciphers/${ghost}/partial`, token, { favorite: true })).status).toBe(404);
    expect((await api('PUT', `/api/ciphers/${ghost}/archive`, token, {})).status).toBe(404);
    expect((await api('PUT', `/api/ciphers/${ghost}/unarchive`, token, {})).status).toBe(404);
    expect((await api('PUT', `/api/ciphers/${ghost}/restore`, token, {})).status).toBe(404);
  });
});
