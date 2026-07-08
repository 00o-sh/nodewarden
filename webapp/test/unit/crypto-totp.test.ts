import { describe, expect, it } from 'vitest';
import { calcTotpNow, extractTotpSecret, normalizeTotpInput } from '@/lib/crypto';

// ---------------------------------------------------------------------------
// Helpers for building a Google Authenticator "otpauth-migration://" payload.
// The payload is a protobuf message:
//   MigrationPayload { repeated OtpParameters otp_parameters = 1; }
//   OtpParameters { bytes secret = 1; string name = 2; string issuer = 3;
//                   Algorithm algorithm = 4; DigitCount digits = 5; OtpType type = 6; }
// ---------------------------------------------------------------------------
function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    out.push(byte);
  } while (v > 0);
  return out;
}

function lengthDelimited(fieldNumber: number, payload: number[]): number[] {
  const tag = (fieldNumber << 3) | 2;
  return [tag, ...encodeVarint(payload.length), ...payload];
}

function varintField(fieldNumber: number, value: number): number[] {
  const tag = (fieldNumber << 3) | 0;
  return [tag, ...encodeVarint(value)];
}

interface MigrationParam {
  secret: Uint8Array;
  name?: string;
  issuer?: string;
  algorithm?: number; // 1=SHA1, 2=SHA256, 3=SHA512
  digits?: number; // 1 => 6 digits, 2 => 8 digits
  type?: number; // 1=HOTP, 2=TOTP
}

function buildMigrationUri(params: MigrationParam[]): string {
  const bytes: number[] = [];
  for (const p of params) {
    const inner: number[] = [];
    inner.push(...lengthDelimited(1, Array.from(p.secret)));
    if (p.name !== undefined) inner.push(...lengthDelimited(2, Array.from(new TextEncoder().encode(p.name))));
    if (p.issuer !== undefined) inner.push(...lengthDelimited(3, Array.from(new TextEncoder().encode(p.issuer))));
    if (p.algorithm !== undefined) inner.push(...varintField(4, p.algorithm));
    if (p.digits !== undefined) inner.push(...varintField(5, p.digits));
    if (p.type !== undefined) inner.push(...varintField(6, p.type));
    bytes.push(...lengthDelimited(1, inner));
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const data = btoa(binary);
  return `otpauth-migration://offline?data=${encodeURIComponent(data)}`;
}

// ASCII "12345678901234567890" == base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" (RFC 6238).
const RFC_SHA1_SECRET_BYTES = new TextEncoder().encode('12345678901234567890');
const RFC_SHA1_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_SHA256_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const RFC_SHA512_SECRET_B32 =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

describe('extractTotpSecret - otpauth parsing', () => {
  it('reads the secret and normalizes casing/spacing on a bare base32 value', () => {
    expect(extractTotpSecret('  jbsw y3dp-ehpk-3pxp  ')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('strips trailing base32 padding from the secret', () => {
    expect(extractTotpSecret('JBSWY3DPEHPK3PXP====')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('parses an otpauth:// URI with issuer and account label', () => {
    expect(
      extractTotpSecret('otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME&digits=8&period=60&algorithm=SHA256')
    ).toBe('JBSWY3DPEHPK3PXP');
  });

  it('extracts a Steam secret from a steam:// URI', () => {
    expect(extractTotpSecret('steam://JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('returns empty for a non-otpauth scheme URL', () => {
    expect(extractTotpSecret('https://example.com/?secret=JBSWY3DPEHPK3PXP')).toBe('');
  });

  it('returns empty for empty/whitespace input', () => {
    expect(extractTotpSecret('   ')).toBe('');
  });
});

describe('normalizeTotpInput', () => {
  it('passes a bare secret through unchanged (trimmed)', () => {
    expect(normalizeTotpInput('  JBSWY3DPEHPK3PXP ')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('passes an otpauth:// URI through unchanged', () => {
    const uri = 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example';
    expect(normalizeTotpInput(uri)).toBe(uri);
  });

  it('rejects an unrelated URL scheme', () => {
    expect(normalizeTotpInput('mailto://alice@example.com')).toBe('');
  });

  it('converts a single-account Google Authenticator migration URI to otpauth://', () => {
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'alice', issuer: 'ACME', algorithm: 1, digits: 1, type: 2 },
    ]);
    const result = normalizeTotpInput(uri);
    expect(result.startsWith('otpauth://totp/')).toBe(true);
    const parsed = new URL(result);
    expect(parsed.searchParams.get('secret')).toBe(RFC_SHA1_SECRET_B32);
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1');
    expect(parsed.searchParams.get('digits')).toBe('6');
    expect(parsed.searchParams.get('period')).toBe('30');
    expect(parsed.searchParams.get('issuer')).toBe('ACME');
    // Label combines issuer and account name (host is "totp", path is the label).
    expect(parsed.host).toBe('totp');
    expect(decodeURIComponent(parsed.pathname)).toBe('/ACME:alice');
  });

  it('maps digits=2 to an 8-digit otpauth URI', () => {
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'bob', issuer: 'Corp', algorithm: 1, digits: 2, type: 2 },
    ]);
    const parsed = new URL(normalizeTotpInput(uri));
    expect(parsed.searchParams.get('digits')).toBe('8');
  });

  it('returns empty when a migration payload carries multiple accounts', () => {
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'a', issuer: 'X', algorithm: 1, digits: 1, type: 2 },
      { secret: RFC_SHA1_SECRET_BYTES, name: 'b', issuer: 'Y', algorithm: 1, digits: 1, type: 2 },
    ]);
    expect(normalizeTotpInput(uri)).toBe('');
  });

  it('skips HOTP entries (type=1) so a lone HOTP account yields empty', () => {
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'h', issuer: 'Z', algorithm: 1, digits: 1, type: 1 },
    ]);
    expect(normalizeTotpInput(uri)).toBe('');
  });

  it('returns empty for a migration URI with no data payload', () => {
    expect(normalizeTotpInput('otpauth-migration://offline?foo=bar')).toBe('');
  });
});

