import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decryptStr,
  encryptBw,
  encryptBwFileData,
  sha256Base64,
} from '@/lib/crypto';
import type { Cipher, SessionState, VaultDraft } from '@/lib/types';
import {
  archiveCipher,
  bulkArchiveCiphers,
  bulkMoveCiphers,
  bulkPermanentDeleteCiphers,
  bulkRestoreCiphers,
  bulkUnarchiveCiphers,
  bulkDeleteFolders,
  createCipher,
  deleteCipher,
  deleteCipherAttachment,
  downloadCipherAttachmentDecrypted,
  getCipherById,
  getFolderById,
  permanentDeleteCipher,
  repairCipherKeyMismatches,
  repairCipherUriChecksums,
  unarchiveCipher,
  updateCipher,
  updateFolder,
  uploadCipherAttachment,
} from '@/lib/api/vault';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const emptyOk = () => Promise.resolve(new Response(null, { status: 200 }));
const fail = (status = 500) => () => Promise.resolve(new Response(null, { status }));

// Raw symmetric key bytes that back unlockedSession(); encrypted payload fields
// round-trip through decryptStr with these.
const USER_ENC = new Uint8Array(32).fill(7);
const USER_MAC = new Uint8Array(32).fill(9);

function unlockedSession(): SessionState {
  return {
    email: 'user@example.com',
    authMode: 'token',
    accessToken: 'tok',
    symEncKey: bytesToBase64(USER_ENC),
    symMacKey: bytesToBase64(USER_MAC),
  } as SessionState;
}

const lastInit = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][1];

// A minimal draft skeleton — callers override just the fields under test.
function baseDraft(over: Partial<VaultDraft>): VaultDraft {
  return {
    type: 1,
    name: 'Item',
    notes: '',
    favorite: false,
    reprompt: false,
    folderId: '',
    loginUsername: '',
    loginPassword: '',
    loginTotp: '',
    loginUris: [],
    loginFido2Credentials: [],
    customFields: [],
    ...over,
  } as unknown as VaultDraft;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api/vault bulkDeleteFolders', () => {
  it('dedupes/trims ids and posts them to the folder delete collection', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkDeleteFolders(authedFetch as any, ['f1', ' f1 ', '', '  ', 'f2']);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/folders/delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ids: ['f1', 'f2'] });
  });

  it('throws when a chunk fails', async () => {
    await expect(bulkDeleteFolders(vi.fn(fail()) as any, ['f1'])).rejects.toThrow('Bulk delete folders failed');
  });
});

