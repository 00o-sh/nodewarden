import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';

// Creating every cipher type exercises the per-type create/normalize branches
// (login, secure note, card, identity, SSH key). Real D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipheralltypes');
  token = session.accessToken;
});

async function create(body: Record<string, unknown>): Promise<any> {
  const res = await api('POST', '/api/ciphers', token, { name: ENC_STRING, ...body });
  expect(res.status).toBe(200);
  return res.json();
}

describe('create each cipher type', () => {
  it('creates a login cipher', async () => {
    const c = await create({ type: 1, login: { username: ENC_STRING, password: ENC_STRING, uris: [{ uri: ENC_STRING, match: null }] } });
    expect(c.type).toBe(1);
    expect(c.login).toBeTruthy();
  });

  it('creates a secure note cipher', async () => {
    const c = await create({ type: 2, secureNote: { type: 0 } });
    expect(c.type).toBe(2);
    expect(c.secureNote).toBeTruthy();
  });

  it('creates a card cipher', async () => {
    const c = await create({ type: 3, card: { cardholderName: ENC_STRING, number: ENC_STRING, brand: ENC_STRING, expMonth: ENC_STRING, expYear: ENC_STRING, code: ENC_STRING } });
    expect(c.type).toBe(3);
    expect(c.card).toBeTruthy();
  });

  it('creates an identity cipher', async () => {
    const c = await create({ type: 4, identity: { firstName: ENC_STRING, lastName: ENC_STRING, email: ENC_STRING } });
    expect(c.type).toBe(4);
    expect(c.identity).toBeTruthy();
  });

  it('creates an SSH key cipher', async () => {
    const c = await create({ type: 5, sshKey: { privateKey: ENC_STRING, publicKey: ENC_STRING, keyFingerprint: ENC_STRING } });
    expect(c.type).toBe(5);
    expect(c.sshKey).toBeTruthy();
  });
});
