import { describe, expect, it } from 'vitest';
import {
  bytesToBase64,
  calcTotpNow,
  decryptBw,
  decryptBwFileData,
  encryptBw,
  encryptBwFileData,
  hkdf,
  hkdfExpand,
  pbkdf2,
} from '@/lib/crypto';

// Hardening tests driven by mutation testing (Stryker) on the security-critical
// crypto: the regular suite "covered" these lines but mutants survived, meaning
// the assertions were too loose. These pin KNOWN-ANSWER vectors (so any
// output-changing mutation fails) and exercise the MAC/guard branches directly.
const enc = new TextEncoder();
const ENC_KEY = enc.encode('0123456789abcdef0123456789abcdef'); // 32 bytes
const MAC_KEY = enc.encode('fedcba9876543210fedcba9876543210'); // 32 bytes
const RFC6238_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('pbkdf2 known-answer (PBKDF2-HMAC-SHA256)', () => {
  it('matches the exact derived key for password/salt/1 iteration', async () => {
    const out = await pbkdf2('password', 'salt', 1, 32);
    expect(bytesToBase64(out)).toBe('Eg+2z/z4syxD5yJSVsT4N6hlSMkszDVICAWYfLcL4Xs=');
  });

  it('changes with the iteration count (exact value for 2 iterations)', async () => {
    const out = await pbkdf2('password', 'salt', 2, 32);
    expect(bytesToBase64(out)).toBe('rk0Mla9rRtMtCt/5KPBt0CowP47zwlHf1uLYWpVHTEM=');
  });

  it('treats string and equivalent byte inputs identically', async () => {
    const fromStr = await pbkdf2('password', 'salt', 1, 32);
    const fromBytes = await pbkdf2(enc.encode('password'), enc.encode('salt'), 1, 32);
    expect(bytesToBase64(fromBytes)).toBe(bytesToBase64(fromStr));
  });

  it('respects the requested key length', async () => {
    expect(await pbkdf2('password', 'salt', 1, 16)).toHaveLength(16);
    expect(await pbkdf2('password', 'salt', 1, 64)).toHaveLength(64);
  });
});

describe('hkdfExpand multi-block correctness', () => {
  it('matches the exact 64-byte (two-block) expansion', async () => {
    const prk = enc.encode('pseudo-random-key-material-32byte');
    const out = await hkdfExpand(prk, 'enc', 64);
    expect(bytesToBase64(out)).toBe(
      'varAvYi7/zOIB9nLsXCMLfMPYad8VIC1w0JWckFOTj3LmM9Av9r2wWDtSnA6+Fxm04fOF/4ZyjuMOp2zBjPgIQ=='
    );
  });

  it('first block of a long expansion equals a single-block expansion (counter wiring)', async () => {
    const prk = enc.encode('pseudo-random-key-material-32byte');
    const long = await hkdfExpand(prk, 'enc', 64);
    const short = await hkdfExpand(prk, 'enc', 32);
    expect(bytesToBase64(long.slice(0, 32))).toBe(bytesToBase64(short));
    // The second block must differ from the first (proves the counter advances).
    expect(bytesToBase64(long.slice(32, 64))).not.toBe(bytesToBase64(long.slice(0, 32)));
  });
});

describe('decryptBw enforces the MAC', () => {
  it('decrypts a correctly-MACed cipher string', async () => {
    const cipher = await encryptBw(enc.encode('secret'), ENC_KEY, MAC_KEY);
    expect(new TextDecoder().decode(await decryptBw(cipher, ENC_KEY, MAC_KEY))).toBe('secret');
  });

  it('rejects a flipped ciphertext byte (MAC mismatch)', async () => {
    const cipher = await encryptBw(enc.encode('secret-value'), ENC_KEY, MAC_KEY);
    const [type, iv, ct, mac] = [cipher.slice(0, 2), ...cipher.slice(2).split('|')];
    // Corrupt the first base64 char of the ciphertext segment.
    const flipped = ct[0] === 'A' ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
    const tampered = `${type}${iv}|${flipped}|${mac}`;
    await expect(decryptBw(tampered, ENC_KEY, MAC_KEY)).rejects.toThrow(/MAC mismatch/);
  });

  it('rejects the wrong MAC key', async () => {
    const cipher = await encryptBw(enc.encode('secret'), ENC_KEY, MAC_KEY);
    const wrongMac = enc.encode('00000000000000000000000000000000');
    await expect(decryptBw(cipher, ENC_KEY, wrongMac)).rejects.toThrow(/MAC mismatch/);
  });

  it('skips MAC verification only when no MAC key is supplied', async () => {
    // A type-2 string decrypts without a MAC key (verification is conditional on
    // the key being present) — proves the `macKey &&` guard is load-bearing.
    const cipher = await encryptBw(enc.encode('no-mac-check'), ENC_KEY, MAC_KEY);
    expect(new TextDecoder().decode(await decryptBw(cipher, ENC_KEY))).toBe('no-mac-check');
  });

  it('rejects malformed cipher strings', async () => {
    await expect(decryptBw('not-a-cipher-string', ENC_KEY, MAC_KEY)).rejects.toThrow();
    await expect(decryptBw('9.only-one-part', ENC_KEY, MAC_KEY)).rejects.toThrow();
  });
});

describe('hkdf (extract + expand) input handling', () => {
  it('treats string and equivalent byte salt/info identically and respects length', async () => {
    const ikm = enc.encode('input-key-material');
    const fromStr = await hkdf(ikm, 'salt', 'info', 32);
    const fromBytes = await hkdf(ikm, enc.encode('salt'), enc.encode('info'), 32);
    expect(bytesToBase64(fromBytes)).toBe(bytesToBase64(fromStr));
    expect(fromStr).toHaveLength(32);
    // Different info must produce different output (the info is actually used).
    const other = await hkdf(ikm, 'salt', 'other', 32);
    expect(bytesToBase64(other)).not.toBe(bytesToBase64(fromStr));
  });
});

describe('decryptBwFileData guards', () => {
  it('rejects data shorter than the header + minimum body (incl. the exact boundary)', async () => {
    await expect(decryptBwFileData(new Uint8Array(40), ENC_KEY, MAC_KEY)).rejects.toThrow(
      /Invalid encrypted file data/
    );
    // Boundary: minimum is 1 + 16 + 32 + 1 = 50 bytes, so 49 must still reject.
    await expect(decryptBwFileData(new Uint8Array(49), ENC_KEY, MAC_KEY)).rejects.toThrow(
      /Invalid encrypted file data/
    );
  });

  it('rejects an unsupported encryption-type byte', async () => {
    const good = await encryptBwFileData(crypto.getRandomValues(new Uint8Array(64)), ENC_KEY, MAC_KEY);
    good[0] = 1; // not type 2
    await expect(decryptBwFileData(good, ENC_KEY, MAC_KEY)).rejects.toThrow(
      /Unsupported file encryption type/
    );
  });
});

describe('TOTP RFC 6238 multi-time vectors', () => {
  it('matches the SHA-1 code at T=1111111109', async () => {
    const result = await calcTotpNow(RFC6238_SEED, 1111111109_000);
    expect(result?.code).toBe('081804');
  });

  it('matches the SHA-1 code at T=1234567890', async () => {
    const result = await calcTotpNow(RFC6238_SEED, 1234567890_000);
    expect(result?.code).toBe('005924');
  });
});