describe('api/vault buildCipherPayload for a login (type 1)', () => {
  it('encrypts login fields, dedupes URIs, computes checksums and normalizes fido2 credentials', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    // A credentialId already in cipher-string form must be preserved verbatim, not re-encrypted.
    const preEncryptedCredId = await encryptBw(new TextEncoder().encode('cred-abc'), USER_ENC, USER_MAC);
    const draft = baseDraft({
      type: 1,
      name: 'GitHub',
      notes: 'note',
      favorite: true,
      reprompt: true,
      folderId: 'fold-1',
      loginUsername: 'octocat',
      loginPassword: 'hunter2',
      loginTotp: 'JBSWY3DPEHPK3PXP',
      loginUris: [
        { uri: 'https://github.com', match: 0, originalUri: '', extra: {} },
        { uri: 'https://github.com', match: null, originalUri: '', extra: {} }, // duplicate -> dropped
        { uri: '   ', match: null, originalUri: '', extra: {} }, // blank -> dropped
      ] as any,
      loginFido2Credentials: [
        {
          credentialId: preEncryptedCredId,
          keyValue: 'raw-key-value',
          rpId: 'github.com',
          rpName: '', // empty nullable -> null
          userName: 'octocat',
          creationDate: 'not-a-date',
        },
      ] as any,
      customFields: [
        { type: 1, label: 'Hidden', value: 'shh' },
        { type: 'boolean', label: 'Flag', value: 'true' },
        { type: 'link', label: 'Linked', value: '2' },
        { type: 99, label: '', value: 'dropped-no-label' },
      ] as any,
    });

    await createCipher(authedFetch as any, unlockedSession(), draft);
    const body = JSON.parse(lastInit(authedFetch).body);

    expect(body.type).toBe(1);
    expect(body.favorite).toBe(true);
    expect(body.reprompt).toBe(1);
    expect(body.folderId).toBe('fold-1');
    expect(await decryptStr(body.name, USER_ENC, USER_MAC)).toBe('GitHub');
    expect(await decryptStr(body.notes, USER_ENC, USER_MAC)).toBe('note');
    expect(await decryptStr(body.login.username, USER_ENC, USER_MAC)).toBe('octocat');
    expect(await decryptStr(body.login.password, USER_ENC, USER_MAC)).toBe('hunter2');
    expect(await decryptStr(body.login.totp, USER_ENC, USER_MAC)).toBe('JBSWY3DPEHPK3PXP');
    // Password is brand new -> a passwordRevisionDate is stamped.
    expect(typeof body.login.passwordRevisionDate).toBe('string');

    // URIs: duplicate + blank dropped; checksum matches sha256 of the plaintext URI.
    expect(body.login.uris).toHaveLength(1);
    expect(await decryptStr(body.login.uris[0].uri, USER_ENC, USER_MAC)).toBe('https://github.com');
    expect(body.login.uris[0].match).toBe(0);
    expect(await decryptStr(body.login.uris[0].uriChecksum, USER_ENC, USER_MAC)).toBe(
      await sha256Base64('https://github.com')
    );

    // fido2: preserved cipher-string id, defaulted keyType, nullable emptied rpName, encrypted keyValue.
    expect(body.login.fido2Credentials).toHaveLength(1);
    const fido = body.login.fido2Credentials[0];
    expect(fido.credentialId).toBe(preEncryptedCredId);
    expect(await decryptStr(fido.keyType, USER_ENC, USER_MAC)).toBe('public-key');
    expect(await decryptStr(fido.keyAlgorithm, USER_ENC, USER_MAC)).toBe('ECDSA');
    expect(await decryptStr(fido.keyValue, USER_ENC, USER_MAC)).toBe('raw-key-value');
    expect(fido.rpName).toBeNull();
    expect(await decryptStr(fido.userName, USER_ENC, USER_MAC)).toBe('octocat');
    // Unparseable creationDate falls back to a valid ISO date string.
    expect(() => new Date(fido.creationDate).toISOString()).not.toThrow();
    expect(Number.isFinite(new Date(fido.creationDate).getTime())).toBe(true);

    // Custom fields: label-less entry dropped, types normalized to 1/2/3.
    expect(body.fields).toHaveLength(3);
    expect(body.fields.map((f: any) => f.type)).toEqual([1, 2, 3]);
    expect(await decryptStr(body.fields[0].name, USER_ENC, USER_MAC)).toBe('Hidden');
    expect(await decryptStr(body.fields[0].value, USER_ENC, USER_MAC)).toBe('shh');
  });

  it('builds password history and preserves the revision date when the password is unchanged', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    const priorHistoryPw = await encryptBw(new TextEncoder().encode('older'), USER_ENC, USER_MAC);
    const cipher = {
      id: 'c1',
      type: 1,
      login: {
        decPassword: 'current',
        passwordRevisionDate: '2019-01-01T00:00:00.000Z',
        fido2Credentials: [],
      },
      passwordHistory: [{ password: priorHistoryPw, lastUsedDate: '2018-01-01T00:00:00.000Z' }],
    } as unknown as Cipher;

    // Password unchanged -> existing revision date preserved, history unchanged (just re-encrypted).
    await updateCipher(
      authedFetch as any,
      unlockedSession(),
      cipher,
      baseDraft({ type: 1, name: 'Same', loginPassword: 'current' })
    );
    const unchanged = JSON.parse(lastInit(authedFetch).body);
    expect(unchanged.login.passwordRevisionDate).toBe('2019-01-01T00:00:00.000Z');
    expect(unchanged.passwordHistory).toHaveLength(1);
    expect(await decryptStr(unchanged.passwordHistory[0].password, USER_ENC, USER_MAC)).toBe('older');

    // Password changed -> the old password is pushed to the front of history and dated now.
    await updateCipher(
      authedFetch as any,
      unlockedSession(),
      cipher,
      baseDraft({ type: 1, name: 'Same', loginPassword: 'rotated' })
    );
    const changed = JSON.parse(lastInit(authedFetch).body);
    expect(typeof changed.login.passwordRevisionDate).toBe('string');
    expect(changed.login.passwordRevisionDate).not.toBe('2019-01-01T00:00:00.000Z');
    expect(changed.passwordHistory.length).toBeGreaterThanOrEqual(2);
    expect(await decryptStr(changed.passwordHistory[0].password, USER_ENC, USER_MAC)).toBe('current');
    expect(await decryptStr(changed.passwordHistory[1].password, USER_ENC, USER_MAC)).toBe('older');
  });
});

describe('api/vault buildCipherPayload for card (type 3) and identity (type 4)', () => {
  it('encrypts card fields (type 3)', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    await createCipher(
      authedFetch as any,
      unlockedSession(),
      baseDraft({
        type: 3,
        name: 'Card',
        cardholderName: 'Ada Lovelace',
        cardNumber: '4111111111111111',
        cardBrand: 'Visa',
        cardExpMonth: '04',
        cardExpYear: '2030',
        cardCode: '123',
      } as any)
    );
    const body = JSON.parse(lastInit(authedFetch).body);
    expect(body.type).toBe(3);
    expect(await decryptStr(body.card.cardholderName, USER_ENC, USER_MAC)).toBe('Ada Lovelace');
    expect(await decryptStr(body.card.number, USER_ENC, USER_MAC)).toBe('4111111111111111');
    expect(await decryptStr(body.card.code, USER_ENC, USER_MAC)).toBe('123');
    expect(body.login).toBeNull();
  });

  it('encrypts identity fields (type 4)', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    await createCipher(
      authedFetch as any,
      unlockedSession(),
      baseDraft({
        type: 4,
        name: 'Identity',
        identFirstName: 'Grace',
        identLastName: 'Hopper',
        identEmail: 'grace@example.com',
        identCountry: 'US',
      } as any)
    );
    const body = JSON.parse(lastInit(authedFetch).body);
    expect(body.type).toBe(4);
    expect(await decryptStr(body.identity.firstName, USER_ENC, USER_MAC)).toBe('Grace');
    expect(await decryptStr(body.identity.lastName, USER_ENC, USER_MAC)).toBe('Hopper');
    expect(await decryptStr(body.identity.email, USER_ENC, USER_MAC)).toBe('grace@example.com');
    // Unset identity fields drop to null.
    expect(body.identity.ssn).toBeNull();
  });
});

