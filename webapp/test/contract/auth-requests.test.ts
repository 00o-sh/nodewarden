import { beforeAll, describe, expect, it } from 'vitest';
import {
  encryptSessionUserKeyForAuthRequest,
  getFingerprintPhrase,
  isPendingAuthRequest,
  listPendingAuthRequests,
  respondToAuthRequest,
} from '@/lib/api/auth-requests';
import { bytesToBase64 } from '@/lib/crypto';
import { EFFLongWordList } from '@/lib/fingerprint-wordlist';
import type { AuthRequest } from '@/lib/types';
import { type ContractSession, registerAndLogin } from './helpers';

// Auth-request flows exercised through the real webapp api client. Pure logic
// (isPendingAuthRequest) and crypto (getFingerprintPhrase,
// encryptSessionUserKeyForAuthRequest) run directly; listPendingAuthRequests
// is driven against the real worker.

let ctx: ContractSession;

beforeAll(async () => {
  ctx = await registerAndLogin('authreq');
});

function fabricateAuthRequest(over: Partial<AuthRequest> = {}): AuthRequest {
  return {
    id: crypto.randomUUID(),
    publicKey: '',
    requestDeviceIdentifier: crypto.randomUUID(),
    creationDate: new Date().toISOString(),
    requestApproved: null,
    responseDate: null,
    ...over,
  };
}

// Generate an RSA-OAEP keypair and return the SPKI public key as base64, which
// is exactly what normalizeAuthRequest stores in AuthRequest.publicKey and what
// encryptSessionUserKeyForAuthRequest imports via crypto.subtle.importKey('spki', ...).
async function generateSpkiPublicKeyBase64(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
    true,
    ['encrypt', 'decrypt']
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return bytesToBase64(spki);
}

describe('isPendingAuthRequest (pure)', () => {
  it('is true for a freshly created, unresponded request', () => {
    expect(isPendingAuthRequest(fabricateAuthRequest())).toBe(true);
  });

  it('is false when the request has a responseDate (responded/approved)', () => {
    expect(
      isPendingAuthRequest(
        fabricateAuthRequest({ responseDate: new Date().toISOString(), requestApproved: true })
      )
    ).toBe(false);
  });

  it('is false when the request was responded to but not approved', () => {
    expect(
      isPendingAuthRequest(
        fabricateAuthRequest({ responseDate: new Date().toISOString(), requestApproved: false })
      )
    ).toBe(false);
  });

  it('is false when the request is older than the 15-minute expiry window', () => {
    const old = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    expect(isPendingAuthRequest(fabricateAuthRequest({ creationDate: old }))).toBe(false);
  });

  it('is true for a request created just inside the 15-minute window', () => {
    const recent = new Date(Date.now() - 14 * 60 * 1000).toISOString();
    expect(isPendingAuthRequest(fabricateAuthRequest({ creationDate: recent }))).toBe(true);
  });

  it('is false when id or creationDate is missing', () => {
    expect(isPendingAuthRequest(fabricateAuthRequest({ id: '' }))).toBe(false);
    expect(isPendingAuthRequest(fabricateAuthRequest({ creationDate: '' }))).toBe(false);
  });

  it('is true (treated as non-expired) when creationDate is unparseable', () => {
    // Non-finite parsed time short-circuits to pending=true in the source.
    expect(isPendingAuthRequest(fabricateAuthRequest({ creationDate: 'not-a-date' }))).toBe(true);
  });
});

describe('getFingerprintPhrase (crypto)', () => {
  const email = 'fingerprint@vault.test';
  const publicKey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it('is deterministic for the same email + public key', async () => {
    const a = await getFingerprintPhrase(email, publicKey);
    const b = await getFingerprintPhrase(email, publicKey);
    expect(a).toBe(b);
  });

  it('produces hyphen-separated words drawn from the EFF long wordlist', async () => {
    const phrase = await getFingerprintPhrase(email, publicKey);
    const words = phrase.split('-');
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) {
      expect(EFFLongWordList).toContain(word);
    }
  });

  it('differs for a different email', async () => {
    const a = await getFingerprintPhrase(email, publicKey);
    const b = await getFingerprintPhrase('other@vault.test', publicKey);
    expect(a).not.toBe(b);
  });

  it('differs for a different public key', async () => {
    const a = await getFingerprintPhrase(email, publicKey);
    const b = await getFingerprintPhrase(email, new Uint8Array([9, 9, 9, 9]));
    expect(a).not.toBe(b);
  });

  it('is case-insensitive on the email', async () => {
    const a = await getFingerprintPhrase('Mixed@Vault.Test', publicKey);
    const b = await getFingerprintPhrase('mixed@vault.test', publicKey);
    expect(a).toBe(b);
  });
});

describe('encryptSessionUserKeyForAuthRequest (crypto)', () => {
  it('returns a non-empty type-4 encrypted user key for a valid RSA public key', async () => {
    const publicKey = await generateSpkiPublicKeyBase64();
    const result = await encryptSessionUserKeyForAuthRequest(
      ctx.session,
      fabricateAuthRequest({ publicKey })
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Source prefixes the RSA-OAEP ciphertext with the "4." EncString type tag.
    expect(result.startsWith('4.')).toBe(true);
    expect(result.slice(2).length).toBeGreaterThan(0);
  });

  it('throws when the auth request has no public key', async () => {
    await expect(
      encryptSessionUserKeyForAuthRequest(ctx.session, fabricateAuthRequest({ publicKey: '' }))
    ).rejects.toThrow();
  });

  it('throws when the session is missing its symmetric vault keys', async () => {
    const publicKey = await generateSpkiPublicKeyBase64();
    const lockedSession = { ...ctx.session, symEncKey: undefined, symMacKey: undefined };
    await expect(
      encryptSessionUserKeyForAuthRequest(lockedSession, fabricateAuthRequest({ publicKey }))
    ).rejects.toThrow();
  });
});

describe('listPendingAuthRequests (real worker)', () => {
  it('returns an empty list for a fresh account with no pending requests', async () => {
    const pending = await listPendingAuthRequests(ctx.authedFetch, ctx.email);
    expect(Array.isArray(pending)).toBe(true);
    expect(pending).toHaveLength(0);
  });
});

describe('respondToAuthRequest (real worker)', () => {
  // A genuinely *pending* auth request can only be created by a second device
  // initiating device-login (POST /api/auth-requests from an unauthenticated
  // device), which this single-session harness cannot produce. We therefore
  // exercise only the reachable failure path: responding to a non-existent
  // request id, which must surface the worker's error (resp.ok === false).
  it('rejects when responding to a non-existent request id', async () => {
    await expect(
      respondToAuthRequest(ctx.authedFetch, crypto.randomUUID(), {
        key: null,
        masterPasswordHash: null,
        deviceIdentifier: crypto.randomUUID(),
        requestApproved: false,
      })
    ).rejects.toThrow();
  });
});
