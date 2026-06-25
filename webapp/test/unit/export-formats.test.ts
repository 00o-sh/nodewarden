import { strFromU8, unzipSync } from 'fflate';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMATS,
  attachNodeWardenEncryptedAttachmentPayload,
  buildAccountEncryptedBitwardenJsonString,
  buildBitwardenCsvString,
  buildBitwardenZipBytes,
  buildExportFileName,
  buildNodeWardenAttachmentRecords,
  buildNodeWardenPlainJsonDocument,
  buildPasswordProtectedBitwardenJsonString,
  buildPlainBitwardenJsonDocument,
  buildPlainBitwardenJsonString,
  encryptZipBytesWithPassword,
} from '@/lib/export-formats';
import { base64ToBytes, bytesToBase64, decryptStr, encryptBw } from '@/lib/crypto';
import type { Cipher, Folder } from '@/lib/types';

// ---- Test key material ---------------------------------------------------
// Deterministic 32-byte enc + mac keys so encrypt/decrypt round-trips work.
const userEnc = new Uint8Array(32).map((_, i) => (i + 1) & 0xff);
const userMac = new Uint8Array(32).map((_, i) => (i + 100) & 0xff);
const userEncB64 = bytesToBase64(userEnc);
const userMacB64 = bytesToBase64(userMac);

async function encStr(plaintext: string): Promise<string> {
  return encryptBw(new TextEncoder().encode(plaintext), userEnc, userMac);
}

function login(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'login-1',
    type: 1,
    name: 'GitHub',
    creationDate: '2020-01-01T00:00:00.000Z',
    revisionDate: '2020-01-02T00:00:00.000Z',
    login: {
      username: 'octocat',
      password: 'hunter2',
      totp: 'otpsecret',
      uris: [{ uri: 'https://github.com', match: null }],
    },
    ...overrides,
  };
}

describe('EXPORT_FORMATS', () => {
  it('exposes the expected format ids', () => {
    const ids = EXPORT_FORMATS.map((f) => f.id);
    expect(ids).toContain('bitwarden_json');
    expect(ids).toContain('bitwarden_csv');
    expect(ids).toContain('bitwarden_encrypted_json');
    expect(ids).toContain('nodewarden_json');
    expect(ids).toContain('nodewarden_encrypted_json');
    expect(ids).toHaveLength(7);
  });
});

