import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSshKey } from '@/lib/ssh-key-generator';

// jsdom delegates to Node WebCrypto, which supports Ed25519 + RSA keygen, so the
// generator runs for real. Keys are random, so we assert format/shape invariants
// (never exact bytes). RSA uses 2048 bits to stay fast.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateSshKey - Ed25519', () => {
  it('returns a well-formed OpenSSH ed25519 keypair and fingerprint', async () => {
    const key = await generateSshKey({ type: 'ed25519', rsaLength: 4096, comment: '' });
    expect(key.type).toBe('ED25519');
    expect(key.bits).toBe(256);
    expect(key.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+$/);
    expect(key.privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
    expect(key.privateKey.trimEnd().endsWith('-----END OPENSSH PRIVATE KEY-----')).toBe(true);
    // SHA256 fingerprint, base64 with the padding stripped.
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(key.fingerprint.endsWith('=')).toBe(false);
  });

  it('appends a non-empty comment to the public key line', async () => {
    const key = await generateSshKey({ type: 'ed25519', rsaLength: 4096, comment: 'me@host' });
    expect(key.publicKey.endsWith(' me@host')).toBe(true);
    expect(key.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ me@host$/);
  });

  it('collapses newlines in the comment so none leak into the public key line', async () => {
    const key = await generateSshKey({ type: 'ed25519', rsaLength: 4096, comment: 'line1\nline2' });
    expect(key.publicKey.split('\n')).toHaveLength(1);
    expect(key.publicKey.endsWith(' line1 line2')).toBe(true);
  });

  it('produces a distinct keypair on each call', async () => {
    const a = await generateSshKey({ type: 'ed25519', rsaLength: 4096, comment: '' });
    const b = await generateSshKey({ type: 'ed25519', rsaLength: 4096, comment: '' });
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe('generateSshKey - RSA', () => {
  it('returns an ssh-rsa keypair at the requested modulus length', async () => {
    const key = await generateSshKey({ type: 'rsa', rsaLength: 2048, comment: 'svc' });
    expect(key.type).toBe('RSA');
    expect(key.bits).toBe(2048);
    expect(key.publicKey).toMatch(/^ssh-rsa [A-Za-z0-9+/=]+ svc$/);
    expect(key.privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
  });
});

describe('generateSshKey - error handling', () => {
  it('throws when Web Crypto is unavailable', async () => {
    // Remove subtle so the availability guard trips.
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    await expect(generateSshKey({ type: 'ed25519', rsaLength: 4096, comment: '' })).rejects.toThrow(
      /Web Crypto is unavailable/
    );
  });
});