describe('api/vault createCipher / updateCipher / deleteCipher error paths', () => {
  it('createCipher rejects a locked vault', async () => {
    const locked = { ...unlockedSession(), symEncKey: undefined } as SessionState;
    await expect(createCipher(vi.fn() as any, locked, baseDraft({ type: 2, name: 'x' }))).rejects.toThrow(
      'Vault key unavailable'
    );
  });

  it('createCipher surfaces a non-ok response', async () => {
    await expect(
      createCipher(vi.fn(fail()) as any, unlockedSession(), baseDraft({ type: 2, name: 'x' }))
    ).rejects.toThrow('Create item failed');
  });

  it('updateCipher throws on a non-ok response', async () => {
    await expect(
      updateCipher(vi.fn(fail()) as any, unlockedSession(), { id: 'c1', type: 2 } as any, baseDraft({ type: 2, name: 'x' }))
    ).rejects.toThrow('Update item failed');
  });

  it('deleteCipher throws on a non-ok response', async () => {
    await expect(deleteCipher(vi.fn(fail()) as any, 'c1')).rejects.toThrow('Delete item failed');
  });
});

// Build a cipher whose per-item key is valid but a probe field was encrypted under
// the USER key (a repairable mismatch). The decrypted mirror is present so the item
// is considered fully resolved and eligible for repair.
async function mismatchedCipher(
  id: string,
  type: number,
  sub: string,
  fieldName: string,
  decFieldName: string,
  plain: string
): Promise<{ cipher: Cipher; itemEnc: Uint8Array; itemMac: Uint8Array }> {
  const itemKeyBytes = new Uint8Array(64);
  itemKeyBytes.fill(11, 0, 32);
  itemKeyBytes.fill(13, 32, 64);
  const itemEnc = itemKeyBytes.slice(0, 32);
  const itemMac = itemKeyBytes.slice(32, 64);
  const key = await encryptBw(itemKeyBytes, USER_ENC, USER_MAC);
  const encryptedUnderUserKey = await encryptBw(new TextEncoder().encode(plain), USER_ENC, USER_MAC);
  const cipher = {
    id,
    type,
    key,
    name: 'Item',
    [sub]: { [fieldName]: encryptedUnderUserKey, [decFieldName]: plain },
  } as unknown as Cipher;
  return { cipher, itemEnc, itemMac };
}

describe('api/vault repairCipherKeyMismatches over login/card/identity/ssh items', () => {
  it('rebuilds each typed item from its decrypted mirror and re-encrypts under the item key', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'x' }));

    const login = await mismatchedCipher('c1', 1, 'login', 'username', 'decUsername', 'octocat');
    const card = await mismatchedCipher('c3', 3, 'card', 'number', 'decNumber', '4111111111111111');
    const identity = await mismatchedCipher('c4', 4, 'identity', 'firstName', 'decFirstName', 'Grace');
    const ssh = await mismatchedCipher('c5', 5, 'sshKey', 'privateKey', 'decPrivateKey', 'PRIVATE-KEY');

    const repaired = await repairCipherKeyMismatches(authedFetch as any, unlockedSession(), [
      login.cipher,
      card.cipher,
      identity.cipher,
      ssh.cipher,
    ]);

    expect(repaired).toBe(4);
    expect(authedFetch).toHaveBeenCalledTimes(4);

    const bodyFor = (id: string) =>
      JSON.parse(authedFetch.mock.calls.find((c) => c[0] === `/api/ciphers/${id}`)![1].body);

    const loginBody = bodyFor('c1');
    expect(loginBody.type).toBe(1);
    expect(await decryptStr(loginBody.login.username, login.itemEnc, login.itemMac)).toBe('octocat');

    const cardBody = bodyFor('c3');
    expect(cardBody.type).toBe(3);
    expect(await decryptStr(cardBody.card.number, card.itemEnc, card.itemMac)).toBe('4111111111111111');

    const identBody = bodyFor('c4');
    expect(identBody.type).toBe(4);
    expect(await decryptStr(identBody.identity.firstName, identity.itemEnc, identity.itemMac)).toBe('Grace');

    const sshBody = bodyFor('c5');
    expect(sshBody.type).toBe(5);
    expect(await decryptStr(sshBody.sshKey.privateKey, ssh.itemEnc, ssh.itemMac)).toBe('PRIVATE-KEY');
    // The web-repair header is stamped and the revision date is preserved.
    expect(authedFetch.mock.calls[0][1].headers['X-NodeWarden-Web']).toBe('1');
    expect(bodyFor('c1').preserveRevisionDate).toBe(true);
  });

  it('returns 0 for a locked vault without issuing requests', async () => {
    const locked = { ...unlockedSession(), symMacKey: undefined } as SessionState;
    const authedFetch = vi.fn(() => jsonResponse({ id: 'x' }));
    const { cipher } = await mismatchedCipher('c1', 1, 'login', 'username', 'decUsername', 'u');
    expect(await repairCipherKeyMismatches(authedFetch as any, locked, [cipher])).toBe(0);
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it('skips ciphers without a per-item key', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'x' }));
    const cipher = { id: 'c1', type: 1, login: { username: 'plain' } } as unknown as Cipher;
    expect(await repairCipherKeyMismatches(authedFetch as any, unlockedSession(), [cipher])).toBe(0);
    expect(authedFetch).not.toHaveBeenCalled();
  });
});

