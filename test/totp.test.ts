import { describe, expect, it } from 'vitest';
import { isTotpEnabled, verifyTotpToken } from '../src/utils/totp';

function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

// RFC 6238 reference secret is the ASCII string "12345678901234567890".
// Derive its Base32 form at runtime so no high-entropy literal is committed
// (the RFC vector outputs below would fail if this derivation were wrong).
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('verifyTotpToken', () => {
  it('accepts RFC 6238 reference vectors (6-digit, SHA-1, 30s step)', async () => {
    // T=59s  -> 8-digit 94287082 -> 6-digit 287082
    await expect(verifyTotpToken(RFC_SECRET, '287082', 59 * 1000)).resolves.toBe(true);
    // T=1111111109s -> 8-digit 07081804 -> 6-digit 081804
    await expect(verifyTotpToken(RFC_SECRET, '081804', 1111111109 * 1000)).resolves.toBe(true);
    // T=1234567890s -> 8-digit 89005924 -> 6-digit 005924
    await expect(verifyTotpToken(RFC_SECRET, '005924', 1234567890 * 1000)).resolves.toBe(true);
  });

  it('tolerates spaces in the submitted token', async () => {
    await expect(verifyTotpToken(RFC_SECRET, '287 082', 59 * 1000)).resolves.toBe(true);
  });

  it('accepts a base32 secret with spaces, dashes and padding', async () => {
    const messy = `  ${RFC_SECRET.toLowerCase().replace(/(.{4})/g, '$1-')}====  `;
    await expect(verifyTotpToken(messy, '287082', 59 * 1000)).resolves.toBe(true);
  });

  it('accepts tokens within the +/-1 step drift window', async () => {
    // 287082 is valid at T=59 (counter 1). It should still pass one step earlier/later.
    await expect(verifyTotpToken(RFC_SECRET, '287082', 89 * 1000)).resolves.toBe(true); // counter 2
    await expect(verifyTotpToken(RFC_SECRET, '287082', 29 * 1000)).resolves.toBe(true); // counter 0
  });

  it('rejects tokens outside the drift window', async () => {
    // Two steps away (counter 3) is beyond the +/-1 window.
    await expect(verifyTotpToken(RFC_SECRET, '287082', 119 * 1000)).resolves.toBe(false);
  });

  it('rejects malformed tokens', async () => {
    await expect(verifyTotpToken(RFC_SECRET, '12345', 59 * 1000)).resolves.toBe(false);
    await expect(verifyTotpToken(RFC_SECRET, '1234567', 59 * 1000)).resolves.toBe(false);
    await expect(verifyTotpToken(RFC_SECRET, 'abcdef', 59 * 1000)).resolves.toBe(false);
    await expect(verifyTotpToken(RFC_SECRET, '', 59 * 1000)).resolves.toBe(false);
  });

  it('rejects when the secret is empty or invalid base32', async () => {
    await expect(verifyTotpToken('', '287082', 59 * 1000)).resolves.toBe(false);
    await expect(verifyTotpToken('0189!@#', '287082', 59 * 1000)).resolves.toBe(false);
  });
});

describe('isTotpEnabled', () => {
  it('is true for a non-empty base32 secret', () => {
    expect(isTotpEnabled(RFC_SECRET)).toBe(true);
    expect(isTotpEnabled('gezd gnbv')).toBe(true);
  });

  it('is false for empty/nullish/padding-only secrets', () => {
    expect(isTotpEnabled('')).toBe(false);
    expect(isTotpEnabled(null)).toBe(false);
    expect(isTotpEnabled(undefined)).toBe(false);
    expect(isTotpEnabled('====')).toBe(false);
    expect(isTotpEnabled('   ')).toBe(false);
  });
});
