import { describe, expect, it } from 'vitest';
import { decryptVaultCore, decryptSends } from '@/lib/vault-decrypt';
import { encryptBw } from '@/lib/crypto';
import type { Cipher, Folder, Send } from '@/lib/types';

const textEncoder = new TextEncoder();

const userEnc = textEncoder.encode('0123456789abcdef0123456789abcdef'); // 32 bytes
const userMac = textEncoder.encode('fedcba9876543210fedcba9876543210'); // 32 bytes

// Base64 of the raw key bytes, as decryptVaultCore expects b64 strings.
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

async function makeItemKey() {
  const itemEnc = crypto.getRandomValues(new Uint8Array(32));
  const itemMac = crypto.getRandomValues(new Uint8Array(32));
  const combined = new Uint8Array(64);
  combined.set(itemEnc, 0);
  combined.set(itemMac, 32);
  const wrappedKey = await encryptBw(combined, userEnc, userMac);
  return { itemEnc, itemMac, wrappedKey };
}

describe('decryptVaultCore - folders', () => {
  it('decrypts folder names with the user key', async () => {
    const folders: Folder[] = [
      { id: 'f1', name: await enc('Work') },
      { id: 'f2', name: await enc('Personal') },
    ];
    const result = await decryptVaultCore({ folders, ciphers: [], symEncKeyB64, symMacKeyB64 });
    expect(result.folders.map((f) => f.decName)).toEqual(['Work', 'Personal']);
    // Original encrypted name preserved.
    expect(result.folders[0].name).toBe(folders[0].name);
  });
});

describe('decryptVaultCore - ciphers (user key)', () => {
  it('decrypts name, notes, login, uris, card, identity, fields, password history', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      name: await enc('My Login'),
      notes: await enc('a note'),
      login: {
        username: await enc('alice'),
        password: await enc('hunter2'),
        totp: await enc('JBSWY3DPEHPK3PXP'),
        uris: [{ uri: await enc('https://example.com') }],
      },
      card: {
        cardholderName: await enc('Alice A'),
        number: await enc('4111111111111111'),
        brand: await enc('Visa'),
        expMonth: await enc('12'),
        expYear: await enc('2030'),
        code: await enc('123'),
      },
      identity: {
        firstName: await enc('Alice'),
        lastName: await enc('Anderson'),
        email: await enc('alice@example.com'),
      },
      fields: [{ type: 0, name: await enc('Label'), value: await enc('Value') }],
      passwordHistory: [{ password: await enc('old1'), lastUsedDate: '2024-01-01' }],
    };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    const c = result.ciphers[0];
    expect(c.decName).toBe('My Login');
    expect(c.decNotes).toBe('a note');
    expect(c.login?.decUsername).toBe('alice');
    expect(c.login?.decPassword).toBe('hunter2');
    expect(c.login?.decTotp).toBe('JBSWY3DPEHPK3PXP');
    expect(c.login?.uris?.[0].decUri).toBe('https://example.com');
    expect(c.card?.decNumber).toBe('4111111111111111');
    expect(c.card?.decBrand).toBe('Visa');
    expect(c.identity?.decFirstName).toBe('Alice');
    expect(c.identity?.decEmail).toBe('alice@example.com');
    expect(c.identity?.decMiddleName).toBe(''); // unset -> ''
    expect(c.fields?.[0].decName).toBe('Label');
    expect(c.fields?.[0].decValue).toBe('Value');
    expect(c.passwordHistory?.[0].decPassword).toBe('old1');
  });

  it('decrypts ssh key fields and normalizes the fingerprint', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 5,
      sshKey: {
        privateKey: await enc('PRIV'),
        publicKey: await enc('PUB'),
        keyFingerprint: 'SHA256:abc',
      },
    };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    const ssh = result.ciphers[0].sshKey!;
    expect(ssh.decPrivateKey).toBe('PRIV');
    expect(ssh.decPublicKey).toBe('PUB');
    expect(ssh.keyFingerprint).toBe('SHA256:abc');
    expect(ssh.fingerprint).toBe('SHA256:abc');
  });

  it('decrypts attachment file names', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      attachments: [{ id: 'a1', fileName: await enc('secret.pdf') } as any],
    };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    expect((result.ciphers[0].attachments?.[0] as any).decFileName).toBe('secret.pdf');
  });

  it('returns empty strings for missing fields', async () => {
    const cipher: Cipher = { id: '1', type: 1 };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    expect(result.ciphers[0].decName).toBe('');
    expect(result.ciphers[0].decNotes).toBe('');
  });

  it('preserves plaintext (non-cipher-string) values verbatim', async () => {
    const cipher: Cipher = { id: '1', type: 1, name: 'plain name' };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    expect(result.ciphers[0].decName).toBe('plain name');
  });

  it('returns empty string for an unreadable cipher-string with no item-key fallback', async () => {
    const wrongEnc = textEncoder.encode('ffffffffffffffffffffffffffffffff');
    const wrongMac = textEncoder.encode('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    const cipher: Cipher = { id: '1', type: 1, name: await enc('secret', wrongEnc, wrongMac) };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    expect(result.ciphers[0].decName).toBe('');
  });
});