describe('api/vault repairCipherUriChecksums', () => {
  it('returns 0 for a locked vault', async () => {
    const locked = { ...unlockedSession(), symEncKey: undefined } as SessionState;
    expect(await repairCipherUriChecksums(vi.fn() as any, locked, [{ id: 'c1' } as any])).toBe(0);
  });

  it('rewrites a login URI missing its checksum (user key) and reports the repaired count', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    const encryptedUri = await encryptBw(new TextEncoder().encode('https://example.com'), USER_ENC, USER_MAC);
    const cipher = {
      id: 'c1',
      type: 1,
      login: { uris: [{ uri: encryptedUri }] },
    } as unknown as Cipher;

    const repaired = await repairCipherUriChecksums(authedFetch as any, unlockedSession(), [cipher]);
    expect(repaired).toBe(1);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/ciphers/c1');
    expect(init.method).toBe('PUT');
    expect(init.headers['X-NodeWarden-Web']).toBe('1');
    const body = JSON.parse(init.body);
    expect(body.preserveRevisionDate).toBe(true);
    // The URI keeps its (still-valid) ciphertext, and a fresh checksum is written.
    expect(body.login.uris[0].uri).toBe(encryptedUri);
    expect(await decryptStr(body.login.uris[0].uriChecksum, USER_ENC, USER_MAC)).toBe(
      await sha256Base64('https://example.com')
    );
  });

  it('repairs URIs encrypted under a per-item key and forwards that key', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    const itemKeyBytes = new Uint8Array(64);
    itemKeyBytes.fill(3, 0, 32);
    itemKeyBytes.fill(5, 32, 64);
    const itemEnc = itemKeyBytes.slice(0, 32);
    const itemMac = itemKeyBytes.slice(32, 64);
    const key = await encryptBw(itemKeyBytes, USER_ENC, USER_MAC);
    const encryptedUri = await encryptBw(new TextEncoder().encode('https://item.example'), itemEnc, itemMac);
    const cipher = {
      id: 'c1',
      type: 1,
      key,
      login: { uris: [{ uri: encryptedUri }] },
    } as unknown as Cipher;

    const repaired = await repairCipherUriChecksums(authedFetch as any, unlockedSession(), [cipher]);
    expect(repaired).toBe(1);
    const body = JSON.parse(lastInit(authedFetch).body);
    expect(body.key).toBe(key);
    expect(await decryptStr(body.login.uris[0].uriChecksum, itemEnc, itemMac)).toBe(
      await sha256Base64('https://item.example')
    );
  });

  it('skips ciphers whose per-item key cannot be unwrapped', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    // A well-formed cipher string that does not decrypt under the user key.
    const bogusKey = await encryptBw(new TextEncoder().encode('x'), new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
    const cipher = {
      id: 'c1',
      type: 1,
      key: bogusKey,
      login: { uris: [{ uri: bogusKey }] },
    } as unknown as Cipher;
    expect(await repairCipherUriChecksums(authedFetch as any, unlockedSession(), [cipher])).toBe(0);
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it('is a no-op when there is nothing to repair', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    // Plain (non cipher-string) URI -> repairCipherLoginUris leaves it untouched.
    const cipher = { id: 'c1', type: 1, login: { uris: [{ uri: 'https://plain.example' }] } } as unknown as Cipher;
    expect(await repairCipherUriChecksums(authedFetch as any, unlockedSession(), [cipher])).toBe(0);
    expect(authedFetch).not.toHaveBeenCalled();
  });
});

