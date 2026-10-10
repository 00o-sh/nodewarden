import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleUpdateCipher } from '../../src/handlers/ciphers';
import { StorageService } from '../../src/services/storage';
import { Session, api, authenticate, baseHeaders, createCipher, enc, url } from './helpers';

// Upstream v1.8.1 made full cipher updates conditional: the UPDATE only applies
// when the row still carries the updated_at the handler read, so a save or
// delete that lands between the read and the write is never overwritten or
// resurrected. It also routed the Bitwarden-style DELETE /api/ciphers (bulk
// permanent delete) and POST /api/ciphers/:id/delete (permanent delete).
const db = (env as any).DB as D1Database;
let session: Session;
let token: string;
let userId: string;

beforeAll(async () => {
  session = await authenticate('cipherrace');
  token = session.accessToken;
  userId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function storedRow(id: string): Promise<{ name: string; updated_at: string } | null> {
  return db.prepare('SELECT name, updated_at FROM ciphers WHERE id = ?').bind(id).first();
}

function updateRequest(id: string, body: Record<string, unknown>): Request {
  return new Request(url(`/api/ciphers/${id}`), {
    method: 'PUT',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

describe('conditional full update', () => {
  it('rejects the write when the cipher changed between read and write, keeping the concurrent change', async () => {
    const cipher = await createCipher(token);
    const concurrentName = enc('concurrent');
    const concurrentStamp = new Date(Date.now() + 60_000).toISOString();

    // Let the handler read the current row, then commit a competing save
    // before it writes — exactly the race the conditional UPDATE closes.
    const realRead = StorageService.prototype.getCipherForUser;
    vi.spyOn(StorageService.prototype, 'getCipherForUser').mockImplementation(async function (this: StorageService, id, uid) {
      const snapshot = await realRead.call(this, id, uid);
      await db.prepare('UPDATE ciphers SET name = ?, updated_at = ? WHERE id = ?').bind(concurrentName, concurrentStamp, id).run();
      return snapshot;
    });

    const res = await handleUpdateCipher(updateRequest(cipher.id, {
      type: 1,
      name: enc('stale-write'),
      login: { username: enc('u'), password: enc('p'), uris: [] },
    }), env as any, userId, cipher.id);

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('out of date');
    const row = await storedRow(cipher.id);
    expect(row?.name).toBe(concurrentName);
    expect(row?.updated_at).toBe(concurrentStamp);
  });

  it('does not resurrect a cipher deleted between read and write', async () => {
    const cipher = await createCipher(token);
    const realRead = StorageService.prototype.getCipherForUser;
    vi.spyOn(StorageService.prototype, 'getCipherForUser').mockImplementation(async function (this: StorageService, id, uid) {
      const snapshot = await realRead.call(this, id, uid);
      await db.prepare('DELETE FROM ciphers WHERE id = ?').bind(id).run();
      return snapshot;
    });

    const res = await handleUpdateCipher(updateRequest(cipher.id, {
      type: 1,
      name: enc('after-delete'),
      login: { username: enc('u'), password: enc('p'), uris: [] },
    }), env as any, userId, cipher.id);

    expect(res.status).toBe(400);
    expect(await storedRow(cipher.id)).toBeNull();
  });

  it('applies the write when nothing changed and advances updated_at', async () => {
    const cipher = await createCipher(token);
    const before = (await storedRow(cipher.id))!;
    const res = await handleUpdateCipher(updateRequest(cipher.id, {
      type: 1,
      name: enc('fresh-write'),
      login: { username: enc('u'), password: enc('p'), uris: [] },
    }), env as any, userId, cipher.id);
    expect(res.status).toBe(200);
    const after = (await storedRow(cipher.id))!;
    expect(after.name).toBe(enc('fresh-write'));
    expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at));
  });
});

describe('StorageService.updateCipherIfUnchanged column defaults', () => {
  it('stores a missing type as login, a missing reprompt as 0, favorite as 1 and keeps an archive stamp', async () => {
    const created = await createCipher(token);
    const storage = new StorageService(db);
    const cipher = (await storage.getCipherForUser(created.id, userId))!;
    const archivedAt = new Date().toISOString();
    const next = { ...cipher, type: undefined, favorite: true, reprompt: undefined, archivedAt, updatedAt: new Date(Date.parse(cipher.updatedAt) + 1000).toISOString() } as any;
    expect(await storage.updateCipherIfUnchanged(next, cipher.updatedAt)).toBe(true);
    const row = await db.prepare('SELECT type, favorite, reprompt, archived_at FROM ciphers WHERE id = ?').bind(cipher.id).first();
    expect(row).toEqual({ type: 1, favorite: 1, reprompt: 0, archived_at: archivedAt });
  });

  it('keeps an explicit reprompt and clears a missing archive stamp to NULL', async () => {
    const created = await createCipher(token);
    const storage = new StorageService(db);
    const cipher = (await storage.getCipherForUser(created.id, userId))!;
    const next = { ...cipher, reprompt: 1, archivedAt: undefined, updatedAt: new Date(Date.parse(cipher.updatedAt) + 1000).toISOString() } as any;
    expect(await storage.updateCipherIfUnchanged(next, cipher.updatedAt)).toBe(true);
    const row = await db.prepare('SELECT reprompt, archived_at FROM ciphers WHERE id = ?').bind(cipher.id).first<{ reprompt: number; archived_at: string | null }>();
    expect(row).toEqual({ reprompt: 1, archived_at: null });
    // The same expected timestamp no longer matches, so a replay is refused.
    expect(await storage.updateCipherIfUnchanged(next, cipher.updatedAt)).toBe(false);
  });
});

describe('Bitwarden-compatible permanent delete routes', () => {
  it('DELETE /api/ciphers permanently deletes the listed ciphers', async () => {
    const a = await createCipher(token);
    const b = await createCipher(token);
    const keep = await createCipher(token);
    const res = await api('DELETE', '/api/ciphers', token, { ids: [a.id, b.id] });
    expect(res.status).toBe(204);
    expect(await storedRow(a.id)).toBeNull();
    expect(await storedRow(b.id)).toBeNull();
    expect(await storedRow(keep.id)).not.toBeNull();
  });

  it('DELETE on /api/ciphers/create is not routed', async () => {
    const res = await api('DELETE', '/api/ciphers/create', token, { ids: [] });
    expect(res.status).not.toBe(204);
  });

  it('POST /api/ciphers/:id/delete permanently deletes one cipher', async () => {
    const cipher = await createCipher(token);
    const res = await api('POST', `/api/ciphers/${cipher.id}/delete`, token);
    expect(res.ok).toBe(true);
    expect(await storedRow(cipher.id)).toBeNull();
    expect((await api('POST', `/api/ciphers/${cipher.id}/delete`, token)).status).toBe(404);
  });
});
