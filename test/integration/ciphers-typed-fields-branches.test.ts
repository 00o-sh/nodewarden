import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

// The typed-cipher field-mapping branches the happy-path suites miss: bank
// account (6), drivers license (7) and passport (8) create + response shaping,
// the per-type clearing that happens when an update changes a cipher's type,
// and the encrypted-field validation errors for each typed object. Real worker
// + real D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipher-typed');
  token = session.accessToken;
});

async function create(body: Record<string, unknown>): Promise<any> {
  const res = await api('POST', '/api/ciphers', token, { name: ENC_STRING, ...body });
  if (res.status !== 200) throw new Error(`create ${res.status}: ${await res.text()}`);
  return res.json();
}

const BANK_ACCOUNT = {
  bankName: enc('bank'),
  nameOnAccount: enc('name'),
  accountType: enc('type'),
  accountNumber: enc('acct'),
  routingNumber: enc('routing'),
};
const DRIVERS_LICENSE = {
  firstName: enc('first'),
  lastName: enc('last'),
  licenseNumber: enc('lic'),
  issuingState: enc('state'),
  expirationDate: enc('exp'),
};
const PASSPORT = {
  surname: enc('surname'),
  givenName: enc('given'),
  passportNumber: enc('pass'),
  nationality: enc('nat'),
  expirationDate: enc('exp'),
};

describe('typed cipher creation (bank / license / passport)', () => {
  it('creates a bank-account cipher and returns only its typed object', async () => {
    const c = await create({ type: 6, bankAccount: BANK_ACCOUNT });
    expect(c.type).toBe(6);
    expect(c.bankAccount).toBeTruthy();
    expect(c.bankAccount.accountNumber).toBe(enc('acct'));
    // cipherToResponse nulls the other typed objects for a type-6 cipher.
    expect(c.driversLicense).toBeNull();
    expect(c.passport).toBeNull();
    expect(c.login).toBeNull();
  });

  it('creates a drivers-license cipher', async () => {
    const c = await create({ type: 7, driversLicense: DRIVERS_LICENSE });
    expect(c.type).toBe(7);
    expect(c.driversLicense).toBeTruthy();
    expect(c.driversLicense.licenseNumber).toBe(enc('lic'));
    expect(c.bankAccount).toBeNull();
    expect(c.passport).toBeNull();
  });

  it('creates a passport cipher', async () => {
    const c = await create({ type: 8, passport: PASSPORT });
    expect(c.type).toBe(8);
    expect(c.passport).toBeTruthy();
    expect(c.passport.passportNumber).toBe(enc('pass'));
    expect(c.bankAccount).toBeNull();
    expect(c.driversLicense).toBeNull();
  });
});

describe('typed cipher update type transitions', () => {
  it('clears the login object when a login cipher is retyped to a card', async () => {
    const login = await create({
      type: 1,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    });

    const res = await api('PUT', `/api/ciphers/${login.id}`, token, {
      type: 3,
      name: ENC_STRING,
      card: { cardholderName: enc('ch'), number: enc('num'), brand: enc('brand') },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.type).toBe(3);
    expect(body.card).toBeTruthy();
    expect(body.login).toBeNull();
  });

  it('retypes a cipher into a bank account, then into a passport, clearing the prior typed object', async () => {
    const created = await create({ type: 6, bankAccount: BANK_ACCOUNT });

    const toLicense = await api('PUT', `/api/ciphers/${created.id}`, token, {
      type: 7,
      name: ENC_STRING,
      driversLicense: DRIVERS_LICENSE,
    });
    expect(toLicense.status).toBe(200);
    const licenseBody = (await toLicense.json()) as any;
    expect(licenseBody.type).toBe(7);
    expect(licenseBody.driversLicense).toBeTruthy();
    expect(licenseBody.bankAccount).toBeNull();

    const toPassport = await api('PUT', `/api/ciphers/${created.id}`, token, {
      type: 8,
      name: ENC_STRING,
      passport: PASSPORT,
    });
    expect(toPassport.status).toBe(200);
    const passportBody = (await toPassport.json()) as any;
    expect(passportBody.type).toBe(8);
    expect(passportBody.passport).toBeTruthy();
    expect(passportBody.driversLicense).toBeNull();
  });
});

describe('typed encrypted-field validation errors', () => {
  it('400s a bank account whose encrypted field is not an EncString', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 6,
      name: ENC_STRING,
      bankAccount: { ...BANK_ACCOUNT, accountNumber: 'plaintext-not-encrypted' },
    });
    expect(res.status).toBe(400);
  });

  it('400s a drivers license whose encrypted field is not an EncString', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 7,
      name: ENC_STRING,
      driversLicense: { ...DRIVERS_LICENSE, licenseNumber: 'plaintext' },
    });
    expect(res.status).toBe(400);
  });

  it('400s a passport whose encrypted field is not an EncString', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 8,
      name: ENC_STRING,
      passport: { ...PASSPORT, passportNumber: 'plaintext' },
    });
    expect(res.status).toBe(400);
  });

  it('drops an SSH key whose private key is not an EncString (normalized to null)', async () => {
    // normalizeCipherSshKeyForCompatibility runs before validation and nulls the
    // whole sshKey object when any of the three key fields is not a valid
    // EncString, so the create succeeds with sshKey === null rather than 400ing.
    const res = await api('POST', '/api/ciphers', token, {
      type: 5,
      name: ENC_STRING,
      sshKey: { privateKey: 'plaintext', publicKey: ENC_STRING, keyFingerprint: ENC_STRING },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).sshKey).toBeNull();
  });

  it('400s a password-history entry whose password is not an EncString', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 1,
      name: ENC_STRING,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
      passwordHistory: [{ password: 'plaintext', lastUsedDate: new Date().toISOString() }],
    });
    expect(res.status).toBe(400);
  });

  it('400s a cipher whose name is not an EncString', async () => {
    const res = await api('POST', '/api/ciphers', token, {
      type: 1,
      name: 'plaintext-name',
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    });
    expect(res.status).toBe(400);
  });
});

describe('cipher delete-compat and archive guards', () => {
  it('soft-deletes an active cipher then hard-deletes it on a second DELETE (204)', async () => {
    const created = await create({
      type: 1,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    });

    // DELETE on an active cipher soft-deletes and returns cipherDetails.
    const soft = await api('DELETE', `/api/ciphers/${created.id}`, token);
    expect(soft.status).toBe(200);
    expect((await soft.json()).deletedDate).toBeTruthy();

    // DELETE on the trashed cipher purges it permanently (204 No Content).
    const hard = await api('DELETE', `/api/ciphers/${created.id}`, token);
    expect(hard.status).toBe(204);

    // It is gone.
    expect((await api('GET', `/api/ciphers/${created.id}`, token)).status).toBe(404);
  });

  it('refuses to archive a soft-deleted cipher (400)', async () => {
    const created = await create({
      type: 1,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    });
    expect((await api('PUT', `/api/ciphers/${created.id}/delete`, token)).status).toBe(200);

    const res = await api('PUT', `/api/ciphers/${created.id}/archive`, token, {});
    expect(res.status).toBe(400);
  });

  it('archives then unarchives an active cipher', async () => {
    const created = await create({
      type: 1,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    });

    const archived = await api('PUT', `/api/ciphers/${created.id}/archive`, token, {});
    expect(archived.status).toBe(200);
    expect((await archived.json()).archivedDate).toBeTruthy();

    const unarchived = await api('PUT', `/api/ciphers/${created.id}/unarchive`, token, {});
    expect(unarchived.status).toBe(200);
    expect((await unarchived.json()).archivedDate).toBeNull();
  });
});