describe('api/vault uploadCipherAttachment', () => {
  function makeFile(name: string, bytes: Uint8Array): File {
    return new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' });
  }

  it('rejects a locked vault, missing id and missing file', async () => {
    const locked = { ...unlockedSession(), symEncKey: undefined } as SessionState;
    await expect(
      uploadCipherAttachment(vi.fn() as any, locked, 'c1', makeFile('f.txt', new Uint8Array([1])))
    ).rejects.toThrow('Vault key unavailable');
    await expect(
      uploadCipherAttachment(vi.fn() as any, unlockedSession(), '  ', makeFile('f.txt', new Uint8Array([1])))
    ).rejects.toThrow('Cipher id is required');
    await expect(
      uploadCipherAttachment(vi.fn() as any, unlockedSession(), 'c1', null as any)
    ).rejects.toThrow('File is required');
  });

  it('rejects an empty attachment name', async () => {
    await expect(
      uploadCipherAttachment(vi.fn() as any, unlockedSession(), 'c1', makeFile('', new Uint8Array([1])))
    ).rejects.toThrow('Invalid attachment name');
  });

  it('posts encrypted metadata then PUTs the ciphertext to the direct-upload url', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined); // force the fetch fallback in uploadWithProgress
    const uploadFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
    vi.stubGlobal('fetch', uploadFetch);

    const authedFetch = vi.fn(() =>
      jsonResponse({ attachmentId: 'att-1', url: 'https://blob.example/upload', fileUploadType: 1 })
    );
    const onProgress = vi.fn();

    await uploadCipherAttachment(
      authedFetch as any,
      unlockedSession(),
      'c 1',
      makeFile('secret.txt', new TextEncoder().encode('hello world')),
      null,
      onProgress
    );

    // Metadata POST carries the encrypted file name + wrapped key + ciphertext size.
    const [metaUrl, metaInit] = authedFetch.mock.calls[0];
    expect(metaUrl).toBe('/api/ciphers/c%201/attachment/v2');
    expect(metaInit.method).toBe('POST');
    const metaBody = JSON.parse(metaInit.body);
    expect(await decryptStr(metaBody.fileName, USER_ENC, USER_MAC)).toBe('secret.txt');
    expect(metaBody.key).toMatch(/^2\./);
    expect(metaBody.fileSize).toBeGreaterThan(0);

    // Direct upload PUT went to the returned url with the auth bearer token.
    expect(uploadFetch).toHaveBeenCalledTimes(1);
    const [putUrl, putInit] = uploadFetch.mock.calls[0];
    expect(putUrl).toBe('https://blob.example/upload');
    expect(putInit.method).toBe('PUT');
    expect(new Headers(putInit.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('throws when the metadata response omits an id/url', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ fileUploadType: 1 }));
    await expect(
      uploadCipherAttachment(
        authedFetch as any,
        unlockedSession(),
        'c1',
        makeFile('f.txt', new Uint8Array([1]))
      )
    ).rejects.toThrow('Create attachment failed');
  });

  it('surfaces a metadata failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'meta boom' }, 400));
    await expect(
      uploadCipherAttachment(
        authedFetch as any,
        unlockedSession(),
        'c1',
        makeFile('f.txt', new Uint8Array([1]))
      )
    ).rejects.toThrow('meta boom');
  });

  it('rolls back the attachment when the direct upload fails', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined);
    const uploadFetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error_description: 'up boom' }), { status: 500 })));
    vi.stubGlobal('fetch', uploadFetch);

    const authedFetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return emptyOk();
      return jsonResponse({ attachmentId: 'att-1', url: 'https://blob.example/upload', fileUploadType: 1 });
    });

    await expect(
      uploadCipherAttachment(
        authedFetch as any,
        unlockedSession(),
        'c1',
        makeFile('f.txt', new TextEncoder().encode('data'))
      )
    ).rejects.toThrow('up boom');

    // The rollback DELETE was issued against the created attachment.
    const deleteCall = authedFetch.mock.calls.find((c) => c[1]?.method === 'DELETE');
    expect(deleteCall?.[0]).toBe('/api/ciphers/c1/attachment/att-1');
  });
});