describe('buildPlainBitwardenJsonDocument', () => {
  it('decrypts folder names and login fields, trims null keys', async () => {
    const folders: Folder[] = [{ id: 'f1', name: await encStr('Work') }];
    const cipher = login({
      folderId: 'f1',
      favorite: true,
      notes: await encStr('a note'),
      name: await encStr('GitHub'),
      login: {
        username: await encStr('octocat'),
        password: await encStr('hunter2'),
        totp: await encStr('totpseed'),
        uris: [{ uri: await encStr('https://github.com'), match: 0 }],
      },
    });

    const doc = await buildPlainBitwardenJsonDocument({
      folders,
      ciphers: [cipher],
      userEncB64,
      userMacB64,
    });

    expect(doc.encrypted).toBe(false);
    expect(doc.folders).toEqual([{ id: 'f1', name: 'Work' }]);
    const items = doc.items as Record<string, any>[];
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('GitHub');
    expect(items[0].notes).toBe('a note');
    expect(items[0].favorite).toBe(true);
    expect(items[0].folderId).toBe('f1');
    expect(items[0].login.username).toBe('octocat');
    expect(items[0].login.password).toBe('hunter2');
    expect(items[0].login.totp).toBe('totpseed');
    expect(items[0].login.uris).toEqual([{ uri: 'https://github.com', match: 0 }]);
    // common metadata
    expect(items[0].type).toBe(1);
    expect(items[0].reprompt).toBe(0);
    expect(items[0].collectionIds).toBeNull();
  });

  it('passes through plaintext (non-cipher-string) values unchanged', async () => {
    const doc = await buildPlainBitwardenJsonDocument({
      folders: [],
      ciphers: [login()],
      userEncB64,
      userMacB64,
    });
    const item = (doc.items as Record<string, any>[])[0];
    expect(item.name).toBe('GitHub');
    expect(item.login.username).toBe('octocat');
  });

  it('omits creationDate/revisionDate/folderId when absent', async () => {
    const cipher: Cipher = { id: 'c1', type: 1, name: 'Bare', login: { username: 'u' } };
    const doc = await buildPlainBitwardenJsonDocument({
      folders: [],
      ciphers: [cipher],
      userEncB64,
      userMacB64,
    });
    const item = (doc.items as Record<string, any>[])[0];
    expect('creationDate' in item).toBe(false);
    expect('revisionDate' in item).toBe(false);
    expect('folderId' in item).toBe(false);
  });

  it('maps card, identity, secureNote, sshKey, fields and passwordHistory', async () => {
    const card: Cipher = {
      id: 'card-1',
      type: 3,
      name: 'My Card',
      card: { cardholderName: 'Jane', brand: 'Visa', number: '4111', expMonth: '12', expYear: '2030', code: '123' },
      fields: [{ name: 'pin', value: '0000', type: 1, linkedId: null }],
      passwordHistory: [{ password: await encStr('old-pw'), lastUsedDate: '2019-01-01T00:00:00.000Z' }],
    };
    const identity: Cipher = {
      id: 'id-1',
      type: 4,
      name: 'Me',
      identity: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    };
    const note: Cipher = { id: 'note-1', type: 2, name: 'Wifi', secureNote: { type: 0 } };
    const ssh: Cipher = {
      id: 'ssh-1',
      type: 5,
      name: 'Key',
      sshKey: { privateKey: await encStr('PRIV'), publicKey: 'PUB', keyFingerprint: 'FP' },
    };

    const doc = await buildPlainBitwardenJsonDocument({
      folders: [],
      ciphers: [card, identity, note, ssh],
      userEncB64,
      userMacB64,
    });
    const items = doc.items as Record<string, any>[];

    expect(items[0].card.cardholderName).toBe('Jane');
    expect(items[0].card.number).toBe('4111');
    expect(items[0].fields).toEqual([{ name: 'pin', value: '0000', type: 1, linkedId: null }]);
    expect(items[0].passwordHistory[0].password).toBe('old-pw');
    expect(items[0].passwordHistory[0].lastUsedDate).toBe('2019-01-01T00:00:00.000Z');
    expect(items[0].login).toBeNull();

    expect(items[1].identity.firstName).toBe('Ada');
    expect(items[1].identity.email).toBe('ada@example.com');

    expect(items[2].secureNote).toEqual({ type: 0 });

    expect(items[3].sshKey.privateKey).toBe('PRIV');
    expect(items[3].sshKey.publicKey).toBe('PUB');
    expect(items[3].sshKey.keyFingerprint).toBe('FP');
    // legacy alias kept
    expect(items[3].sshKey.fingerprint).toBe('FP');
  });

  it('deep-decrypts login fido2Credentials and nested card values', async () => {
    const cipher = login({
      login: {
        username: 'u',
        fido2Credentials: [{ credentialId: await encStr('cred-secret'), counter: 5 }],
      },
      card: { number: await encStr('4111') } as never,
    });
    const doc = await buildPlainBitwardenJsonDocument({ folders: [], ciphers: [cipher], userEncB64, userMacB64 });
    const item = (doc.items as Record<string, any>[])[0];
    expect(item.login.fido2Credentials[0].credentialId).toBe('cred-secret');
    // counter is a number primitive -> returned untouched by deepDecryptUnknown
    expect(item.login.fido2Credentials[0].counter).toBe(5);
    expect(item.card.number).toBe('4111');
  });

  it('deep-decrypts arrays nested inside identity/card objects', async () => {
    const identity: Cipher = {
      id: 'arr',
      type: 4,
      name: 'Me',
      identity: { firstName: 'Ada', tags: [await encStr('one'), await encStr('two')] } as never,
    };
    const doc = await buildPlainBitwardenJsonDocument({ folders: [], ciphers: [identity], userEncB64, userMacB64 });
    const item = (doc.items as Record<string, any>[])[0];
    expect(item.identity.tags).toEqual(['one', 'two']);
  });

  it('uses the legacy sshKey.fingerprint when keyFingerprint is absent', async () => {
    const ssh: Cipher = { id: 'ssh-2', type: 5, name: 'K', sshKey: { privateKey: 'p', fingerprint: 'legacyFP' } };
    const doc = await buildPlainBitwardenJsonDocument({ folders: [], ciphers: [ssh], userEncB64, userMacB64 });
    const item = (doc.items as Record<string, any>[])[0];
    expect(item.sshKey.keyFingerprint).toBe('legacyFP');
    expect(item.sshKey.fingerprint).toBe('legacyFP');
  });

  it('defaults login/card/identity/sshKey/secureNote to null and arrays to []', async () => {
    const bare: Cipher = { id: 'bare', type: 1, name: 'B' };
    const doc = await buildPlainBitwardenJsonDocument({ folders: [], ciphers: [bare], userEncB64, userMacB64 });
    const item = (doc.items as Record<string, any>[])[0];
    expect(item.login).toBeNull();
    expect(item.card).toBeNull();
    expect(item.identity).toBeNull();
    expect(item.sshKey).toBeNull();
    expect(item.secureNote).toBeNull();
    expect(item.fields).toEqual([]);
    expect(item.passwordHistory).toEqual([]);
  });

  it('decrypts per-cipher key when cipher.key is present', async () => {
    // Build a 64-byte cipher key, wrap it under the user key.
    const cipherKeyRaw = new Uint8Array(64).map((_, i) => (i + 7) & 0xff);
    const cipherEnc = cipherKeyRaw.slice(0, 32);
    const cipherMac = cipherKeyRaw.slice(32, 64);
    const wrappedKey = await encryptBw(cipherKeyRaw, userEnc, userMac);
    const secret = await encryptBw(new TextEncoder().encode('per-cipher-secret'), cipherEnc, cipherMac);

    const cipher: Cipher = { id: 'k', type: 1, key: wrappedKey, name: secret, login: { username: 'u' } };
    const doc = await buildPlainBitwardenJsonDocument({ folders: [], ciphers: [cipher], userEncB64, userMacB64 });
    expect((doc.items as Record<string, any>[])[0].name).toBe('per-cipher-secret');
  });

  it('falls back to user key when cipher.key is too short to decrypt to 64 bytes', async () => {
    const shortKey = await encryptBw(new Uint8Array(16).fill(9), userEnc, userMac);
    const name = await encStr('UserKeyName');
    const cipher: Cipher = { id: 'k2', type: 1, key: shortKey, name, login: { username: 'u' } };
    const doc = await buildPlainBitwardenJsonDocument({ folders: [], ciphers: [cipher], userEncB64, userMacB64 });
    expect((doc.items as Record<string, any>[])[0].name).toBe('UserKeyName');
  });

  it('filters out deleted and organization-owned ciphers', async () => {
    const deleted: Cipher = { id: 'd', type: 1, name: 'Deleted', deletedDate: '2021-01-01T00:00:00.000Z' };
    const org = { id: 'o', type: 1, name: 'Org', organizationId: 'org-1' } as unknown as Cipher;
    const keep = login({ id: 'keep', name: 'Keep' });
    const doc = await buildPlainBitwardenJsonDocument({
      folders: [],
      ciphers: [deleted, org, keep],
      userEncB64,
      userMacB64,
    });
    const items = doc.items as Record<string, any>[];
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('keep');
  });

  it('handles an empty vault', async () => {
    const doc = await buildPlainBitwardenJsonDocument({ folders: [], ciphers: [], userEncB64, userMacB64 });
    expect(doc.folders).toEqual([]);
    expect(doc.items).toEqual([]);
  });

  it('leaves an undecryptable cipher string intact (decrypt failure fallback)', async () => {
    // Valid cipher-string shape but encrypted with the wrong key -> MAC mismatch.
    const otherEnc = new Uint8Array(32).fill(5);
    const otherMac = new Uint8Array(32).fill(6);
    const bad = await encryptBw(new TextEncoder().encode('secret'), otherEnc, otherMac);
    const doc = await buildPlainBitwardenJsonDocument({
      folders: [],
      ciphers: [{ id: 'x', type: 1, name: bad }],
      userEncB64,
      userMacB64,
    });
    expect((doc.items as Record<string, any>[])[0].name).toBe(bad);
  });
});

