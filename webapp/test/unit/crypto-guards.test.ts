import { describe, expect, it } from 'vitest';
import {
  WEB_CRYPTO_UNAVAILABLE_MESSAGE,
  WebCryptoUnavailableError,
  base64ToBytes,
  bytesToBase64,
  decryptBw,
  decryptBwFileData,
  decryptStr,
  encryptBw,
  encryptBwFileData,
  hkdfExpand,
  requireWebCrypto,
} from '@/lib/crypto';

// These tests target the security GUARDS in crypto.ts — the branches Stryker
// found surviving (weak or absent assertions) even where line coverage exists:
// the Web Crypto availability gate, the constant-time MAC comparison (length +
// full-loop), the cipher-string type dispatch, the HKDF multi-block copy, and
// the file-data length boundary. Each assertion pins a specific mutant.

const textEncoder = new TextEncoder();
const ENC_KEY = textEncoder.encode('0123456789abcdef0123456789abcdef'); // 32 bytes
const MAC_KEY = textEncoder.encode('fedcba9876543210fedcba9876543210'); // 32 bytes

describe('requireWebCrypto — availability gate', () => {
  const realCrypto = globalThis.crypto;

  it('returns the crypto object when the environment is complete and secure', () => {
    expect(requireWebCrypto({ crypto: realCrypto, isSecureContext: true })).toBe(realCrypto);
    // Default-arg path (globalThis) also resolves in the jsdom test environment.
    expect(typeof requireWebCrypto().subtle.importKey).toBe('function');
  });

  it('throws when the context is explicitly insecure', () => {
    expect(() => requireWebCrypto({ crypto: realCrypto, isSecureContext: false })).toThrow(
      WebCryptoUnavailableError
    );
  });

  it('throws when the crypto object is missing', () => {
    expect(() => requireWebCrypto({ crypto: undefined, isSecureContext: true })).toThrow(
      WebCryptoUnavailableError
    );
  });

  it('throws when getRandomValues is not a function', () => {
    const broken = { subtle: realCrypto.subtle, getRandomValues: undefined } as unknown as Crypto;
    expect(() => requireWebCrypto({ crypto: broken, isSecureContext: true })).toThrow(
      WebCryptoUnavailableError
    );
  });

  it('throws when subtle is missing', () => {
    const broken = { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) } as unknown as Crypto;
    expect(() => requireWebCrypto({ crypto: broken, isSecureContext: true })).toThrow(
      WebCryptoUnavailableError
    );
  });

  it('throws when subtle.importKey is not a function', () => {
    const broken = {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
      subtle: {} as SubtleCrypto,
    } as unknown as Crypto;
    expect(() => requireWebCrypto({ crypto: broken, isSecureContext: true })).toThrow(
      WebCryptoUnavailableError
    );
  });

  it('exposes a stable message and name on the error', () => {
    const err = new WebCryptoUnavailableError();
    expect(err.message).toBe(WEB_CRYPTO_UNAVAILABLE_MESSAGE);
    expect(err.name).toBe('WebCryptoUnavailableError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('constant-time MAC comparison', () => {
  it('rejects a MAC of the wrong length (length guard)', async () => {
    const cipher = await encryptBw(textEncoder.encode('data'), ENC_KEY, MAC_KEY);
    const [head, ct] = cipher.split('|');
    // Replace the MAC with a shorter byte string so a.length !== b.length.
    const shortMac = bytesToBase64(new Uint8Array(16));
    await expect(decryptBw(`${head}|${ct}|${shortMac}`, ENC_KEY, MAC_KEY)).rejects.toThrow(
      /MAC mismatch/
    );
  });

  it('rejects a MAC that differs only in the final byte (full-loop compare)', async () => {
    const cipher = await encryptBw(textEncoder.encode('data'), ENC_KEY, MAC_KEY);
    const type = cipher.slice(0, cipher.indexOf('.'));
    const [iv, ct, mac] = cipher.slice(type.length + 1).split('|');
    const macBytes = base64ToBytes(mac);
    macBytes[macBytes.length - 1] ^= 0x01; // flip only the last byte
    const tampered = `${type}.${iv}|${ct}|${bytesToBase64(macBytes)}`;
    await expect(decryptBw(tampered, ENC_KEY, MAC_KEY)).rejects.toThrow(/MAC mismatch/);
  });

  it('accepts a correct MAC (round-trip through the same guard)', async () => {
    const cipher = await encryptBw(textEncoder.encode('round-trip ✓'), ENC_KEY, MAC_KEY);
    expect(await decryptStr(cipher, ENC_KEY, MAC_KEY)).toBe('round-trip ✓');
  });
});

describe('cipher-string type dispatch', () => {
  it('decrypts a type-1 (no-MAC) cipher without requiring a mac key', async () => {
    // Reuse a valid type-2 IV+ciphertext but present it as a type-1 string, which
    // parseCipherString routes through the no-MAC branch (types 0/1/4).
    const cipher2 = await encryptBw(textEncoder.encode('legacy-secret'), ENC_KEY, MAC_KEY);
    const body = cipher2.slice(cipher2.indexOf('.') + 1);
    const [iv, ct] = body.split('|');
    const decrypted = await decryptBw(`1.${iv}|${ct}`, ENC_KEY);
    expect(new TextDecoder().decode(decrypted)).toBe('legacy-secret');
  });

  it('skips the MAC check for a type-1 cipher even when a mac key is supplied', async () => {
    const cipher2 = await encryptBw(textEncoder.encode('x'), ENC_KEY, MAC_KEY);
    const body = cipher2.slice(cipher2.indexOf('.') + 1);
    const [iv, ct] = body.split('|');
    // A bogus mac key must NOT cause a MAC-mismatch throw for a type-1 cipher.
    const bogusMac = textEncoder.encode('00000000000000000000000000000000');
    const decrypted = await decryptBw(`1.${iv}|${ct}`, ENC_KEY, bogusMac);
    expect(new TextDecoder().decode(decrypted)).toBe('x');
  });

  it('throws "invalid encrypted string" for a leading-dot cipher (p<=0)', async () => {
    await expect(decryptBw('.oops', ENC_KEY, MAC_KEY)).rejects.toThrow(/invalid encrypted string/);
  });

  it('throws "unsupported enc type" for an unknown type/part shape', async () => {
    await expect(decryptBw('9.onlyonepart', ENC_KEY, MAC_KEY)).rejects.toThrow(/unsupported enc type/);
  });

  it('decryptStr returns empty for null, undefined, empty and non-string inputs', async () => {
    expect(await decryptStr(null, ENC_KEY, MAC_KEY)).toBe('');
    expect(await decryptStr(undefined, ENC_KEY, MAC_KEY)).toBe('');
    expect(await decryptStr('', ENC_KEY, MAC_KEY)).toBe('');
    expect(await decryptStr(123 as unknown as string, ENC_KEY, MAC_KEY)).toBe('');
  });
});

describe('hkdfExpand — multi-block output', () => {
  it('an output length that is not a multiple of 32 shares its prefix with a shorter expansion', async () => {
    const prk = textEncoder.encode('pseudo-random-key-material-32byte');
    const short = await hkdfExpand(prk, 'enc', 32);
    const long = await hkdfExpand(prk, 'enc', 48);
    expect(long).toHaveLength(48);
    // HKDF-Expand output is a prefix chain: T(1) || first-16-of-T(2). The first
    // block must be byte-identical, pinning the copy-length/offset arithmetic.
    expect(bytesToBase64(long.slice(0, 32))).toBe(bytesToBase64(short));
    // The tail must be non-zero (proves the second block was actually written).
    expect(long.slice(32).some((b) => b !== 0)).toBe(true);
  });
});

describe('decryptBwFileData — length boundary', () => {
  it('rejects data shorter than the minimum header as "Invalid encrypted file data"', async () => {
    // 49 bytes = 1 + 16 + 32 (no room for ciphertext) -> below the < guard.
    await expect(decryptBwFileData(new Uint8Array(49), ENC_KEY, MAC_KEY)).rejects.toThrow(
      /Invalid encrypted file data/
    );
  });

  it('accepts the minimum valid length past the guard (fails later on the MAC, not the length)', async () => {
    // 50 bytes clears the length guard; type byte = 2, but the MAC won't match.
    const buf = new Uint8Array(50);
    buf[0] = 2;
    await expect(decryptBwFileData(buf, ENC_KEY, MAC_KEY)).rejects.toThrow(/MAC mismatch/);
  });

  it('rejects an unsupported file encryption type byte', async () => {
    const buf = new Uint8Array(50);
    buf[0] = 1; // not type 2
    await expect(decryptBwFileData(buf, ENC_KEY, MAC_KEY)).rejects.toThrow(
      /Unsupported file encryption type/
    );
  });

  it('round-trips real file data (sanity anchor for the boundary tests)', async () => {
    const data = crypto.getRandomValues(new Uint8Array(80));
    const encrypted = await encryptBwFileData(data, ENC_KEY, MAC_KEY);
    expect(await decryptBwFileData(encrypted, ENC_KEY, MAC_KEY)).toEqual(data);
  });
});