describe('api/vault downloadCipherAttachmentDecrypted', () => {
  it('validates the vault key and ids', async () => {
    const locked = { ...unlockedSession(), symEncKey: undefined } as SessionState;
    await expect(
      downloadCipherAttachmentDecrypted(vi.fn() as any, locked, { id: 'c1' } as any, 'a1')
    ).rejects.toThrow('Vault key unavailable');
    await expect(
      downloadCipherAttachmentDecrypted(vi.fn() as any, unlockedSession(), { id: '' } as any, 'a1')
    ).rejects.toThrow('Attachment id is required');
  });

  it('decrypts with the wrapped attachment key and returns the plaintext + file name', async () => {
    const plaintext = new TextEncoder().encode('top secret bytes');
    const attRaw = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) attRaw[i] = (i * 7 + 3) & 0xff;
    const wrappedKey = await encryptBw(attRaw, USER_ENC, USER_MAC);
    const encryptedBytes = await encryptBwFileData(plaintext, attRaw.slice(0, 32), attRaw.slice(32, 64));
    const encFileName = await encryptBw(new TextEncoder().encode('report.pdf'), USER_ENC, USER_MAC);

    const authedFetch = vi.fn(() =>
      jsonResponse({ id: 'a1', url: 'https://blob.example/a1', fileName: encFileName, key: wrappedKey })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(encryptedBytes, { status: 200, headers: { 'Content-Length': String(encryptedBytes.byteLength) } })
        )
      )
    );
    const onProgress = vi.fn();

    const result = await downloadCipherAttachmentDecrypted(
      authedFetch as any,
      unlockedSession(),
      { id: 'c1' } as any,
      'a1',
      onProgress
    );

    expect(result.fileName).toBe('report.pdf');
    expect(Array.from(result.bytes)).toEqual(Array.from(plaintext));
    // The decrypt used the attachment-item key path -> no metadata repair PUT was needed.
    expect(authedFetch).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalled();
  });

  it('decrypts a legacy blob under the item key and repairs the stored metadata key to null', async () => {
    const plaintext = new TextEncoder().encode('legacy content');
    // No wrapped attachment key -> the legacy path encrypts directly under the user/item key.
    const encryptedBytes = await encryptBwFileData(plaintext, USER_ENC, USER_MAC);
    const encFileName = await encryptBw(new TextEncoder().encode('legacy.bin'), USER_ENC, USER_MAC);

    const authedFetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return emptyOk(); // metadata repair
      return jsonResponse({ id: 'a1', url: 'https://blob.example/a1', fileName: encFileName, key: '' });
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(encryptedBytes, { status: 200 }))));

    const result = await downloadCipherAttachmentDecrypted(
      authedFetch as any,
      unlockedSession(),
      { id: 'c1' } as any,
      'a1'
    );
    expect(Array.from(result.bytes)).toEqual(Array.from(plaintext));

    // A metadata repair PUT was issued setting the stored key to null.
    const putCall = authedFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(putCall?.[0]).toBe('/api/ciphers/c1/attachment/a1/metadata');
    expect(JSON.parse(putCall![1].body)).toEqual({ key: null });
  });

  it('throws when the blob download fails', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'a1', url: 'https://blob.example/a1', key: '' }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))));
    await expect(
      downloadCipherAttachmentDecrypted(authedFetch as any, unlockedSession(), { id: 'c1' } as any, 'a1')
    ).rejects.toThrow('Download attachment failed');
  });

  it('throws when no candidate key can decrypt the blob', async () => {
    const garbage = new Uint8Array(80).fill(42);
    const authedFetch = vi.fn(() => jsonResponse({ id: 'a1', url: 'https://blob.example/a1', key: '' }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(garbage, { status: 200 }))));
    await expect(
      downloadCipherAttachmentDecrypted(authedFetch as any, unlockedSession(), { id: 'c1' } as any, 'a1')
    ).rejects.toThrow('Attachment decryption failed');
  });

  it('uses the wrapped key under the user key when the item key differs, then rewrites metadata under the item key', async () => {
    // Cipher carries a per-item key, but the attachment key + file name were wrapped
    // under the legacy USER key -> the download must fall back and repair both.
    const plaintext = new TextEncoder().encode('cross-key attachment');
    const itemKeyBytes = new Uint8Array(64);
    itemKeyBytes.fill(21, 0, 32);
    itemKeyBytes.fill(23, 32, 64);
    const itemEnc = itemKeyBytes.slice(0, 32);
    const itemMac = itemKeyBytes.slice(32, 64);
    const cipherKey = await encryptBw(itemKeyBytes, USER_ENC, USER_MAC);

    const attRaw = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) attRaw[i] = (i * 5 + 1) & 0xff;
    const wrappedUnderUser = await encryptBw(attRaw, USER_ENC, USER_MAC);
    const encryptedBytes = await encryptBwFileData(plaintext, attRaw.slice(0, 32), attRaw.slice(32, 64));
    const fileNameUnderUser = await encryptBw(new TextEncoder().encode('crosskey.dat'), USER_ENC, USER_MAC);

    const authedFetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return emptyOk(); // metadata repair
      return jsonResponse({ id: 'a1', url: 'https://blob.example/a1', fileName: fileNameUnderUser, key: wrappedUnderUser });
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(encryptedBytes, { status: 200 }))));

    const result = await downloadCipherAttachmentDecrypted(
      authedFetch as any,
      unlockedSession(),
      { id: 'c1', key: cipherKey } as any,
      'a1'
    );
    expect(result.fileName).toBe('crosskey.dat');
    expect(Array.from(result.bytes)).toEqual(Array.from(plaintext));

    const putCall = authedFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(putCall?.[0]).toBe('/api/ciphers/c1/attachment/a1/metadata');
    const repaired = JSON.parse(putCall![1].body);
    // Both the file name and the attachment key are re-wrapped under the ITEM key.
    expect(await decryptStr(repaired.fileName, itemEnc, itemMac)).toBe('crosskey.dat');
    const rewrappedKey = base64ToBytes(repaired.key.split('.')[1].split('|')[0]); // sanity: it's a cipher string
    expect(rewrappedKey.byteLength).toBeGreaterThan(0);
  });

  it('re-encrypts a legacy user-key blob under the item key and uploads the repaired ciphertext', async () => {
    // No wrapped attachment key + item key differs from user key: the blob was
    // encrypted under the user key (legacy-user), so the client re-encrypts under
    // the item key, uploads it, and clears the stored metadata key.
    const plaintext = new TextEncoder().encode('legacy user blob');
    const itemKeyBytes = new Uint8Array(64);
    itemKeyBytes.fill(31, 0, 32);
    itemKeyBytes.fill(37, 32, 64);
    const cipherKey = await encryptBw(itemKeyBytes, USER_ENC, USER_MAC);
    const encryptedBytes = await encryptBwFileData(plaintext, USER_ENC, USER_MAC);

    vi.stubGlobal('XMLHttpRequest', undefined); // uploadRepairedAttachmentBlob -> fetch fallback
    const globalFetch = vi.fn((input: any) => {
      const url = String(input);
      // Exact-origin match (not a substring check) so the download mock only
      // fires for the attachment host and CodeQL doesn't flag it. A base handles
      // any relative same-origin PUT url without throwing.
      if (new URL(url, 'http://same-origin.local').origin === 'https://blob.example') {
        return Promise.resolve(new Response(encryptedBytes, { status: 200 }));
      }
      // the repaired ciphertext PUT to the same-origin attachment endpoint
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal('fetch', globalFetch);

    const authedFetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return emptyOk(); // metadata repair
      return jsonResponse({ id: 'a1', url: 'https://blob.example/a1', fileName: 'plain-name.bin', key: '' });
    });

    const result = await downloadCipherAttachmentDecrypted(
      authedFetch as any,
      unlockedSession(),
      { id: 'c1', key: cipherKey } as any,
      'a1'
    );
    expect(Array.from(result.bytes)).toEqual(Array.from(plaintext));
    // Plain (non cipher-string) file name is passed through unchanged.
    expect(result.fileName).toBe('plain-name.bin');

    // The repaired ciphertext was uploaded to the same-origin attachment blob endpoint.
    const repairUpload = globalFetch.mock.calls.find((c) => String(c[0]).includes('/api/ciphers/c1/attachment/a1'));
    expect(repairUpload).toBeTruthy();
    // Metadata was reset with key:null.
    const putCall = authedFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(JSON.parse(putCall![1].body)).toEqual({ key: null });
  });
});

