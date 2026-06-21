import { describe, expect, it } from 'vitest';
import { Env, Send, SendAuthType, SendType } from '../../src/types';
import {
  base64UrlDecode,
  base64UrlEncode,
  extractBearerToken,
  formatSize,
  fromAccessId,
  getSafeJwtSecret,
  hasEmailAuth,
  isSendAvailable,
  normalizeEmails,
  parseDate,
  parseFileLength,
  parseInteger,
  parseMaxAccessCount,
  parseSendAuthType,
  parseSendType,
  parseStoredSendData,
  sanitizeSendData,
  setSendPassword,
  validateDeletionDate,
  verifySendPassword,
  verifySendPasswordHashB64,
} from '../../src/handlers/sends-shared';

// Pure Send helper functions exercised with real WebCrypto (PBKDF2) and real
// base64 — no mocks.
function send(overrides: Partial<Send> = {}): Send {
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return {
    id: '00112233-4455-6677-8899-aabbccddeeff',
    userId: 'u1',
    type: SendType.Text,
    name: 'n',
    notes: null,
    data: JSON.stringify({ text: 'secret' }),
    key: 'k',
    passwordHash: null,
    passwordSalt: null,
    passwordIterations: null,
    authType: SendAuthType.None,
    emails: null,
    maxAccessCount: null,
    accessCount: 0,
    disabled: false,
    hideEmail: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expirationDate: null,
    deletionDate: future,
    ...overrides,
  } as Send;
}

describe('base64url + access id', () => {
  it('round-trips bytes and rejects undecodable access ids', () => {
    const bytes = new Uint8Array([0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]);
    expect(Array.from(base64UrlDecode(base64UrlEncode(bytes))!)).toEqual(Array.from(bytes));
    expect(fromAccessId(base64UrlEncode(bytes))).toBe('00112233-4455-6677-8899-aabbccddeeff');
    expect(fromAccessId(base64UrlEncode(new Uint8Array([1, 2, 3])))).toBeNull(); // not 16 bytes
  });
});