describe('buildPlainBitwardenJsonString', () => {
  it('produces pretty-printed JSON matching the document', async () => {
    const str = await buildPlainBitwardenJsonString({ folders: [], ciphers: [login()], userEncB64, userMacB64 });
    expect(str).toContain('\n  ');
    const parsed = JSON.parse(str);
    expect(parsed.encrypted).toBe(false);
    expect(parsed.items[0].name).toBe('GitHub');
  });
});

describe('buildBitwardenCsvString', () => {
  async function csvFor(ciphers: Cipher[], folders: Folder[] = []): Promise<string> {
    const doc = await buildPlainBitwardenJsonDocument({ folders, ciphers, userEncB64, userMacB64 });
    return buildBitwardenCsvString(doc);
  }

  it('starts with a BOM and the standard header row, rows are CRLF-terminated', async () => {
    const csv = await csvFor([login()]);
    expect(csv.startsWith('﻿')).toBe(true);
    const body = csv.slice(1);
    const lines = body.split('\r\n');
    expect(lines[0]).toBe(
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp'
    );
    // trailing CRLF means last element is empty
    expect(lines[lines.length - 1]).toBe('');
  });

  it('emits login rows with uri/username/password/totp and folder name', async () => {
    const folders: Folder[] = [{ id: 'f1', name: await encStr('Work') }];
    const csv = await csvFor([login({ folderId: 'f1', favorite: true })], folders);
    const row = csv.slice(1).split('\r\n')[1];
    expect(row).toBe('Work,1,login,GitHub,,,0,https://github.com,octocat,hunter2,otpsecret');
  });

  it('uses favorite "0" and blank folder for non-favorite, folderless logins', async () => {
    const csv = await csvFor([login({ favorite: false })]);
    const row = csv.slice(1).split('\r\n')[1];
    expect(row.startsWith(',0,login,GitHub,')).toBe(true);
  });

  it('renders empty names as "--"', async () => {
    const csv = await csvFor([{ id: 'n', type: 1, name: '', login: { username: 'u' } }]);
    const row = csv.slice(1).split('\r\n')[1];
    expect(row.split(',')[3]).toBe('--');
  });

  it('classifies non-login types as "note" and clears login columns', async () => {
    const note: Cipher = { id: 'note', type: 2, name: 'Wifi', notes: 'SSID home', secureNote: { type: 0 } };
    const csv = await csvFor([note]);
    const row = csv.slice(1).split('\r\n')[1];
    const cols = row.split(',');
    expect(cols[2]).toBe('note');
    expect(cols[4]).toBe('SSID home');
    // login_uri, login_username, login_password, login_totp all empty
    expect(cols.slice(7)).toEqual(['', '', '', '']);
  });

  it('serializes custom fields into the fields column', async () => {
    const cipher = login({ fields: [{ name: 'PIN', value: '1234', type: 0, linkedId: null }] });
    const csv = await csvFor([cipher]);
    const row = csv.slice(1).split('\r\n')[1];
    // field column is quoted only if it needs escaping; "PIN: 1234" has no special chars
    expect(row).toContain('PIN: 1234');
  });

  it('adds nodewardenType and record field lines for card/identity types', async () => {
    const card: Cipher = {
      id: 'c',
      type: 3,
      name: 'Card',
      card: { cardholderName: 'Jane', number: '4111', brand: null, expMonth: null, expYear: null, code: null },
    };
    const csv = await csvFor([card]);
    // multi-line field cell -> must be quoted
    expect(csv).toContain('nodewardenType: card');
    expect(csv).toContain('card.cardholderName: Jane');
    expect(csv).toContain('card.number: 4111');
    // null card fields are skipped (empty text)
    expect(csv).not.toContain('card.brand:');
  });

  it('escapes cells containing commas, quotes and newlines', async () => {
    const cipher = login({
      name: 'Acme, Inc.',
      notes: 'say "hi"\nbye',
    });
    const csv = await csvFor([cipher]);
    expect(csv).toContain('"Acme, Inc."');
    expect(csv).toContain('"say ""hi""\nbye"');
  });

  it('handles malformed docs defensively (non-array items / non-record entries)', () => {
    expect(buildBitwardenCsvString({} as Record<string, unknown>)).toContain('folder,favorite,type');
    const csv = buildBitwardenCsvString({ items: [null, 'x', { type: 1, name: 'OK' }] } as Record<string, unknown>);
    const lines = csv.slice(1).split('\r\n');
    // only the one valid record produced a data row
    expect(lines.filter((l) => l && !l.startsWith('folder,'))).toHaveLength(1);
  });

  it('labels identity and sshKey source types in the fields column', async () => {
    const identity: Cipher = { id: 'i', type: 4, name: 'Me', identity: { firstName: 'Ada', lastName: 'L' } };
    const ssh: Cipher = { id: 's', type: 5, name: 'K', sshKey: { privateKey: 'pk', publicKey: 'pub', keyFingerprint: 'fp' } };
    const csv = await csvFor([identity, ssh]);
    expect(csv).toContain('nodewardenType: identity');
    expect(csv).toContain('identity.firstName: Ada');
    expect(csv).toContain('nodewardenType: sshKey');
    expect(csv).toContain('sshKey.publicKey: pub');
  });

  it('serializes non-string field values (numbers/booleans) via csvText', () => {
    const csv = buildBitwardenCsvString({
      items: [{ type: 1, name: 'X', favorite: false, login: { uris: [{ uri: 'u' }] }, fields: [{ name: 'count', value: 7 }, { name: 'flag', value: true }] }],
    } as Record<string, unknown>);
    expect(csv).toContain('count: 7');
    expect(csv).toContain('flag: true');
  });

  it('JSON-stringifies object field values via csvText', () => {
    const csv = buildBitwardenCsvString({
      items: [{ type: 1, name: 'X', login: { uris: [] }, fields: [{ name: 'meta', value: { a: 1 } }] }],
    } as Record<string, unknown>);
    // value object is JSON-stringified by csvText, then CSV-escaped (quotes doubled).
    expect(csv).toContain('"meta: {""a"":1}"');
  });

  it('ignores folders without ids when building the name map', () => {
    const csv = buildBitwardenCsvString({
      folders: [{ name: 'NoId' }, { id: '', name: 'Empty' }],
      items: [{ type: 1, name: 'X', folderId: '' }],
    } as Record<string, unknown>);
    const row = csv.slice(1).split('\r\n')[1];
    expect(row.split(',')[0]).toBe('');
  });
});