describe('api/vault draftFromDecryptedCipher via a rich login repair', () => {
  it('rebuilds a login with custom fields and deduped URIs from decrypted mirrors', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    const itemKeyBytes = new Uint8Array(64);
    itemKeyBytes.fill(41, 0, 32);
    itemKeyBytes.fill(43, 32, 64);
    const itemEnc = itemKeyBytes.slice(0, 32);
    const itemMac = itemKeyBytes.slice(32, 64);
    const key = await encryptBw(itemKeyBytes, USER_ENC, USER_MAC);
    const encUser = (s: string) => encryptBw(new TextEncoder().encode(s), USER_ENC, USER_MAC);

    // Everything is encrypted under the USER key (the mismatch) but carries a plain
    // decrypted mirror, so the item is resolved and eligible for repair.
    const cipher = {
      id: 'c1',
      type: 1,
      key,
      name: 'Item',
      login: {
        username: await encUser('octocat'),
        decUsername: 'octocat',
        password: await encUser('hunter2'),
        decPassword: 'hunter2',
        uris: [
          { uri: await encUser('https://a.com'), decUri: 'https://a.com' },
          { uri: await encUser('https://a.com'), decUri: 'https://a.com' }, // duplicate mirror -> deduped
        ],
        fido2Credentials: [],
      },
      fields: [
        { type: 2, name: await encUser('Flag'), decName: 'Flag', value: await encUser('true'), decValue: 'true' },
        { type: 3, name: await encUser('Link'), decName: 'Link', value: await encUser('99'), decValue: '99' },
      ],
    } as unknown as Cipher;

    const repaired = await repairCipherKeyMismatches(authedFetch as any, unlockedSession(), [cipher]);
    expect(repaired).toBe(1);
    const body = JSON.parse(lastInit(authedFetch).body);
    // Rebuilt under the item key from the decrypted mirrors.
    expect(await decryptStr(body.login.username, itemEnc, itemMac)).toBe('octocat');
    expect(body.login.uris).toHaveLength(1);
    expect(await decryptStr(body.login.uris[0].uri, itemEnc, itemMac)).toBe('https://a.com');
    expect(body.fields).toHaveLength(2);
    expect(body.fields.map((f: any) => f.type)).toEqual([2, 3]);
    expect(await decryptStr(body.fields[0].name, itemEnc, itemMac)).toBe('Flag');
  });
});

describe('api/vault folder + cipher fetch error branches', () => {
  it('getFolderById surfaces a non-404 server error', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'load boom' }, 500));
    await expect(getFolderById(authedFetch as any, 'f1')).rejects.toThrow('load boom');
  });

  it('updateFolder throws on a non-ok response', async () => {
    await expect(updateFolder(vi.fn(fail()) as any, unlockedSession(), 'f1', 'n')).rejects.toThrow('Update folder failed');
  });

  it('updateFolder throws when the response omits an id', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    await expect(updateFolder(authedFetch as any, unlockedSession(), 'f1', 'n')).rejects.toThrow('Update folder failed');
  });

  it('getCipherById surfaces a non-404 server error', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'cipher boom' }, 500));
    await expect(getCipherById(authedFetch as any, 'c1')).rejects.toThrow('cipher boom');
  });

  it('getCipherById throws when the body has no id', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    await expect(getCipherById(authedFetch as any, 'c1')).rejects.toThrow('Load cipher failed');
  });
});

