import { describe, expect, it } from 'vitest';
import { Env } from '../src/types';
import type { AccountPasskeyCredential } from '../src/types';
import {
  accountPasskeyCredentialToResponse,
  accountPasskeyPrfStatus,
  accountPasskeyTokenTtlMs,
  buildWebAuthnPrfOption,
  createAccountPasskeyToken,
  getAccountPasskeyRpConfig,
  isSerializedEncString,
  normalizeAccountPasskeyName,
  normalizeAuthenticationResponse,
  normalizeRegistrationResponse,
  normalizeTransports,
  sha256Base64Url,
  toSimpleWebAuthnCredential,
  userHandleToUserId,
  userIdToWebAuthnUserId,
  verifyAccountPasskeyToken,
} from '../src/utils/account-passkeys';
import { bytesToBase64Url } from '../src/utils/passkey';

// Pure account-passkey helpers exercised with real WebCrypto (HMAC/SHA-256) and
// real Request objects — no mocks.
const env = (overrides: Record<string, unknown> = {}) =>
  ({ JWT_SECRET: 'a'.repeat(48), ...overrides } as unknown as Env);

function credential(overrides: Partial<AccountPasskeyCredential> = {}): AccountPasskeyCredential {
  return {
    id: 'cred-1',
    userId: 'user-1',
    name: 'My passkey',
    credentialId: bytesToBase64Url(new Uint8Array([1, 2, 3, 4])),
    publicKey: bytesToBase64Url(new Uint8Array([9, 9, 9])),
    counter: 0,
    transports: ['internal'],
    supportsPrf: false,
    encryptedUserKey: null,
    encryptedPublicKey: null,
    encryptedPrivateKey: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  } as AccountPasskeyCredential;
}

describe('account passkey token', () => {
  it('uses a shorter TTL for credential creation', () => {
    expect(accountPasskeyTokenTtlMs('CreateCredential')).toBeLessThan(accountPasskeyTokenTtlMs('AssertCredential' as any));
  });

  it('round-trips a signed token and validates it', async () => {
    const token = await createAccountPasskeyToken(env(), { scope: 'CreateCredential', challenge: 'abc', userId: 'u1', rpId: 'vault.test' });
    const payload = await verifyAccountPasskeyToken(env(), token, 'CreateCredential');
    expect(payload).toBeTruthy();
    expect(payload!.challenge).toBe('abc');
    expect(payload!.userId).toBe('u1');
  });

  it('rejects a wrong scope, a tampered signature, a bad secret, and expiry', async () => {
    const token = await createAccountPasskeyToken(env(), { scope: 'CreateCredential', challenge: 'abc', userId: null, rpId: 'vault.test' });
    expect(await verifyAccountPasskeyToken(env(), token, 'AssertCredential' as any)).toBeNull();
    expect(await verifyAccountPasskeyToken(env(), `${token}x`, 'CreateCredential')).toBeNull();
    expect(await verifyAccountPasskeyToken(env({ JWT_SECRET: 'b'.repeat(48) }), token, 'CreateCredential')).toBeNull();
    expect(await verifyAccountPasskeyToken(env(), 'only.two', 'CreateCredential')).toBeNull();

    const expired = await createAccountPasskeyToken(env(), { scope: 'CreateCredential', challenge: 'abc', userId: null, rpId: 'vault.test', ttlMs: -1000 });
    expect(await verifyAccountPasskeyToken(env(), expired, 'CreateCredential')).toBeNull();
  });

  it('hashes a value to base64url', async () => {
    const a = await sha256Base64Url('hello');
    expect(a).toBe(await sha256Base64Url('hello'));
    expect(a).not.toMatch(/[+/=]/);
  });
});

describe('rp config', () => {
  const req = (origin?: string) =>
    new Request('https://vault.test/api/x', origin ? { headers: { Origin: origin } } : undefined);

  it('defaults rpId to the hostname and rpName to NodeWarden', () => {
    const cfg = getAccountPasskeyRpConfig(req(), env());
    expect(cfg.rpId).toBe('vault.test');
    expect(cfg.rpName).toBe('NodeWarden');
    expect(cfg.origins).toContain('https://vault.test');
  });

  it('honours configured rpId/name/origins and adds extension origins', () => {
    const cfg = getAccountPasskeyRpConfig(req('chrome-extension://abcd'), env({
      WEBAUTHN_RP_ID: 'custom.example',
      WEBAUTHN_RP_NAME: 'Custom',
      WEBAUTHN_ALLOWED_ORIGINS: 'https://a.test, https://b.test',
    }));
    expect(cfg.rpId).toBe('custom.example');
    expect(cfg.rpName).toBe('Custom');
    expect(cfg.origins).toEqual(expect.arrayContaining(['https://a.test', 'https://b.test', 'chrome-extension://abcd']));
  });

  it('ignores a non-extension Origin header', () => {
    const cfg = getAccountPasskeyRpConfig(req('https://evil.test'), env());
    expect(cfg.origins).not.toContain('https://evil.test');
  });
});