describe('buildAccountEncryptedBitwardenJsonString', () => {
  it('keeps ciphers encrypted and emits a decryptable validation token', async () => {
    const folders: Folder[] = [{ id: 'f1', name: '2.cipher|folder|name' }];
    const nameCt = await encStr('GitHub');
    const cipher = login({ name: nameCt, folderId: 'f1', favorite: true });
    const str = await buildAccountEncryptedBitwardenJsonString({ folders, ciphers: [cipher], userEncB64, userMacB64 });
    const doc = JSON.parse(str);

    expect(doc.encrypted).toBe(true);
    expect(typeof doc.encKeyValidation_DO_NOT_EDIT).toBe('string');
    // validation token round-trips with the user key
    const validated = await decryptStr(doc.encKeyValidation_DO_NOT_EDIT, userEnc, userMac);
    expect(validated).toMatch(/^[0-9a-f-]{36}$/);

    // folders are passed through verbatim (still encrypted)
    expect(doc.folders).toEqual([{ id: 'f1', name: '2.cipher|folder|name' }]);
    // the cipher name is the still-encrypted string
    expect(doc.items[0].name).toBe(nameCt);
    expect(doc.items[0].favorite).toBe(true);
    expect(doc.items[0].login.username).toBe('octocat');
  });

  it('maps encrypted card/identity/secureNote/sshKey/fields/passwordHistory shapes', async () => {
    const card: Cipher = {
      id: 'c',
      type: 3,
      name: 'Card',
      key: '2.k|e|y',
      card: { cardholderName: 'enc', brand: 'enc', number: 'enc', expMonth: 'enc', expYear: 'enc', code: 'enc' },
      fields: [{ name: 'f', value: 'v', type: 2, linkedId: 7 }],
      passwordHistory: [{ password: 'p', lastUsedDate: 'd' }],
      login: { uris: [{ uri: 'u', uriChecksum: 'cs', match: 3 }], fido2Credentials: [{ id: 'x' }] },
      identity: { firstName: 'enc' },
      secureNote: { type: 0 },
      sshKey: { privateKey: 'pk', publicKey: 'pub', fingerprint: 'fp' },
    };
    const doc = JSON.parse(
      await buildAccountEncryptedBitwardenJsonString({ folders: [], ciphers: [card], userEncB64, userMacB64 })
    );
    const item = doc.items[0];
    expect(item.key).toBe('2.k|e|y');
    expect(item.card.cardholderName).toBe('enc');
    expect(item.fields).toEqual([{ name: 'f', value: 'v', type: 2, linkedId: 7 }]);
    expect(item.passwordHistory).toEqual([{ password: 'p', lastUsedDate: 'd' }]);
    expect(item.login.uris[0]).toMatchObject({ uri: 'u', uriChecksum: 'cs', match: 3 });
    expect(item.login.fido2Credentials).toEqual([{ id: 'x' }]);
    expect(item.identity.firstName).toBe('enc');
    expect(item.secureNote).toEqual({ type: 0 });
    expect(item.sshKey.keyFingerprint).toBe('fp');
    expect(item.sshKey.fingerprint).toBe('fp');
  });

  it('defaults missing optional structures to null/[] in encrypted mode', async () => {
    const bare: Cipher = { id: 'b', type: 1, name: 'enc' };
    const doc = JSON.parse(
      await buildAccountEncryptedBitwardenJsonString({ folders: [], ciphers: [bare], userEncB64, userMacB64 })
    );
    const item = doc.items[0];
    expect(item.login).toBeNull();
    expect(item.card).toBeNull();
    expect(item.identity).toBeNull();
    expect(item.secureNote).toBeNull();
    expect(item.sshKey).toBeNull();
    expect(item.fields).toEqual([]);
    expect(item.passwordHistory).toEqual([]);
    expect(item.key).toBeNull();
  });
});

