import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import { bytesToBase64Url } from '../src/utils/passkey';
import {
  createPasskeyUserVerificationToken,
  verifyPasskeyUserVerificationToken,
} from '../src/utils/user-verification-token';

// The passkey user-verification token gates sensitive backup operations. It is
// an HMAC-SHA256 token (signed with JWT_SECRET) that must be tightly bound to a
// single user + purpose, must reject tampering and foreign signatures, and must
// expire. Generate the signing key at runtime so no literal secret is committed.
const SECRET = `test-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const PURPOSE = 'backup.settings.repair' as const;

function env(secret: string): Env {
  return { JWT_SECRET: secret } as unknown as Env;
}

// Sign a token exactly the way the implementation does, so we can forge an
// otherwise-valid token with a chosen (e.g. already-expired) expiry.
async function signToken(secret: string, payload: Record<string, unknown>): Promise<string> {
  const enc = (value: unknown) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))));
  return `${data}.${sig}`;
}

describe('passkey user-verification token', () => {
  it('round-trips a token bound to the issued user + purpose', async () => {
    const e = env(SECRET);
    const token = await createPasskeyUserVerificationToken(e, 'user-1', PURPOSE);
    expect(await verifyPasskeyUserVerificationToken(e, token, 'user-1', PURPOSE)).toBe(true);
  });

  it('rejects a token presented for a different user', async () => {
    const e = env(SECRET);
    const token = await createPasskeyUserVerificationToken(e, 'user-1', PURPOSE);
    expect(await verifyPasskeyUserVerificationToken(e, token, 'user-2', PURPOSE)).toBe(false);
  });

  it('rejects a token presented for a different purpose', async () => {
    const e = env(SECRET);
    const token = await createPasskeyUserVerificationToken(e, 'user-1', PURPOSE);
    expect(await verifyPasskeyUserVerificationToken(e, token, 'user-1', 'something.else' as typeof PURPOSE)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createPasskeyUserVerificationToken(env(SECRET), 'user-1', PURPOSE);
    expect(await verifyPasskeyUserVerificationToken(env(`other-${SECRET}`), token, 'user-1', PURPOSE)).toBe(false);
  });

  it('rejects a payload swapped onto another token signature (tamper)', async () => {
    const e = env(SECRET);
    const forUser1 = await createPasskeyUserVerificationToken(e, 'user-1', PURPOSE);
    const forUser2 = await createPasskeyUserVerificationToken(e, 'user-2', PURPOSE);
    // Splice user-2's payload onto user-1's header+signature: the HMAC no longer
    // covers the payload, so verification must fail for either claimed user.
    const forged = `${forUser1.split('.')[0]}.${forUser2.split('.')[1]}.${forUser1.split('.')[2]}`;
    expect(await verifyPasskeyUserVerificationToken(e, forged, 'user-2', PURPOSE)).toBe(false);
    expect(await verifyPasskeyUserVerificationToken(e, forged, 'user-1', PURPOSE)).toBe(false);
  });

  it('rejects an expired token even when correctly signed', async () => {
    const e = env(SECRET);
    const past = Date.now() - 60_000;
    const expired = await signToken(SECRET, {
      typ: 'nodewarden.user-verification.v1',
      userId: 'user-1',
      method: 'passkey',
      purpose: PURPOSE,
      iat: past - 60_000,
      exp: past,
    });
    expect(await verifyPasskeyUserVerificationToken(e, expired, 'user-1', PURPOSE)).toBe(false);
  });

  it('rejects malformed tokens', async () => {
    const e = env(SECRET);
    for (const token of ['', 'a', 'a.b', 'a.b.c.d', 'not.a.token']) {
      expect(await verifyPasskeyUserVerificationToken(e, token, 'user-1', PURPOSE)).toBe(false);
    }
  });
});
