import { describe, expect, it } from 'vitest';
import { decryptSends, decryptVaultCore } from '@/lib/vault-decrypt';
import { encryptBw } from '@/lib/crypto';
import type { Cipher, Send } from '@/lib/types';

// Targets the weak-assertion mutation survivors in vault-decrypt.ts: the
// per-field card/identity/bankAccount/driversLicense/passport decryption (each
// field must map to its OWN decrypted value — distinct plaintexts catch a mutant
// that swaps or blanks a field), the `|| ''` empty-field defaults, the
// object-presence guards, the attachment user-key fallback, and the exact
// base64url `decShareKey` / `shareUrl` for a send.

const textEncoder = new TextEncoder();
const userEnc = textEncoder.encode('0123456789abcdef0123456789abcdef'); // 32 bytes
const userMac = textEncoder.encode('fedcba9876543210fedcba9876543210'); // 32 bytes

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
const symEncKeyB64 = bytesToB64(userEnc);
const symMacKeyB64 = bytesToB64(userMac);

function enc(value: string, e: Uint8Array = userEnc, m: Uint8Array = userMac): Promise<string> {
  return encryptBw(textEncoder.encode(value), e, m);
}

// Encrypt every value in a record with distinct plaintexts, so a mutant that
// swaps two output fields (or blanks one) is caught.
async function encFields<T extends Record<string, string>>(fields: T): Promise<T> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = await enc(v);
  return out as T;
}

async function decryptOne(cipher: Cipher): Promise<any> {
  const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
  return result.ciphers[0];
}

describe('vault-decrypt: card fields', () => {
  it('decrypts every card field to its own distinct value', async () => {
    const card = await encFields({
      cardholderName: 'Alice Holder',
      number: '4111111111111111',
      brand: 'Visa',
      expMonth: '12',
      expYear: '2030',
      code: '987',
    });
    const c = await decryptOne({ id: '1', type: 3, card } as unknown as Cipher);
    expect(c.card.decCardholderName).toBe('Alice Holder');
    expect(c.card.decNumber).toBe('4111111111111111');
    expect(c.card.decBrand).toBe('Visa');
    expect(c.card.decExpMonth).toBe('12');
    expect(c.card.decExpYear).toBe('2030');
    expect(c.card.decCode).toBe('987');
  });

  it('defaults a missing card field to empty string', async () => {
    const card = await encFields({ cardholderName: 'Only Name' });
    const c = await decryptOne({ id: '1', type: 3, card } as unknown as Cipher);
    expect(c.card.decCardholderName).toBe('Only Name');
    expect(c.card.decNumber).toBe('');
    expect(c.card.decCode).toBe('');
  });

  it('omits card decryption entirely when the cipher has no card object', async () => {
    const c = await decryptOne({ id: '1', type: 1, login: {} } as unknown as Cipher);
    expect(c.card).toBeUndefined();
  });
});

describe('vault-decrypt: identity fields', () => {
  it('decrypts each identity field to its own distinct value', async () => {
    const identity = await encFields({
      title: 'Dr',
      firstName: 'Ada',
      middleName: 'Mid',
      lastName: 'Lovelace',
      username: 'ada',
      company: 'Analytical',
      ssn: '111-22-3333',
      passportNumber: 'P1234567',
      licenseNumber: 'L7654321',
      email: 'ada@example.com',
      phone: '+15550001',
      address1: '1 Engine St',
      address2: 'Apt 2',
      address3: 'Floor 3',
      city: 'London',
      state: 'LDN',
      postalCode: 'EC1',
      country: 'UK',
    });
    const c = await decryptOne({ id: '1', type: 4, identity } as unknown as Cipher);
    const idn = c.identity;
    expect(idn.decTitle).toBe('Dr');
    expect(idn.decFirstName).toBe('Ada');
    expect(idn.decMiddleName).toBe('Mid');
    expect(idn.decLastName).toBe('Lovelace');
    expect(idn.decUsername).toBe('ada');
    expect(idn.decCompany).toBe('Analytical');
    expect(idn.decSsn).toBe('111-22-3333');
    expect(idn.decPassportNumber).toBe('P1234567');
    expect(idn.decLicenseNumber).toBe('L7654321');
    expect(idn.decEmail).toBe('ada@example.com');
    expect(idn.decPhone).toBe('+15550001');
    expect(idn.decAddress1).toBe('1 Engine St');
    expect(idn.decAddress2).toBe('Apt 2');
    expect(idn.decAddress3).toBe('Floor 3');
    expect(idn.decCity).toBe('London');
    expect(idn.decState).toBe('LDN');
    expect(idn.decPostalCode).toBe('EC1');
    expect(idn.decCountry).toBe('UK');
  });
});

