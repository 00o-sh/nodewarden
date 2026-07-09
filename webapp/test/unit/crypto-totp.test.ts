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
  extra?: number[]; // raw protobuf bytes appended to the OtpParameters message
}

// A bare protobuf tag: (fieldNumber << 3) | wireType, with an optional payload.
function rawField(fieldNumber: number, wireType: number, payload: number[] = []): number[] {
  return [(fieldNumber << 3) | wireType, ...payload];
}

// Wrap arbitrary raw bytes in a migration URI (used for malformed payloads).
function migrationUriFromBytes(bytes: number[]): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `otpauth-migration://offline?data=${encodeURIComponent(btoa(binary))}`;
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
    if (p.extra) inner.push(...p.extra);
    bytes.push(...lengthDelimited(1, inner));
  }
  return migrationUriFromBytes(bytes);
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

  it('extracts otpauth params via the manual fallback when URL parsing fails', () => {
    // An out-of-range port makes `new URL` throw, so parseTotpConfig re-parses the
    // query string by hand.
    const uri = 'otpauth://totp:999999999999/ACME:alice?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60';
    expect(extractTotpSecret(uri)).toBe('JBSWY3DPEHPK3PXP');
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

  it('maps migration algorithm id 2 to SHA-256', () => {
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'a', issuer: 'X', algorithm: 2, digits: 1, type: 2 },
    ]);
    const parsed = new URL(normalizeTotpInput(uri));
    expect(parsed.searchParams.get('algorithm')).toBe('SHA256');
    expect(parsed.searchParams.get('secret')).toBe(RFC_SHA1_SECRET_B32);
  });

  it('maps migration algorithm id 3 to SHA-512', () => {
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'a', issuer: 'X', algorithm: 3, digits: 1, type: 2 },
    ]);
    const parsed = new URL(normalizeTotpInput(uri));
    expect(parsed.searchParams.get('algorithm')).toBe('SHA512');
  });

  it('drops an account whose algorithm id is unrecognized', () => {
    // Algorithm id 5 is not a known enum value -> the account is discarded.
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'a', issuer: 'X', algorithm: 5, digits: 1, type: 2 },
    ]);
    expect(normalizeTotpInput(uri)).toBe('');
  });

  it('skips unknown protobuf fields of every supported wire type', () => {
    // Append trailing unknown fields covering wire types 0 (varint), 1 (64-bit),
    // 2 (length-delimited) and 5 (32-bit); each must be skipped cleanly, leaving
    // a valid single-account payload behind.
    const extra = [
      ...rawField(7, 0, encodeVarint(300)),
      ...rawField(8, 1, [1, 2, 3, 4, 5, 6, 7, 8]),
      ...lengthDelimited(9, [9, 9, 9]),
      ...rawField(10, 5, [1, 2, 3, 4]),
    ];
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'a', issuer: 'X', algorithm: 1, digits: 1, type: 2, extra },
    ]);
    const parsed = new URL(normalizeTotpInput(uri));
    expect(parsed.searchParams.get('secret')).toBe(RFC_SHA1_SECRET_B32);
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1');
  });

  it('drops an account when an unknown field uses an unsupported wire type', () => {
    // Wire type 3 (group start) is not something the minimal reader can skip.
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'a', issuer: 'X', algorithm: 1, digits: 1, type: 2, extra: rawField(7, 3) },
    ]);
    expect(normalizeTotpInput(uri)).toBe('');
  });

  it('returns empty when the payload contains a truncated (never-terminating) varint', () => {
    // A lone 0x80 byte sets the varint continuation bit with no terminating byte,
    // so the varint reader runs off the end of the buffer.
    expect(normalizeTotpInput(migrationUriFromBytes([0x80]))).toBe('');
  });
});

// Wrap a raw OtpParameters byte array as the sole entry of a MigrationPayload.
function migrationFromInner(inner: number[]): string {
  return migrationUriFromBytes(lengthDelimited(1, inner));
}
const SECRET_FIELD = lengthDelimited(1, Array.from(RFC_SHA1_SECRET_BYTES));