describe('user handle round-trip', () => {
  it('encodes and decodes a user id', () => {
    const handle = bytesToBase64Url(userIdToWebAuthnUserId('user-123'));
    expect(userHandleToUserId(handle)).toBe('user-123');
    expect(userHandleToUserId(undefined)).toBeNull();
  });
});

describe('prf status and responses', () => {
  it('reports prf status across the three states', () => {
    expect(accountPasskeyPrfStatus(credential({ supportsPrf: false }))).toBe(2);
    expect(accountPasskeyPrfStatus(credential({ supportsPrf: true }))).toBe(1);
    expect(accountPasskeyPrfStatus(credential({
      supportsPrf: true, encryptedUserKey: '2.a|b|c', encryptedPublicKey: '4.x', encryptedPrivateKey: '2.d|e|f',
    }))).toBe(0);
  });

  it('builds a prf option only for a fully-provisioned credential', () => {
    expect(buildWebAuthnPrfOption(credential({ supportsPrf: true }))).toBeNull();
    const opt = buildWebAuthnPrfOption(credential({
      supportsPrf: true, encryptedUserKey: '2.a|b|c', encryptedPublicKey: '4.x', encryptedPrivateKey: '2.d|e|f',
    }));
    expect(opt).toBeTruthy();
    expect(opt!.Object).toBe('webAuthnPrfDecryptionOption');
  });

  it('serializes a credential and maps to a SimpleWebAuthn credential', () => {
    const res = accountPasskeyCredentialToResponse(credential());
    expect(res.Object).toBe('webauthnCredential');
    expect(res.PrfStatus).toBe(2);
    const swa = toSimpleWebAuthnCredential(credential());
    expect(swa.id).toBe(credential().credentialId);
    expect(swa.counter).toBe(0);
  });
});

describe('response normalization', () => {
  const baseReg = {
    id: 'id', rawId: 'rawId',
    response: { clientDataJSON: 'cdj', attestationObject: 'att' },
  };
  const baseAuth = {
    id: 'id', rawId: 'rawId',
    response: { clientDataJSON: 'cdj', authenticatorData: 'ad', signature: 'sig' },
  };

  it('normalizes a valid registration response and rejects malformed ones', () => {
    expect(normalizeRegistrationResponse(baseReg)).toBeTruthy();
    expect(normalizeRegistrationResponse(null)).toBeNull();
    expect(normalizeRegistrationResponse({ id: 'x' })).toBeNull();
    expect(normalizeRegistrationResponse({ ...baseReg, response: { clientDataJSON: 'cdj' } })).toBeNull();
  });

  it('normalizes a valid authentication response and rejects malformed ones', () => {
    expect(normalizeAuthenticationResponse(baseAuth)).toBeTruthy();
    expect(normalizeAuthenticationResponse(null)).toBeNull();
    expect(normalizeAuthenticationResponse({ ...baseAuth, response: { clientDataJSON: 'cdj' } })).toBeNull();
  });
});

describe('small normalizers', () => {
  it('normalizes a passkey name with a default and length cap', () => {
    expect(normalizeAccountPasskeyName('  ')).toBe('Account passkey');
    expect(normalizeAccountPasskeyName('Phone')).toBe('Phone');
    expect(normalizeAccountPasskeyName('x'.repeat(200)).length).toBe(128);
  });

  it('normalizes transports', () => {
    expect(normalizeTransports('nope')).toBeNull();
    expect(normalizeTransports([])).toBeNull();
    expect(normalizeTransports(['usb', '', ' nfc '])).toEqual(['usb', 'nfc']);
  });

  it('recognizes serialized enc-strings by type', () => {
    expect(isSerializedEncString('2.a|b|c')).toBe(true);
    expect(isSerializedEncString('3.x')).toBe(true);
    expect(isSerializedEncString('5.a|b')).toBe(true);
    expect(isSerializedEncString('2.a|b')).toBe(false); // type 2 needs 3 parts
    expect(isSerializedEncString('7.a')).toBe(false); // unknown type
    expect(isSerializedEncString('')).toBe(false);
    expect(isSerializedEncString('noformat')).toBe(false);
  });
});
