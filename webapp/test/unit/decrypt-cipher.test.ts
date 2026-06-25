import { describe, expect, it } from 'vitest';
import { decryptSingleCipher } from '@/lib/decrypt-cipher';
import { encryptBw } from '@/lib/crypto';
import type { Cipher } from '@/lib/types';

const textEncoder = new TextEncoder();

const userEnc = textEncoder.encode('0123456789abcdef0123456789abcdef'); // 32 bytes
const userMac = textEncoder.encode('fedcba9876543210fedcba9876543210'); // 32 bytes

function enc(value: string): Promise<string> {
  return encryptBw(textEncoder.encode(value), userEnc, userMac);
}

describe('decryptSingleCipher - user-key path', () => {
  it('decrypts name and notes', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      name: await enc('My Login'),
      notes: await enc('some notes'),
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.decName).toBe('My Login');
    expect(result.decNotes).toBe('some notes');
    // Original encrypted cipher is preserved (spread).
    expect(result.name).toBe(cipher.name);
  });

  it('returns empty strings for missing name/notes', async () => {
    const cipher: Cipher = { id: '1', type: 1 };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.decName).toBe('');
    expect(result.decNotes).toBe('');
  });

  it('decrypts login fields including uris', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      name: await enc('Site'),
      login: {
        username: await enc('alice'),
        password: await enc('hunter2'),
        totp: await enc('JBSWY3DPEHPK3PXP'),
        uris: [
          { uri: await enc('https://example.com') },
          { uri: await enc('https://second.example') },
        ],
      },
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.login?.decUsername).toBe('alice');
    expect(result.login?.decPassword).toBe('hunter2');
    expect(result.login?.decTotp).toBe('JBSWY3DPEHPK3PXP');
    expect(result.login?.uris?.map((u) => u.decUri)).toEqual([
      'https://example.com',
      'https://second.example',
    ]);
  });

  it('handles a login with no uris array', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      login: { username: await enc('bob') },
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.login?.decUsername).toBe('bob');
    expect(result.login?.decPassword).toBe('');
    expect(result.login?.uris).toEqual([]);
  });

  it('decrypts password history entries', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      passwordHistory: [
        { password: await enc('old1'), lastUsedDate: '2024-01-01' },
        { password: await enc('old2'), lastUsedDate: '2024-02-01' },
      ],
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.passwordHistory?.map((p) => p.decPassword)).toEqual(['old1', 'old2']);
    expect(result.passwordHistory?.[0].lastUsedDate).toBe('2024-01-01');
  });

  it('tolerates a null entry in password history', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      passwordHistory: [null as unknown as { password: string }],
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.passwordHistory?.[0].decPassword).toBe('');
  });

  it('decrypts card fields', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 3,
      card: {
        cardholderName: await enc('Alice A'),
        number: await enc('4111111111111111'),
        brand: await enc('Visa'),
        expMonth: await enc('12'),
        expYear: await enc('2030'),
        code: await enc('123'),
      },
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.card?.decCardholderName).toBe('Alice A');
    expect(result.card?.decNumber).toBe('4111111111111111');
    expect(result.card?.decBrand).toBe('Visa');
    expect(result.card?.decExpMonth).toBe('12');
    expect(result.card?.decExpYear).toBe('2030');
    expect(result.card?.decCode).toBe('123');
  });

  it('decrypts identity fields', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 4,
      identity: {
        title: await enc('Ms'),
        firstName: await enc('Alice'),
        lastName: await enc('Anderson'),
        email: await enc('alice@example.com'),
        ssn: await enc('123-45-6789'),
        country: await enc('US'),
      },
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.identity?.decTitle).toBe('Ms');
    expect(result.identity?.decFirstName).toBe('Alice');
    expect(result.identity?.decLastName).toBe('Anderson');
    expect(result.identity?.decEmail).toBe('alice@example.com');
    expect(result.identity?.decSsn).toBe('123-45-6789');
    expect(result.identity?.decCountry).toBe('US');
    // Unset identity fields decrypt to ''.
    expect(result.identity?.decMiddleName).toBe('');
  });

  it('decrypts ssh key fields and resolves fingerprint preference', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 5,
      sshKey: {
        privateKey: await enc('PRIVKEY'),
        publicKey: await enc('PUBKEY'),
        keyFingerprint: 'SHA256:abc',
      },
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.sshKey?.decPrivateKey).toBe('PRIVKEY');
    expect(result.sshKey?.decPublicKey).toBe('PUBKEY');
    expect(result.sshKey?.keyFingerprint).toBe('SHA256:abc');
    expect(result.sshKey?.fingerprint).toBe('SHA256:abc');
  });

  it('falls back to fingerprint field when keyFingerprint is absent', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 5,
      sshKey: { fingerprint: 'SHA256:def' },
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.sshKey?.keyFingerprint).toBe('SHA256:def');
    expect(result.sshKey?.fingerprint).toBe('SHA256:def');
  });

  it('normalizes empty ssh fingerprint to null', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 5,
      sshKey: {},
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.sshKey?.keyFingerprint).toBeNull();
    expect(result.sshKey?.fingerprint).toBeNull();
    expect(result.sshKey?.decFingerprint).toBe('');
  });

  it('decrypts custom fields', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      fields: [
        { type: 0, name: await enc('Label A'), value: await enc('Value A') },
        { type: 1, name: await enc('Hidden'), value: await enc('secret') },
      ],
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.fields?.map((f) => [f.decName, f.decValue])).toEqual([
      ['Label A', 'Value A'],
      ['Hidden', 'secret'],
    ]);
  });
});

