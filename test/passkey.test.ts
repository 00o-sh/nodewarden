import { describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  parseClientDataJSON,
  randomChallenge,
} from '../src/utils/passkey';

// Pure base64url + WebAuthn clientDataJSON helpers. Deterministic — real
// crypto and real TextEncoder/atob/btoa, no mocks.

describe('bytesToBase64Url', () => {
  it('encodes a known vector', () => {
    expect(bytesToBase64Url(new TextEncoder().encode('Man'))).toBe('TWFu');
  });

  it('encodes empty input to an empty string', () => {
    expect(bytesToBase64Url(new Uint8Array(0))).toBe('');
  });

  it('produces URL-safe output with no padding', () => {
    // 0xfb 0xff 0xbf base64-encodes to "+/+/", which must be rewritten.
    const out = bytesToBase64Url(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(out).not.toMatch(/[+/=]/);
    expect(out).toBe('-_-_');
  });
});

describe('base64UrlToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * 37) % 256));
    expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes)))).toEqual(Array.from(bytes));
  });

  it('decodes input that is missing padding', () => {
    expect(new TextDecoder().decode(base64UrlToBytes('TWFu'))).toBe('Man');
    // "Ma" -> two bytes, no padding supplied.
    expect(new TextDecoder().decode(base64UrlToBytes('TWE'))).toBe('Ma');
  });

  it('treats null/undefined/empty as empty bytes', () => {
    expect(base64UrlToBytes('').length).toBe(0);
    expect(base64UrlToBytes(undefined as unknown as string).length).toBe(0);
    expect(base64UrlToBytes(null as unknown as string).length).toBe(0);
  });
});

describe('randomChallenge', () => {
  it('returns a 32-byte challenge by default', () => {
    expect(base64UrlToBytes(randomChallenge()).length).toBe(32);
  });

  it('honours a custom size and is URL-safe', () => {
    const c = randomChallenge(16);
    expect(base64UrlToBytes(c).length).toBe(16);
    expect(c).not.toMatch(/[+/=]/);
  });

  it('produces unique values', () => {
    const set = new Set(Array.from({ length: 500 }, () => randomChallenge()));
    expect(set.size).toBe(500);
  });
});

describe('parseClientDataJSON', () => {
  function encode(value: unknown): string {
    return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  }

  it('parses a well-formed clientDataJSON object', () => {
    const parsed = parseClientDataJSON(
      encode({ type: 'webauthn.get', challenge: 'abc', origin: 'https://vault.test' })
    );
    expect(parsed).toEqual({ type: 'webauthn.get', challenge: 'abc', origin: 'https://vault.test' });
  });

  it('returns null on undecodable / invalid JSON', () => {
    expect(parseClientDataJSON(bytesToBase64Url(new TextEncoder().encode('{not json')))).toBeNull();
  });

  it('returns null when the decoded value is not an object', () => {
    expect(parseClientDataJSON(encode('a string'))).toBeNull();
    expect(parseClientDataJSON(encode(42))).toBeNull();
  });
});
