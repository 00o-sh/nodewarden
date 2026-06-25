import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  calcTotpNow,
  concatBytes,
  decryptBw,
  decryptBwFileData,
  decryptStr,
  encryptBw,
  encryptBwFileData,
  extractTotpSecret,
  hkdf,
  hkdfExpand,
  pbkdf2,
  sha256Base64,
} from '@/lib/crypto';

const textEncoder = new TextEncoder();

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 128, 64]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('matches a known base64 vector', () => {
    expect(bytesToBase64(textEncoder.encode('hello'))).toBe('aGVsbG8=');
  });

  it('concatenates byte arrays', () => {
    expect(concatBytes(new Uint8Array([1, 2]), new Uint8Array([3, 4]))).toEqual(
      new Uint8Array([1, 2, 3, 4])
    );
  });
});

describe('sha256Base64', () => {
  it('matches the known SHA-256 digest of "abc"', async () => {
    // FIPS 180-2 test vector for "abc", base64-encoded.
    expect(await sha256Base64('abc')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });
});

describe('pbkdf2', () => {
  it('matches RFC 6070-style derivation (deterministic)', async () => {
    const a = await pbkdf2('password', 'salt', 1, 32);
    const b = await pbkdf2('password', 'salt', 1, 32);
    expect(bytesToBase64(a)).toBe(bytesToBase64(b));
    expect(a).toHaveLength(32);
  });

  it('produces different output for different iteration counts', async () => {
    const a = await pbkdf2('password', 'salt', 1, 32);
    const b = await pbkdf2('password', 'salt', 2, 32);
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(b));
  });
});

describe('hkdf', () => {
  it('hkdfExpand is deterministic and length-correct', async () => {
    const prk = textEncoder.encode('pseudo-random-key-material-32byte');
    const a = await hkdfExpand(prk, 'enc', 32);
    const b = await hkdfExpand(prk, 'enc', 32);
    expect(a).toHaveLength(32);
    expect(bytesToBase64(a)).toBe(bytesToBase64(b));
  });

  it('different info yields different output', async () => {
    const prk = textEncoder.encode('pseudo-random-key-material-32byte');
    const enc = await hkdfExpand(prk, 'enc', 32);
    const mac = await hkdfExpand(prk, 'mac', 32);
    expect(bytesToBase64(enc)).not.toBe(bytesToBase64(mac));
  });

  it('full hkdf (extract+expand) is deterministic', async () => {
    const ikm = textEncoder.encode('input-key-material');
    const out = await hkdf(ikm, 'salt', 'info', 32);
    expect(out).toHaveLength(32);
    expect(bytesToBase64(out)).toBe(bytesToBase64(await hkdf(ikm, 'salt', 'info', 32)));
  });
});

describe('Bitwarden AES-CBC-HMAC string encryption', () => {
  const encKey = textEncoder.encode('0123456789abcdef0123456789abcdef'); // 32 bytes
  const macKey = textEncoder.encode('fedcba9876543210fedcba9876543210'); // 32 bytes

  it('encrypts to a type-2 cipher string and decrypts back', async () => {
    const plaintext = 'super secret password ✓';
    const cipher = await encryptBw(textEncoder.encode(plaintext), encKey, macKey);
    expect(cipher.startsWith('2.')).toBe(true);
    expect(cipher.split('|')).toHaveLength(3);

    const decrypted = await decryptStr(cipher, encKey, macKey);
    expect(decrypted).toBe(plaintext);
  });

  it('rejects a tampered MAC', async () => {
    const cipher = await encryptBw(textEncoder.encode('data'), encKey, macKey);
    const wrongMac = textEncoder.encode('00000000000000000000000000000000');
    await expect(decryptBw(cipher, encKey, wrongMac)).rejects.toThrow(/MAC mismatch/);
  });

  it('decryptStr returns empty string for empty input', async () => {
    expect(await decryptStr('', encKey, macKey)).toBe('');
    expect(await decryptStr(null, encKey, macKey)).toBe('');
  });

  it('round-trips raw file data through the binary format', async () => {
    const data = crypto.getRandomValues(new Uint8Array(200));
    const encrypted = await encryptBwFileData(data, encKey, macKey);
    expect(encrypted[0]).toBe(2); // EncryptionType.AesCbc256_HmacSha256
    const decrypted = await decryptBwFileData(encrypted, encKey, macKey);
    expect(decrypted).toEqual(data);
  });

  it('rejects file data with a corrupted MAC', async () => {
    const data = crypto.getRandomValues(new Uint8Array(64));
    const encrypted = await encryptBwFileData(data, encKey, macKey);
    encrypted[20] ^= 0xff; // flip a byte inside the MAC region
    await expect(decryptBwFileData(encrypted, encKey, macKey)).rejects.toThrow(/MAC mismatch/);
  });
});

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vector', async () => {
    // RFC 6238 Appendix B: ASCII secret "12345678901234567890" => base32
    // "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; at T=59s the 8-digit code is 94287082,
    // so the standard 6-digit code is 287082.
    const result = await calcTotpNow('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000);
    expect(result).not.toBeNull();
    expect(result?.code).toBe('287082');
    expect(result?.remain).toBe(1);
  });

  it('extracts the secret from an otpauth:// URI', () => {
    expect(extractTotpSecret('otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example'))
      .toBe('JBSWY3DPEHPK3PXP');
  });

  it('normalises a raw base32 secret (uppercases, strips spaces)', () => {
    expect(extractTotpSecret('jbsw y3dp ehpk 3pxp')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('returns null for an empty secret', async () => {
    expect(await calcTotpNow('')).toBeNull();
  });

  it('produces a 5-character Steam code for steam:// secrets', async () => {
    const result = await calcTotpNow('steam://JBSWY3DPEHPK3PXP', 0);
    expect(result?.code).toHaveLength(5);
  });
});