describe('decryptSingleCipher - item-key path', () => {
  async function makeItemKey() {
    const itemEnc = crypto.getRandomValues(new Uint8Array(32));
    const itemMac = crypto.getRandomValues(new Uint8Array(32));
    const combined = new Uint8Array(64);
    combined.set(itemEnc, 0);
    combined.set(itemMac, 32);
    const wrappedKey = await encryptBw(combined, userEnc, userMac);
    return { itemEnc, itemMac, wrappedKey };
  }

  it('uses the decrypted item key to decrypt fields', async () => {
    const { itemEnc, itemMac, wrappedKey } = await makeItemKey();
    const cipher: Cipher = {
      id: '1',
      type: 1,
      key: wrappedKey,
      name: await encryptBw(textEncoder.encode('ItemKeyed'), itemEnc, itemMac),
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.decName).toBe('ItemKeyed');
  });

  it('falls back to user key for a field encrypted with the user key (mixed)', async () => {
    const { itemEnc, itemMac, wrappedKey } = await makeItemKey();
    const cipher: Cipher = {
      id: '1',
      type: 1,
      key: wrappedKey,
      // name with item key, notes with user key -> notes only readable via fallback
      name: await encryptBw(textEncoder.encode('viaItem'), itemEnc, itemMac),
      notes: await encryptBw(textEncoder.encode('viaUser'), userEnc, userMac),
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.decName).toBe('viaItem');
    expect(result.decNotes).toBe('viaUser');
  });

  it('keeps user key when the wrapped item key is too short', async () => {
    const shortKey = await encryptBw(crypto.getRandomValues(new Uint8Array(32)), userEnc, userMac);
    const cipher: Cipher = {
      id: '1',
      type: 1,
      key: shortKey,
      name: await encryptBw(textEncoder.encode('userKeyed'), userEnc, userMac),
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.decName).toBe('userKeyed');
  });

  it('keeps user key when the wrapped item key cannot be decrypted', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      key: await encryptBw(crypto.getRandomValues(new Uint8Array(64)), userEnc, textEncoder.encode('00000000000000000000000000000000')),
      name: await encryptBw(textEncoder.encode('userKeyed'), userEnc, userMac),
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.decName).toBe('userKeyed');
  });
});

describe('decryptSingleCipher - undecryptable fields', () => {
  it('returns empty string for an unreadable cipher-string field (no fallback)', async () => {
    // Encrypted with a different key; not an item-keyed cipher so no fallback.
    const wrongEnc = textEncoder.encode('ffffffffffffffffffffffffffffffff');
    const wrongMac = textEncoder.encode('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    const cipher: Cipher = {
      id: '1',
      type: 1,
      name: await encryptBw(textEncoder.encode('secret'), wrongEnc, wrongMac),
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.decName).toBe('');
  });

  it('preserves a plaintext (non-cipher-string) value verbatim', async () => {
    const cipher: Cipher = {
      id: '1',
      type: 1,
      name: 'just plain text',
    };
    const result = await decryptSingleCipher(cipher, userEnc, userMac);
    expect(result.decName).toBe('just plain text');
  });
});