describe('decryptVaultCore - ciphers (item key)', () => {
  it('uses a wrapped item key to decrypt fields', async () => {
    const { itemEnc, itemMac, wrappedKey } = await makeItemKey();
    const cipher: Cipher = {
      id: '1',
      type: 1,
      key: wrappedKey,
      name: await encryptBw(textEncoder.encode('ItemKeyed'), itemEnc, itemMac),
    };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    expect(result.ciphers[0].decName).toBe('ItemKeyed');
  });

  it('falls back to the user key for a mixed field', async () => {
    const { itemEnc, itemMac, wrappedKey } = await makeItemKey();
    const cipher: Cipher = {
      id: '1',
      type: 1,
      key: wrappedKey,
      name: await encryptBw(textEncoder.encode('viaItem'), itemEnc, itemMac),
      notes: await encryptBw(textEncoder.encode('viaUser'), userEnc, userMac),
    };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    expect(result.ciphers[0].decName).toBe('viaItem');
    expect(result.ciphers[0].decNotes).toBe('viaUser');
  });

  it('keeps the user key when the wrapped item key is too short', async () => {
    const shortKey = await encryptBw(crypto.getRandomValues(new Uint8Array(32)), userEnc, userMac);
    const cipher: Cipher = {
      id: '1',
      type: 1,
      key: shortKey,
      name: await encryptBw(textEncoder.encode('userKeyed'), userEnc, userMac),
    };
    const result = await decryptVaultCore({ folders: [], ciphers: [cipher], symEncKeyB64, symMacKeyB64 });
    expect(result.ciphers[0].decName).toBe('userKeyed');
  });
});

describe('decryptSends', () => {
  const origin = 'https://vault.example';

  async function makeSend(overrides: Partial<Send> = {}): Promise<{ send: Send; sendEnc: Uint8Array; sendMac: Uint8Array }> {
    // A >=64-byte send key is used directly as enc||mac (deriveSendKeyParts).
    const sendEnc = crypto.getRandomValues(new Uint8Array(32));
    const sendMac = crypto.getRandomValues(new Uint8Array(32));
    const combined = new Uint8Array(64);
    combined.set(sendEnc, 0);
    combined.set(sendMac, 32);
    const wrappedKey = await encryptBw(combined, userEnc, userMac);
    const send: Send = {
      id: 's1',
      accessId: 'access-1',
      type: 0,
      key: wrappedKey,
      name: await encryptBw(textEncoder.encode('My Send'), sendEnc, sendMac),
      notes: await encryptBw(textEncoder.encode('send note'), sendEnc, sendMac),
      text: { text: await encryptBw(textEncoder.encode('secret text'), sendEnc, sendMac) },
      ...overrides,
    };
    return { send, sendEnc, sendMac };
  }

  it('decrypts send name, notes, text and builds a share url', async () => {
    const { send } = await makeSend();
    const [result] = await decryptSends({ sends: [send], symEncKeyB64, symMacKeyB64, origin });
    expect(result.decName).toBe('My Send');
    expect(result.decNotes).toBe('send note');
    expect(result.decText).toBe('secret text');
    expect(result.decShareKey).toBeTruthy();
    expect(result.shareUrl).toBe(`${origin}/#/send/access-1/${result.decShareKey}`);
  });

  it('decrypts a file send name and keeps original on failure', async () => {
    const { send, sendEnc, sendMac } = await makeSend();
    send.file = { fileName: await encryptBw(textEncoder.encode('report.pdf'), sendEnc, sendMac) } as any;
    const [result] = await decryptSends({ sends: [send], symEncKeyB64, symMacKeyB64, origin });
    expect(result.file?.fileName).toBe('report.pdf');
  });

  it('emits empty decrypted fields when the send has no key', async () => {
    const send: Send = { id: 's2', accessId: 'a2', type: 0, name: 'whatever' };
    const [result] = await decryptSends({ sends: [send], symEncKeyB64, symMacKeyB64, origin });
    expect(result.decName).toBe('');
    expect(result.decNotes).toBe('');
    expect(result.decText).toBe('');
    expect(result.shareUrl).toBeUndefined();
  });

  it('marks "Decrypt failed" when the wrapped key cannot be unwrapped', async () => {
    const badKey = await encryptBw(
      crypto.getRandomValues(new Uint8Array(64)),
      userEnc,
      textEncoder.encode('00000000000000000000000000000000')
    );
    const send: Send = { id: 's3', accessId: 'a3', type: 0, key: badKey, name: 'x' };
    const [result] = await decryptSends({ sends: [send], symEncKeyB64, symMacKeyB64, origin });
    expect(result.decName).toBe('Decrypt failed');
  });
});