describe('calcTotpNow - algorithm/digits/period handling', () => {
  it('matches the RFC 6238 SHA-256 6-digit vector at T=59', async () => {
    const uri = `otpauth://totp/x?secret=${RFC_SHA256_SECRET_B32}&algorithm=SHA256`;
    const result = await calcTotpNow(uri, 59_000);
    expect(result?.code).toBe('119246');
  });

  it('matches the RFC 6238 SHA-512 6-digit vector at T=59', async () => {
    const uri = `otpauth://totp/x?secret=${RFC_SHA512_SECRET_B32}&algorithm=SHA512`;
    const result = await calcTotpNow(uri, 59_000);
    expect(result?.code).toBe('693936');
  });

  it('produces an 8-digit code when digits=8 is requested', async () => {
    const uri = `otpauth://totp/x?secret=${RFC_SHA1_SECRET_B32}&digits=8`;
    const result = await calcTotpNow(uri, 59_000);
    expect(result?.code).toBe('94287082');
  });

  it('honors a custom period for the remaining-seconds countdown', async () => {
    const uri = `otpauth://totp/x?secret=${RFC_SHA1_SECRET_B32}&period=60`;
    const result = await calcTotpNow(uri, 0);
    expect(result?.period).toBe(60);
    expect(result?.remain).toBe(60);
  });

  it('reports the time remaining in the current 30s window', async () => {
    const result = await calcTotpNow(RFC_SHA1_SECRET_B32, 25_000);
    // 25s into the epoch => 30 - (25 % 30) = 5 seconds remaining.
    expect(result?.remain).toBe(5);
    expect(result?.period).toBe(30);
  });

  it('returns null when the secret decodes to zero bytes', async () => {
    // "1" and "8" and "9" and "0" are not valid base32 chars => empty key.
    expect(await calcTotpNow('1189')).toBeNull();
  });

  it('returns null for an empty secret', async () => {
    expect(await calcTotpNow('')).toBeNull();
  });

  it('produces a deterministic 5-character Steam code', async () => {
    const a = await calcTotpNow('steam://JBSWY3DPEHPK3PXP', 30_000);
    const b = await calcTotpNow('steam://JBSWY3DPEHPK3PXP', 30_000);
    expect(a?.code).toHaveLength(5);
    expect(a?.code).toBe(b?.code);
    // Steam alphabet excludes digits like 0/1 and letters like A/E/I/L/O/S/U/Z.
    expect(a?.code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  });
});
