import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, createCipher } from './helpers';

// The bulk cipher lifecycle operations' success paths: archive / unarchive /
// soft-delete / restore / permanent-delete across multiple ciphers. Real D1,
// no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipherbulk');
  token = session.accessToken;
});

async function get(id: string): Promise<any> {
  return (await (await api('GET', `/api/ciphers/${id}`, token)).json()) as any;
}

describe('bulk cipher lifecycle', () => {
  it('archives then unarchives a set of ciphers', async () => {
    const a = await createCipher(token);
    const b = await createCipher(token);
    const ids = [a.id, b.id];

    expect((await api('PUT', '/api/ciphers/archive', token, { ids })).status).toBe(200);
    for (const id of ids) expect((await get(id)).archivedDate ?? (await get(id)).ArchivedDate).toBeTruthy();

    expect((await api('PUT', '/api/ciphers/unarchive', token, { ids })).status).toBe(200);
    for (const id of ids) {
      const c = await get(id);
      expect(c.archivedDate ?? c.ArchivedDate ?? null).toBeNull();
    }
  });

  it('soft-deletes, restores, then permanently deletes a set of ciphers', async () => {
    const a = await createCipher(token);
    const b = await createCipher(token);
    const ids = [a.id, b.id];

    // Bulk soft-delete -> trashed (deletedDate set).
    expect([200, 204]).toContain((await api('POST', '/api/ciphers/delete', token, { ids })).status);
    for (const id of ids) {
      const c = await get(id);
      expect(c.deletedDate ?? c.DeletedDate).toBeTruthy();
    }

    // Bulk restore -> deletedDate cleared.
    expect([200, 204]).toContain((await api('POST', '/api/ciphers/restore', token, { ids })).status);
    for (const id of ids) {
      const c = await get(id);
      expect(c.deletedDate ?? c.DeletedDate ?? null).toBeNull();
    }

    // Soft-delete again, then permanently delete.
    expect([200, 204]).toContain((await api('POST', '/api/ciphers/delete', token, { ids })).status);
    expect([200, 204]).toContain((await api('POST', '/api/ciphers/delete-permanent', token, { ids })).status);
    for (const id of ids) {
      expect((await api('GET', `/api/ciphers/${id}`, token)).status).toBe(404);
    }
  });
});
