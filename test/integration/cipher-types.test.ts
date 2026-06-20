import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, createCipher, enc, sync } from './helpers';

// Exercises the per-type normalization branches in cipherToResponse (login,
// card, identity, secure note, ssh key) and the details/share endpoints.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('ciphertypes');
  token = session.accessToken;
});

async function create(body: Record<string, unknown>): Promise<any> {
  const res = await api('POST', '/api/ciphers', token, { name: enc('item'), ...body });
  expect(res.status).toBe(200);
  return res.json();
}

describe('cipher types', () => {
  it('creates a card cipher', async () => {
    const c = await create({
      type: 3,
      card: { cardholderName: enc('name'), number: enc('4111'), code: enc('123'), brand: enc('visa') },
    });
    expect(c.type).toBe(3);
    expect(c.card).not.toBeNull();
  });

  it('creates an identity cipher', async () => {
    const c = await create({
      type: 4,
      identity: { firstName: enc('jane'), lastName: enc('doe'), email: enc('jane@x') },
    });
    expect(c.type).toBe(4);
    expect(c.identity).not.toBeNull();
  });

  it('creates a secure-note cipher', async () => {
    const c = await create({ type: 2, secureNote: { type: 0 }, notes: enc('a note') });
    expect(c.type).toBe(2);
    expect(c.secureNote).not.toBeNull();
  });

  it('creates an ssh-key cipher', async () => {
    const c = await create({
      type: 5,
      sshKey: { privateKey: enc('priv'), publicKey: enc('pub'), keyFingerprint: enc('fp') },
    });
    expect(c.type).toBe(5);
  });

  it('surfaces all cipher types in sync', async () => {
    const vault = (await (await sync(token)).json()) as any;
    const types = new Set(vault.ciphers.map((c: any) => c.type));
    for (const t of [2, 3, 4, 5]) expect(types).toContain(t);
  });
});

describe('cipher detail / share endpoints', () => {
  it('returns cipher details', async () => {
    const c = await createCipher(token);
    const res = await api('GET', `/api/ciphers/${c.id}/details`, token);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(c.id);
  });

  it('responds to the share endpoint', async () => {
    const c = await createCipher(token);
    const res = await api('POST', `/api/ciphers/${c.id}/share`, token, {});
    expect(res.status).toBe(200);
  });
});

describe('attachment metadata update', () => {
  it('updates attachment metadata after reserving', async () => {
    const c = await createCipher(token);
    const reserve = (await (await api('POST', `/api/ciphers/${c.id}/attachment/v2`, token, {
      fileName: ENC_STRING,
      key: ENC_STRING,
      fileSize: 16,
    })).json()) as any;

    const res = await api('POST', `/api/ciphers/${c.id}/attachment/${reserve.attachmentId}/metadata`, token, {
      fileName: enc('renamed-file'),
      key: ENC_STRING,
    });
    expect([200, 204]).toContain(res.status);
  });
});