describe('vault-decrypt: bankAccount / driversLicense / passport object fields', () => {
  it('decrypts every bankAccount field to its own distinct dec* key', async () => {
    const bankAccount = await encFields({
      bankName: 'First Bank',
      nameOnAccount: 'Ada L',
      accountType: 'checking',
      accountNumber: '000123',
      routingNumber: '110000',
      branchNumber: 'BR-9',
      pin: '4242',
      swiftCode: 'FIRSTUS33',
      iban: 'GB00FIRST',
      bankContactPhone: '+15550002',
    });
    const c = await decryptOne({ id: '1', type: 6, bankAccount } as unknown as Cipher);
    const ba = c.bankAccount;
    expect(ba.decBankName).toBe('First Bank');
    expect(ba.decNameOnAccount).toBe('Ada L');
    expect(ba.decAccountType).toBe('checking');
    expect(ba.decAccountNumber).toBe('000123');
    expect(ba.decRoutingNumber).toBe('110000');
    expect(ba.decBranchNumber).toBe('BR-9');
    expect(ba.decPin).toBe('4242');
    expect(ba.decSwiftCode).toBe('FIRSTUS33');
    expect(ba.decIban).toBe('GB00FIRST');
    expect(ba.decBankContactPhone).toBe('+15550002');
  });

  it('decrypts every driversLicense field to its own distinct dec* key', async () => {
    const driversLicense = await encFields({
      firstName: 'Ada',
      middleName: 'M',
      lastName: 'Lovelace',
      dateOfBirth: '1815-12-10',
      licenseNumber: 'DL-1',
      issuingCountry: 'UK',
      issuingState: 'LDN',
      issueDate: '2020-01-01',
      expirationDate: '2030-01-01',
      issuingAuthority: 'DVLA',
      licenseClass: 'B',
    });
    const c = await decryptOne({ id: '1', type: 7, driversLicense } as unknown as Cipher);
    const dl = c.driversLicense;
    expect(dl.decLicenseNumber).toBe('DL-1');
    expect(dl.decIssuingState).toBe('LDN');
    expect(dl.decLicenseClass).toBe('B');
    expect(dl.decIssuingAuthority).toBe('DVLA');
    expect(dl.decDateOfBirth).toBe('1815-12-10');
  });

  it('decrypts every passport field to its own distinct dec* key', async () => {
    const passport = await encFields({
      surname: 'Lovelace',
      givenName: 'Ada',
      dateOfBirth: '1815-12-10',
      sex: 'F',
      birthPlace: 'London',
      nationality: 'British',
      issuingCountry: 'UK',
      passportNumber: 'P7654321',
      passportType: 'PC',
      nationalIdentificationNumber: 'NID-9',
      issuingAuthority: 'HMPO',
      issueDate: '2020-01-01',
      expirationDate: '2030-01-01',
    });
    const c = await decryptOne({ id: '1', type: 8, passport } as unknown as Cipher);
    const pp = c.passport;
    expect(pp.decSurname).toBe('Lovelace');
    expect(pp.decGivenName).toBe('Ada');
    expect(pp.decBirthPlace).toBe('London');
    expect(pp.decNationality).toBe('British');
    expect(pp.decPassportNumber).toBe('P7654321');
    expect(pp.decNationalIdentificationNumber).toBe('NID-9');
    expect(pp.decPassportType).toBe('PC');
  });
});