describe('buildPasswordProtectedBitwardenJsonString', () => {
  const plaintextJson = JSON.stringify({ encrypted: false, items: [] });

  it('throws when the password is blank', async () => {
    await expect(
      buildPasswordProtectedBitwardenJsonString({
        plaintextJson,
        password: '   ',
        kdf: { kdfType: 0, kdfIterations: 5 },
      })
    ).rejects.toThrow('File password is required');
  });

  it('encrypts with PBKDF2 (kdfType 0) and round-trips the payload', async () => {
    const out = JSON.parse(
      await buildPasswordProtectedBitwardenJsonString({
        plaintextJson,
        password: 'secret-pw',
        kdf: { kdfType: 0, kdfIterations: 5 },
      })
    );
    expect(out.encrypted).toBe(true);
    expect(out.passwordProtected).toBe(true);
    expect(out.kdfType).toBe(0);
    expect(out.kdfIterations).toBe(5);
    expect(typeof out.salt).toBe('string');
    expect('kdfMemory' in out).toBe(false);

    // Re-derive the key and decrypt data to confirm correctness.
    const { hkdfExpand, pbkdf2 } = await import('@/lib/crypto');
    const keyMaterial = await pbkdf2('secret-pw', new TextEncoder().encode(out.salt), 5, 32);
    const enc = await hkdfExpand(keyMaterial, 'enc', 32);
    const mac = await hkdfExpand(keyMaterial, 'mac', 32);
    expect(await decryptStr(out.data, enc, mac)).toBe(plaintextJson);
  });

  it('encrypts with Argon2id (kdfType 1) and includes memory/parallelism', async () => {
    const out = JSON.parse(
      await buildPasswordProtectedBitwardenJsonString({
        plaintextJson,
        password: 'secret-pw',
        kdf: { kdfType: 1, kdfIterations: 1, kdfMemory: 16, kdfParallelism: 1 },
      })
    );
    expect(out.kdfType).toBe(1);
    expect(out.kdfMemory).toBe(16);
    expect(out.kdfParallelism).toBe(1);
    expect(typeof out.data).toBe('string');
  });

  it('applies defaults/floors for missing kdf parameters', async () => {
    const out = JSON.parse(
      await buildPasswordProtectedBitwardenJsonString({
        plaintextJson,
        password: 'pw',
        kdf: {} as never,
      })
    );
    // pbkdf2 default iterations
    expect(out.kdfIterations).toBe(600000);
    expect(out.kdfType).toBe(0);
  });
});

