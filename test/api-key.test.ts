import { describe, expect, it } from 'vitest';
import {
  constantTimeEquals,
  hashApiKey,
  isStoredApiKeyHash,
  verifyApiKey,
} from '../src/utils/api-key';

// Pure crypto helpers for API-key storage: SHA-256 hashing with a stable
// prefix, a length-safe constant-time compare, and the verify gate. No bindings.

describe('constantTimeEquals', () => {
  it('is true for identical strings and false for differing ones', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });

  it('is false when the lengths differ (short-circuit branch)', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('', 'x')).toBe(false);
  });
});

describe('isStoredApiKeyHash', () => {
  it('recognises the sha256: prefix and rejects anything else', () => {
    expect(isStoredApiKeyHash('sha256:deadbeef')).toBe(true);
    expect(isStoredApiKeyHash('plain-value')).toBe(false);
    expect(isStoredApiKeyHash('')).toBe(false);
    expect(isStoredApiKeyHash(null)).toBe(false);
    expect(isStoredApiKeyHash(undefined)).toBe(false);
  });
});

describe('hashApiKey', () => {
  it('produces a stable prefixed lowercase hex digest', async () => {
    const hash = await hashApiKey('my-api-key');
    expect(hash.startsWith('sha256:')).toBe(true);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Deterministic for the same input.
    expect(await hashApiKey('my-api-key')).toBe(hash);
  });
});

describe('verifyApiKey', () => {
  it('verifies a key against its own hash', async () => {
    const stored = await hashApiKey('secret-key');
    expect(await verifyApiKey('secret-key', stored)).toBe(true);
    expect(await verifyApiKey('wrong-key', stored)).toBe(false);
  });

  it('returns false when the stored value is not a hash', async () => {
    expect(await verifyApiKey('secret-key', 'not-a-hash')).toBe(false);
    expect(await verifyApiKey('secret-key', '')).toBe(false);
    expect(await verifyApiKey('secret-key', null)).toBe(false);
  });
});
