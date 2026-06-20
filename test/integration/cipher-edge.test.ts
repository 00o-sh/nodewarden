import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, createCipher, enc } from './helpers';

// Edge branches of the cipher endpoints: pagination, the deleted filter, the
// nested-object body shape, item-key encryption, and bad bulk payloads.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipheredge');
  token = session.accessToken;
});

describe('cipher listing', () => {
  it('paginates with pageSize and a continuation token', async () => {
    for (let i = 0; i < 3; i++) await createCipher(token);
    const res = await api('GET', '/api/ciphers?pageSize=2', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect((body.data ?? []).length).toBeLessThanOrEqual(2);
    expect(body).toHaveProperty('continuationToken');
  });

  it('includes trashed ciphers when deleted=true', async () => {
    const c = await createCipher(token);
    expect((await api('DELETE', `/api/ciphers/${c.id}`, token)).status).toBe(200); // soft delete

    const withDeleted = (await (await api('GET', '/api/ciphers?deleted=true', token)).json()) as any;
    expect((withDeleted.data ?? []).map((x: any) => x.id)).toContain(c.id);

    const withoutDeleted = (await (await api('GET', '/api/ciphers', token)).json()) as any;
    expect((withoutDeleted.data ?? []).map((x: any) => x.id)).not.toContain(c.id);
  });
});

describe('cipher body shapes', () => {
  it('accepts an item-key-encrypted cipher', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 1,
      name: enc('keyed'),
      key: ENC_STRING,
      login: { username: enc('u'), password: enc('p') },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe(ENC_STRING);
  });

  it('accepts the nested { cipher: {...} } body shape', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      cipher: { type: 1, name: enc('nested'), login: { username: enc('u'), password: enc('p') } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).type).toBe(1);
  });
});

describe('bad bulk payloads', () => {
  it('rejects a bulk delete without an ids array (400)', async () => {
    expect((await api('POST', '/api/ciphers/delete', token, {})).status).toBe(400);
  });

  it('rejects a bulk move without an ids array (400)', async () => {
    expect((await api('POST', '/api/ciphers/move', token, { folderId: null })).status).toBe(400);
  });
});