describe('buildExportFileName', () => {
  it('returns format-appropriate names with a timestamp', () => {
    expect(buildExportFileName('bitwarden_csv')).toMatch(/^bitwarden_export_\d{8}_\d{6}\.csv$/);
    expect(buildExportFileName('bitwarden_json')).toMatch(/^bitwarden_export_\d{8}_\d{6}\.json$/);
    expect(buildExportFileName('bitwarden_encrypted_json')).toMatch(/\.json$/);
    expect(buildExportFileName('nodewarden_json')).toMatch(/^nodewarden_export_\d{8}_\d{6}\.json$/);
    expect(buildExportFileName('nodewarden_encrypted_json')).toMatch(/^nodewarden_export_\d{8}_\d{6}\.json$/);
    expect(buildExportFileName('bitwarden_json_zip')).toMatch(/\.zip$/);
    expect(buildExportFileName('bitwarden_encrypted_json_zip', true)).toMatch(/\.zip$/);
    expect(buildExportFileName('bitwarden_json_zip', false)).toMatch(/\.zip$/);
    // unknown format falls through to .bin
    expect(buildExportFileName('mystery' as never)).toMatch(/\.bin$/);
  });
});

describe('buildBitwardenZipBytes', () => {
  it('includes data.json and namespaces attachments by cipher id', () => {
    const zip = buildBitwardenZipBytes('{"hello":1}', [
      { cipherId: 'c1', fileName: 'a.txt', bytes: new TextEncoder().encode('AAA') },
      { cipherId: 'c2', fileName: 'b.txt', bytes: new TextEncoder().encode('BBB') },
    ]);
    const files = unzipSync(zip);
    expect(strFromU8(files['data.json'])).toBe('{"hello":1}');
    expect(strFromU8(files['attachments/c1/a.txt'])).toBe('AAA');
    expect(strFromU8(files['attachments/c2/b.txt'])).toBe('BBB');
  });

  it('skips attachments with an empty cipher id', () => {
    const zip = buildBitwardenZipBytes('{}', [
      { cipherId: '   ', fileName: 'skip.txt', bytes: new TextEncoder().encode('X') },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(['data.json']);
  });

  it('deduplicates colliding file names within the same cipher', () => {
    const zip = buildBitwardenZipBytes('{}', [
      { cipherId: 'c1', fileName: 'dup.txt', bytes: new TextEncoder().encode('1') },
      { cipherId: 'c1', fileName: 'dup.txt', bytes: new TextEncoder().encode('2') },
    ]);
    const names = Object.keys(unzipSync(zip)).filter((n) => n !== 'data.json');
    expect(names).toContain('attachments/c1/dup.txt');
    expect(names).toContain('attachments/c1/dup (1).txt');
  });

  it('truncates very long file names while preserving short extensions', () => {
    const longBase = 'x'.repeat(300);
    const zip = buildBitwardenZipBytes('{}', [
      { cipherId: 'c1', fileName: `${longBase}.txt`, bytes: new TextEncoder().encode('1') },
      { cipherId: 'c2', fileName: 'y'.repeat(300), bytes: new TextEncoder().encode('2') },
    ]);
    const names = Object.keys(unzipSync(zip)).filter((n) => n !== 'data.json');
    const withExt = names.find((n) => n.startsWith('attachments/c1/'))!;
    const fileName1 = withExt.slice('attachments/c1/'.length);
    expect(fileName1.endsWith('.txt')).toBe(true);
    expect(fileName1.length).toBe(240);
    const noExt = names.find((n) => n.startsWith('attachments/c2/'))!;
    expect(noExt.slice('attachments/c2/'.length).length).toBe(240);
  });

  it('sanitizes path separators and falls back for empty names', () => {
    const zip = buildBitwardenZipBytes('{}', [
      { cipherId: 'c1', fileName: 'a/b\\c.txt', bytes: new TextEncoder().encode('1') },
      { cipherId: 'c2', fileName: '', bytes: new TextEncoder().encode('2') },
    ]);
    const names = Object.keys(unzipSync(zip));
    expect(names).toContain('attachments/c1/a_b_c.txt');
    expect(names).toContain('attachments/c2/attachment.bin');
  });
});

describe('encryptZipBytesWithPassword', () => {
  it('returns the input untouched when no password is supplied', async () => {
    const zip = buildBitwardenZipBytes('{}', []);
    const res = await encryptZipBytesWithPassword(zip, '   ');
    expect(res.encrypted).toBe(false);
    expect(res.bytes).toBe(zip);
  });

  it('re-encrypts directory entries as well as file entries', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    // A zip containing an explicit directory entry plus a file.
    const zip = zipSync({ 'dir/': new Uint8Array(0), 'dir/f.txt': strToU8('inside') });
    const res = await encryptZipBytesWithPassword(zip, 'pw');
    expect(res.encrypted).toBe(true);
    const reader = new ZipReader(new Uint8ArrayReader(res.bytes), { password: 'pw', useWebWorkers: false });
    try {
      const entries = await reader.getEntries();
      const dir = entries.find((e) => e.directory);
      expect(dir).toBeTruthy();
      const file = entries.find((e) => e.filename === 'dir/f.txt')!;
      const data = await file.getData!(new Uint8ArrayWriter());
      expect(new TextDecoder().decode(data)).toBe('inside');
    } finally {
      await reader.close();
    }
  });

  it('produces a password-protected zip that decrypts back to the originals', async () => {
    const zip = buildBitwardenZipBytes('{"v":1}', [
      { cipherId: 'c1', fileName: 'note.txt', bytes: new TextEncoder().encode('hello') },
    ]);
    const res = await encryptZipBytesWithPassword(zip, 'zippw');
    expect(res.encrypted).toBe(true);

    const reader = new ZipReader(new Uint8ArrayReader(res.bytes), { password: 'zippw', useWebWorkers: false });
    try {
      const entries = await reader.getEntries();
      const byName = new Map(entries.map((e) => [e.filename, e]));
      const dataEntry = byName.get('data.json')!;
      expect(dataEntry.encrypted).toBe(true);
      const data = await dataEntry.getData!(new Uint8ArrayWriter());
      expect(new TextDecoder().decode(data)).toBe('{"v":1}');
      const note = await byName.get('attachments/c1/note.txt')!.getData!(new Uint8ArrayWriter());
      expect(new TextDecoder().decode(note)).toBe('hello');
    } finally {
      await reader.close();
    }
  });
});

describe('buildNodeWardenAttachmentRecords', () => {
  it('base64-encodes data, sanitizes names and resolves cipher index', () => {
    const idx = new Map<string, number>([['c1', 4]]);
    const records = buildNodeWardenAttachmentRecords(
      [
        { cipherId: 'c1', fileName: 'a/b.txt', bytes: new TextEncoder().encode('hi') },
        { cipherId: 'c2', fileName: '', bytes: new TextEncoder().encode('yo') },
        { cipherId: '  ', fileName: 'skip.txt', bytes: new TextEncoder().encode('no') },
      ],
      idx
    );
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ cipherId: 'c1', cipherIndex: 4, fileName: 'a_b.txt', data: bytesToBase64(new TextEncoder().encode('hi')) });
    expect(records[1].cipherIndex).toBeNull();
    expect(records[1].fileName).toBe('attachment.bin');
  });

  it('defaults cipherIndex to null when no index map is given', () => {
    const records = buildNodeWardenAttachmentRecords([
      { cipherId: 'c1', fileName: 'f.txt', bytes: new Uint8Array([1]) },
    ]);
    expect(records[0].cipherIndex).toBeNull();
  });
});

