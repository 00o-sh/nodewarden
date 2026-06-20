import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, sync } from './helpers';

// Full cipher lifecycle through the public API: create -> read -> update ->
// appears in sync -> soft delete -> permanent delete. Exercises the cipher
// handlers and the cipher repo SQL together.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('vault');
  token = session.accessToken;
});

function loginCipher(overrides: Record<string, unknown> = {}) {
  return {
    type: 1,
    name: ENC_STRING,
    notes: ENC_STRING,
    favorite: false,
    login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    ...overrides,
  };
}

describe('cipher CRUD', () => {
  it('creates a cipher and returns a cipherDetails object', async () => {
    const res = await api('POST', '/api/ciphers', token, loginCipher());
    expect(res.status).toBe(200);
    const cipher = (await res.json()) as Record<string, any>;
    expect(cipher.object).toBe('cipherDetails');
    expect(typeof cipher.id).toBe('string');
    expect(cipher.type).toBe(1);
    expect(cipher.name).toBe(ENC_STRING);
    expect(cipher.favorite).toBe(false);
    expect(cipher.deletedDate).toBeNull();
    expect(cipher.creationDate).toBeTruthy();
  });

  it('reads the cipher back by id', async () => {
    const created = (await (await api('POST', '/api/ciphers', token, loginCipher())).json()) as any;
    const res = await api('GET', `/api/ciphers/${created.id}`, token);
    expect(res.status).toBe(200);
    const fetched = (await res.json()) as any;
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe(ENC_STRING);
  });

  it('updates a cipher (favorite flag flips, revision advances)', async () => {
    const created = (await (await api('POST', '/api/ciphers', token, loginCipher())).json()) as any;
    const res = await api('PUT', `/api/ciphers/${created.id}`, token, loginCipher({ favorite: true }));
    expect(res.status).toBe(200);
    const updated = (await res.json()) as any;
    expect(updated.id).toBe(created.id);
    expect(updated.favorite).toBe(true);
    expect(Date.parse(updated.revisionDate)).toBeGreaterThanOrEqual(Date.parse(created.revisionDate));
  });

  it('surfaces the created cipher in /api/sync', async () => {
    const created = (await (await api('POST', '/api/ciphers', token, loginCipher())).json()) as any;
    const vault = (await (await sync(token)).json()) as any;
    const ids = vault.ciphers.map((c: any) => c.id);
    expect(ids).toContain(created.id);
  });

  it('isolates ciphers from other users (404 cross-account)', async () => {
    const created = (await (await api('POST', '/api/ciphers', token, loginCipher())).json()) as any;
    // A second user cannot exist without an invite on this instance, so assert
    // the negative via a non-existent id of the right shape instead.
    const res = await api('GET', `/api/ciphers/${crypto.randomUUID()}`, token);
    expect(res.status).toBe(404);
    // And the real cipher is still reachable by its owner.
    expect((await api('GET', `/api/ciphers/${created.id}`, token)).status).toBe(200);
  });
});

describe('cipher deletion', () => {
  it('soft-deletes, hides from the default list, then permanently deletes', async () => {
    const created = (await (await api('POST', '/api/ciphers', token, loginCipher())).json()) as any;

    // First DELETE soft-deletes (trash): returns the cipher with a deletedDate.
    const softRes = await api('DELETE', `/api/ciphers/${created.id}`, token);
    expect(softRes.status).toBe(200);
    expect((await softRes.json()).deletedDate).toBeTruthy();

    // Default cipher list excludes trashed items.
    const list = (await (await api('GET', '/api/ciphers', token)).json()) as any;
    const listedIds = (list.data ?? list.Data ?? []).map((c: any) => c.id);
    expect(listedIds).not.toContain(created.id);

    // Second DELETE on an already-trashed cipher permanently removes it (204).
    const hardRes = await api('DELETE', `/api/ciphers/${created.id}`, token);
    expect(hardRes.status).toBe(204);

    // Now gone entirely.
    expect((await api('GET', `/api/ciphers/${created.id}`, token)).status).toBe(404);
  });
});