describe('formatSize', () => {
  it('formats across unit boundaries', () => {
    expect(formatSize(512)).toBe('512 Bytes');
    expect(formatSize(2048)).toBe('2.00 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });
});

describe('parsers', () => {
  it('parseDate accepts ISO strings and rejects the rest', () => {
    expect(parseDate('2026-01-01T00:00:00.000Z')).toBeInstanceOf(Date);
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate(123 as unknown)).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('parseInteger handles numbers, numeric strings, and rejects floats/garbage', () => {
    expect(parseInteger(5)).toBe(5);
    expect(parseInteger('7')).toBe(7);
    expect(parseInteger(1.5)).toBeNull();
    expect(parseInteger('x')).toBeNull();
    expect(parseInteger('')).toBeNull();
    expect(parseInteger(null)).toBeNull();
  });

  it('parseMaxAccessCount: null passthrough, valid value, negative/invalid rejected', () => {
    expect(parseMaxAccessCount(undefined)).toEqual({ ok: true, value: null });
    expect(parseMaxAccessCount(3)).toEqual({ ok: true, value: 3 });
    expect(parseMaxAccessCount(-1).ok).toBe(false);
    expect(parseMaxAccessCount('x').ok).toBe(false);
  });

  it('parseFileLength: valid, invalid, and negative', () => {
    expect(parseFileLength(10)).toEqual({ ok: true, value: 10 });
    expect(parseFileLength('x').ok).toBe(false);
    expect(parseFileLength(-5).ok).toBe(false);
  });

  it('parseSendType and parseSendAuthType', () => {
    expect(parseSendType(0)).toBe(SendType.Text);
    expect(parseSendType(1)).toBe(SendType.File);
    expect(parseSendType(9)).toBeNull();
    expect(parseSendAuthType(0)).toBe(SendAuthType.Email);
    expect(parseSendAuthType(null)).toBeNull();
    expect(parseSendAuthType(9)).toBeNull();
  });

  it('normalizeEmails joins arrays and passes strings', () => {
    expect(normalizeEmails(null)).toBeNull();
    expect(normalizeEmails('a@b.test')).toBe('a@b.test');
    expect(normalizeEmails(['a@b.test', 'c@d.test'])).toBe('a@b.test,c@d.test');
    expect(normalizeEmails([])).toBeNull();
    expect(normalizeEmails(42)).toBeNull();
  });

  it('sanitizeSendData strips response and rejects non-objects', () => {
    expect(sanitizeSendData({ text: 'x', response: 'leak' })).toEqual({ text: 'x' });
    expect(sanitizeSendData([1, 2])).toBeNull();
    expect(sanitizeSendData('nope')).toBeNull();
  });

  it('parseStoredSendData returns {} on malformed data', () => {
    expect(parseStoredSendData(send({ data: '{"a":1}' }))).toEqual({ a: 1 });
    expect(parseStoredSendData(send({ data: '{bad' }))).toEqual({});
    expect(parseStoredSendData(send({ data: '[1,2]' }))).toEqual({});
  });
});

describe('isSendAvailable', () => {
  it('is true for a fresh send and false on each disqualifier', () => {
    expect(isSendAvailable(send())).toBe(true);
    expect(isSendAvailable(send({ maxAccessCount: 1, accessCount: 1 }))).toBe(false);
    expect(isSendAvailable(send({ expirationDate: new Date(Date.now() - 1000).toISOString() }))).toBe(false);
    expect(isSendAvailable(send({ deletionDate: new Date(Date.now() - 1000).toISOString() }))).toBe(false);
    expect(isSendAvailable(send({ disabled: true }))).toBe(false);
  });
});

describe('send password', () => {
  it('hashes a plaintext password and verifies it (PBKDF2)', async () => {
    const s = send();
    await setSendPassword(s, 'correct horse');
    expect(s.authType).toBe(SendAuthType.Password);
    expect(s.passwordSalt).toBeTruthy();
    expect(await verifySendPassword(s, 'correct horse')).toBe(true);
    expect(await verifySendPassword(s, 'wrong')).toBe(false);
  });

  it('clears the password when set to null', async () => {
    const s = send({ authType: SendAuthType.Password });
    await setSendPassword(s, null);
    expect(s.passwordHash).toBeNull();
    expect(s.authType).toBe(SendAuthType.None);
    expect(await verifySendPassword(s, 'anything')).toBe(false);
  });

  it('stores a pre-hashed 32-byte b64 password directly and verifies via hashB64', async () => {
    const s = send();
    const hashB64 = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    await setSendPassword(s, hashB64);
    expect(s.passwordSalt).toBeNull();
    expect(s.passwordHash).toBe(hashB64);
    expect(verifySendPasswordHashB64(s, hashB64)).toBe(true);
    expect(verifySendPasswordHashB64(s, base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))))).toBe(false);
  });
});

describe('misc helpers', () => {
  it('validateDeletionDate flags dates too far out', () => {
    expect(validateDeletionDate(new Date(Date.now() + 5 * 86_400_000))).toBeNull();
    expect(validateDeletionDate(new Date(Date.now() + 400 * 86_400_000))).toBeInstanceOf(Response);
  });

  it('hasEmailAuth reflects the auth type', () => {
    expect(hasEmailAuth(send({ authType: SendAuthType.Email }))).toBe(true);
    expect(hasEmailAuth(send({ authType: SendAuthType.None }))).toBe(false);
  });

  it('getSafeJwtSecret gates weak secrets', () => {
    expect(getSafeJwtSecret({ JWT_SECRET: 'x'.repeat(48) } as Env)).toEqual({ ok: true, secret: 'x'.repeat(48) });
    expect(getSafeJwtSecret({ JWT_SECRET: 'short' } as Env).ok).toBe(false);
    expect(getSafeJwtSecret({} as Env).ok).toBe(false);
  });

  it('extractBearerToken parses the Authorization header', () => {
    const req = (auth?: string) => new Request('https://vault.test/', auth ? { headers: { Authorization: auth } } : undefined);
    expect(extractBearerToken(req('Bearer abc.def'))).toBe('abc.def');
    expect(extractBearerToken(req('Basic abc'))).toBeNull();
    expect(extractBearerToken(req())).toBeNull();
  });
});