describe('buildNodeWardenPlainJsonDocument', () => {
  it('merges the bitwarden doc with nodewarden metadata', () => {
    const doc = buildNodeWardenPlainJsonDocument(
      { encrypted: false, items: [{ id: 'x' }] },
      [{ cipherId: 'c1', cipherIndex: 0, fileName: 'f.txt', data: 'AA==' }]
    );
    expect(doc.encrypted).toBe(false);
    expect(doc.items).toEqual([{ id: 'x' }]);
    expect(doc.nodewardenFormat).toBe('nodewarden_json');
    expect(doc.nodewardenVersion).toBe(1);
    expect(doc.nodewardenAttachments).toHaveLength(1);
  });
});

describe('attachNodeWardenEncryptedAttachmentPayload', () => {
  it('adds an encrypted attachment payload that decrypts back to the records', async () => {
    const records = [{ cipherId: 'c1', cipherIndex: 0, fileName: 'f.txt', data: 'AA==' }];
    const baseJson = JSON.stringify({ encrypted: true, items: [] });
    const out = await attachNodeWardenEncryptedAttachmentPayload(baseJson, records, userEncB64, userMacB64);
    const parsed = JSON.parse(out);

    expect(parsed.encrypted).toBe(true);
    expect(parsed.nodewardenFormat).toBe('nodewarden_json');
    expect(parsed.nodewardenVersion).toBe(1);
    expect(typeof parsed.nodewardenAttachmentsEnc).toBe('string');

    const decrypted = JSON.parse(await decryptStr(parsed.nodewardenAttachmentsEnc, userEnc, userMac));
    expect(decrypted.nodewardenFormat).toBe('nodewarden_json');
    expect(decrypted.nodewardenAttachments).toEqual(records);
  });

  it('preserves pre-existing fields on the parsed document', async () => {
    const baseJson = JSON.stringify({ encrypted: true, custom: 'keep', items: [{ id: 'a' }] });
    const out = JSON.parse(await attachNodeWardenEncryptedAttachmentPayload(baseJson, [], userEncB64, userMacB64));
    expect(out.custom).toBe('keep');
    expect(out.items).toEqual([{ id: 'a' }]);
  });
});

// Sanity check that test key material round-trips through the crypto layer.
describe('test fixtures', () => {
  it('encrypts and decrypts with the shared key material', async () => {
    const ct = await encStr('round-trip');
    expect(await decryptStr(ct, base64ToBytes(userEncB64), base64ToBytes(userMacB64))).toBe('round-trip');
  });
});