describe('vault-decrypt: attachment user-key fallback', () => {
  it('falls back to the user key for an attachment filename when the item key differs', async () => {
    // Cipher uses a random item key, but the attachment filename was encrypted
    // under the USER key (legacy). Because the item key != user key, the
    // fallback (`!itemUsesUserKey`) must fire and decrypt the filename.
    const itemEncKey = crypto.getRandomValues(new Uint8Array(32));
    const itemMacKey = crypto.getRandomValues(new Uint8Array(32));
    const combined = new Uint8Array(64);
    combined.set(itemEncKey, 0);
    combined.set(itemMacKey, 32);
    const wrappedKey = await encryptBw(combined, userEnc, userMac);

    const cipher = {
      id: '1',
      type: 1,
      key: wrappedKey,
      login: { username: await enc('u', itemEncKey, itemMacKey) },
      attachments: [{ id: 'a1', fileName: await enc('legacy.pdf') /* user key */ }],
    } as unknown as Cipher;
    const c = await decryptOne(cipher);
    expect(c.attachments[0].decFileName).toBe('legacy.pdf');
  });
});

describe('vault-decrypt: decryptSends shareUrl / decShareKey', () => {
  it('derives the exact URL-safe decShareKey and shareUrl for a known send key', async () => {
    // 64-byte send key with a base64 form containing +, / and = so all three
    // base64url transforms (+->-, /->_, strip =) are load-bearing.
    const raw = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) raw[i] = (0xf0 + (i % 16)) & 0xff;
    const sendEnc = raw.slice(0, 32);
    const sendMac = raw.slice(32, 64);
    const wrappedSendKey = await encryptBw(raw, userEnc, userMac);

    const send = {
      id: 's1',
      accessId: 'access-1',
      key: wrappedSendKey,
      name: await enc('My Send', sendEnc, sendMac),
      notes: await enc('a note', sendEnc, sendMac),
      text: { text: await enc('secret text', sendEnc, sendMac), hidden: false },
    } as unknown as Send;

    const [decrypted] = await decryptSends({
      sends: [send],
      symEncKeyB64,
      symMacKeyB64,
      origin: 'https://vault.example',
    });

    expect(decrypted.decName).toBe('My Send');
    expect(decrypted.decNotes).toBe('a note');
    expect(decrypted.decText).toBe('secret text');
    // Exact URL-safe key (no +, /, or =); a dropped transform would differ here.
    const EXPECTED_SHARE_KEY =
      '8PHy8_T19vf4-fr7_P3-__Dx8vP09fb3-Pn6-_z9_v_w8fLz9PX29_j5-vv8_f7_8PHy8_T19vf4-fr7_P3-_w';
    expect(decrypted.decShareKey).toBe(EXPECTED_SHARE_KEY);
    expect(decrypted.shareUrl).toBe(`https://vault.example/#/send/access-1/${EXPECTED_SHARE_KEY}`);
    // No standard-base64 characters leaked through the URL-safe transform.
    expect(decrypted.decShareKey).not.toMatch(/[+/=]/);
  });

  it('leaves a keyless send undecrypted with empty fields and no shareUrl', async () => {
    const send = { id: 's2', accessId: 'access-2', name: await enc('x') } as unknown as Send;
    const [decrypted] = await decryptSends({
      sends: [send],
      symEncKeyB64,
      symMacKeyB64,
      origin: 'https://vault.example',
    });
    expect(decrypted.decName).toBe('');
    expect(decrypted.shareUrl).toBeUndefined();
    expect(decrypted.decShareKey).toBeUndefined();
  });
});