describe('normalizeTotpInput - protobuf/otpauth edge cases', () => {
  it('base32-encodes a secret whose bit length is not a multiple of 5', () => {
    // A single 0x61 byte leaves trailing bits, exercising the base32 padding path.
    const uri = buildMigrationUri([
      { secret: new Uint8Array([0x61]), name: 'a', issuer: 'X', algorithm: 1, digits: 1, type: 2 },
    ]);
    expect(new URL(normalizeTotpInput(uri)).searchParams.get('secret')).toBe('ME');
  });

  it('returns empty when a terminating varint exceeds the safe-integer range', () => {
    // 8 bytes all high-bit set except the last: decodes to 2^56-1 (> MAX_SAFE_INTEGER).
    expect(normalizeTotpInput(migrationUriFromBytes([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]))).toBe('');
  });

  it('returns empty when a length-delimited field overruns the buffer', () => {
    // Inner secret field claims length 50 with no data behind it.
    expect(normalizeTotpInput(migrationFromInner([0x0a, 0x32]))).toBe('');
  });

  it('returns empty when an inner field key is a truncated varint', () => {
    expect(normalizeTotpInput(migrationFromInner([0x80]))).toBe('');
  });

  it('returns empty when the top-level otp_parameters field overruns', () => {
    // Top-level field 1 (wire type 2) with an over-long declared length.
    expect(normalizeTotpInput(migrationUriFromBytes([0x0a, 0x32]))).toBe('');
  });

  it('returns empty when a top-level field uses an unsupported wire type', () => {
    // Field 2, wire type 3 (group start) cannot be skipped -> payload rejected.
    expect(normalizeTotpInput(migrationUriFromBytes([0x13]))).toBe('');
  });

  it('returns empty when base64 data cannot be decoded', () => {
    expect(normalizeTotpInput('otpauth-migration://offline?data=****')).toBe('');
  });

  it('treats an unreadable name field as an empty label (falls back to "TOTP")', () => {
    // Valid secret followed by a name field (2) whose length overruns -> name "".
    const uri = normalizeTotpInput(migrationFromInner([...SECRET_FIELD, 0x12, 0x32]));
    const parsed = new URL(uri);
    expect(parsed.searchParams.get('secret')).toBe(RFC_SHA1_SECRET_B32);
    expect(decodeURIComponent(parsed.pathname)).toBe('/TOTP');
  });

  it('treats an unreadable issuer field as empty, labelling by name only', () => {
    const inner = [...SECRET_FIELD, ...lengthDelimited(2, Array.from(new TextEncoder().encode('alice'))), 0x1a, 0x32];
    const parsed = new URL(normalizeTotpInput(migrationFromInner(inner)));
    expect(decodeURIComponent(parsed.pathname)).toBe('/alice');
    expect(parsed.searchParams.get('issuer')).toBeNull();
  });

  it('labels by issuer only when the account has no name', () => {
    const uri = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, issuer: 'ACME', algorithm: 1, digits: 1, type: 2 },
    ]);
    const parsed = new URL(normalizeTotpInput(uri));
    expect(decodeURIComponent(parsed.pathname)).toBe('/ACME');
    expect(parsed.searchParams.get('issuer')).toBe('ACME');
  });

  it('drops an account whose algorithm varint is truncated', () => {
    expect(normalizeTotpInput(migrationFromInner([...SECRET_FIELD, 0x20, 0x80]))).toBe('');
  });

  it('defaults digits to 6 when the digits varint is truncated', () => {
    // Secret + valid algorithm (SHA-1) + truncated digits field.
    const inner = [...SECRET_FIELD, ...varintField(4, 1), 0x28, 0x80];
    const parsed = new URL(normalizeTotpInput(migrationFromInner(inner)));
    expect(parsed.searchParams.get('digits')).toBe('6');
  });

  it('treats a truncated otp-type varint as TOTP (type 0)', () => {
    const parsed = new URL(normalizeTotpInput(migrationFromInner([...SECRET_FIELD, 0x30, 0x80])));
    expect(parsed.searchParams.get('secret')).toBe(RFC_SHA1_SECRET_B32);
  });

  it('parses migration data via the manual query fallback when URL parsing fails', () => {
    // An invalid port makes `new URL` throw, forcing readOtpAuthParam().
    const good = buildMigrationUri([
      { secret: RFC_SHA1_SECRET_BYTES, name: 'a', issuer: 'ACME', algorithm: 1, digits: 1, type: 2 },
    ]);
    const data = good.split('data=')[1];
    const uri = `otpauth-migration://host:999999999999?data=${data}`;
    const parsed = new URL(normalizeTotpInput(uri));
    expect(parsed.searchParams.get('secret')).toBe(RFC_SHA1_SECRET_B32);
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

  it('falls back to default digits when digits is not an integer', async () => {
    const uri = `otpauth://totp/x?secret=${RFC_SHA1_SECRET_B32}&digits=abc`;
    const result = await calcTotpNow(uri, 59_000);
    // Non-integer digits -> default 6.
    expect(result?.code).toHaveLength(6);
  });

  it('falls back to the default period when period is not a safe integer', async () => {
    const uri = `otpauth://totp/x?secret=${RFC_SHA1_SECRET_B32}&period=notanumber`;
    const result = await calcTotpNow(uri, 25_000);
    expect(result?.period).toBe(30);
    expect(result?.remain).toBe(5);
  });

  it('reads digits/period via the manual fallback when URL parsing fails', async () => {
    const uri = 'otpauth://totp:999999999999/x?secret=' + RFC_SHA1_SECRET_B32 + '&digits=8&period=60';
    const result = await calcTotpNow(uri, 59_000);
    expect(result?.period).toBe(60);
    expect(result?.code).toHaveLength(8);
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