describe('api/vault single-cipher lifecycle error branches', () => {
  it('permanentDeleteCipher throws on a non-ok response', async () => {
    await expect(permanentDeleteCipher(vi.fn(fail()) as any, 'c1')).rejects.toThrow('Permanent delete item failed');
  });

  it('archiveCipher requires an id', async () => {
    await expect(archiveCipher(vi.fn() as any, '  ')).rejects.toThrow('Cipher id is required');
  });

  it('unarchiveCipher requires an id and throws on failure', async () => {
    await expect(unarchiveCipher(vi.fn() as any, '')).rejects.toThrow('Cipher id is required');
    await expect(unarchiveCipher(vi.fn(fail()) as any, 'c1')).rejects.toThrow('Unarchive item failed');
  });

  it('deleteCipherAttachment throws the parsed error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'del boom' }, 400));
    await expect(deleteCipherAttachment(authedFetch as any, 'c1', 'a1')).rejects.toThrow('del boom');
  });
});

describe('api/vault bulk operation error branches', () => {
  it('bulkArchiveCiphers throws when a chunk fails', async () => {
    await expect(bulkArchiveCiphers(vi.fn(fail()) as any, ['a'])).rejects.toThrow('Bulk archive failed');
  });

  it('bulkPermanentDeleteCiphers throws when a chunk fails', async () => {
    await expect(bulkPermanentDeleteCiphers(vi.fn(fail()) as any, ['a'])).rejects.toThrow('Bulk permanent delete failed');
  });

  it('bulkRestoreCiphers throws when a chunk fails', async () => {
    await expect(bulkRestoreCiphers(vi.fn(fail()) as any, ['a'])).rejects.toThrow('Bulk restore failed');
  });

  it('bulkUnarchiveCiphers throws when a chunk fails', async () => {
    await expect(bulkUnarchiveCiphers(vi.fn(fail()) as any, ['a'])).rejects.toThrow('Bulk unarchive failed');
  });

  it('bulkMoveCiphers throws when a chunk fails', async () => {
    await expect(bulkMoveCiphers(vi.fn(fail()) as any, ['a'], null)).rejects.toThrow('Bulk move failed');
  });
});

describe('api/vault repairCipherUriChecksums additional branches', () => {
  it('leaves a login URI with an already-valid checksum untouched', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    const encUri = await encryptBw(new TextEncoder().encode('https://valid.example'), USER_ENC, USER_MAC);
    const validChecksum = await encryptBw(
      new TextEncoder().encode(await sha256Base64('https://valid.example')),
      USER_ENC,
      USER_MAC
    );
    const cipher = {
      id: 'c1',
      type: 1,
      login: { uris: [{ uri: encUri, uriChecksum: validChecksum }] },
    } as unknown as Cipher;
    expect(await repairCipherUriChecksums(authedFetch as any, unlockedSession(), [cipher])).toBe(0);
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it('repairs via the decUri fallback when the ciphertext will not decrypt', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    // uri encrypted under a foreign key -> decrypt fails, so the plain decUri mirror is used.
    const foreignUri = await encryptBw(
      new TextEncoder().encode('https://fallback.example'),
      new Uint8Array(32).fill(1),
      new Uint8Array(32).fill(2)
    );
    const cipher = {
      id: 'c1',
      type: 1,
      login: { uris: [{ uri: foreignUri, decUri: 'https://fallback.example' }] },
    } as unknown as Cipher;
    expect(await repairCipherUriChecksums(authedFetch as any, unlockedSession(), [cipher])).toBe(1);
    const body = JSON.parse(lastInit(authedFetch).body);
    expect(await decryptStr(body.login.uris[0].uri, USER_ENC, USER_MAC)).toBe('https://fallback.example');
    expect(await decryptStr(body.login.uris[0].uriChecksum, USER_ENC, USER_MAC)).toBe(
      await sha256Base64('https://fallback.example')
    );
  });

  it('skips a cipher whose per-item key is shorter than 64 bytes', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    const shortKey = await encryptBw(new Uint8Array(10).fill(4), USER_ENC, USER_MAC);
    const encUri = await encryptBw(new TextEncoder().encode('https://x.example'), USER_ENC, USER_MAC);
    const cipher = {
      id: 'c1',
      type: 1,
      key: shortKey,
      login: { uris: [{ uri: encUri }] },
    } as unknown as Cipher;
    expect(await repairCipherUriChecksums(authedFetch as any, unlockedSession(), [cipher])).toBe(0);
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it('throws the parsed error when the repair PUT fails', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'repair boom' }, 500));
    const encUri = await encryptBw(new TextEncoder().encode('https://err.example'), USER_ENC, USER_MAC);
    const cipher = { id: 'c1', type: 1, login: { uris: [{ uri: encUri }] } } as unknown as Cipher;
    await expect(repairCipherUriChecksums(authedFetch as any, unlockedSession(), [cipher])).rejects.toThrow('repair boom');
  });
});

describe('api/vault uploadCipherAttachment authorization', () => {
  it('throws Unauthorized when the session has no access token', async () => {
    const noToken = { ...unlockedSession(), accessToken: undefined } as SessionState;
    const authedFetch = vi.fn(() =>
      jsonResponse({ attachmentId: 'att-1', url: 'https://blob.example/upload', fileUploadType: 1 })
    );
    await expect(
      uploadCipherAttachment(
        authedFetch as any,
        noToken,
        'c1',
        new File([new Uint8Array([1, 2, 3])], 'f.txt', { type: 'application/octet-stream' })
      )
    ).rejects.toThrow('Unauthorized');
  });
});
