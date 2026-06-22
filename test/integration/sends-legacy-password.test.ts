import { describe, expect, it } from 'vitest';
import { SendAuthType } from '../../src/types';
import type { Send } from '../../src/types';
import {
  sendPasswordLockedOAuthResponse,
  validatePublicSendAccess,
  verifySendPassword,
  verifySendPasswordHashB64,
} from '../../src/handlers/sends-shared';

// Legacy send-password verification: older sends store only a base64url
// password hash (no PBKDF2 salt/iterations), so access compares the client's
// supplied hash directly. Exercised by constructing such sends and calling the
// exported helpers. Real constant-time comparison, no mocks.

// base64url of the byte sequence [1,2,3,4].
const HASH = 'AQIDBA';

function legacySend(overrides: Partial<Send> = {}): Send {
  return {
    passwordHash: HASH,
    passwordSalt: null,
    passwordIterations: null,
    authType: SendAuthType.None,
    ...overrides,
  } as unknown as Send;
}

describe('verifySendPasswordHashB64', () => {
  it('accepts a matching hash and rejects mismatches / empties', () => {
    const send = legacySend();
    expect(verifySendPasswordHashB64(send, HASH)).toBe(true);
    expect(verifySendPasswordHashB64(send, 'BBBBBB')).toBe(false);
    expect(verifySendPasswordHashB64(send, '')).toBe(false);
    expect(verifySendPasswordHashB64(legacySend({ passwordHash: null }), HASH)).toBe(false);
  });
});

describe('verifySendPassword (legacy hash path)', () => {
  it('falls back to the supplied-hash comparison when there is no salt', async () => {
    expect(await verifySendPassword(legacySend(), HASH)).toBe(true);
    expect(await verifySendPassword(legacySend(), 'wrong-hash')).toBe(false);
  });
});

describe('validatePublicSendAccess (legacy hash path)', () => {
  it('accepts a matching password_hash_b64', async () => {
    const result = await validatePublicSendAccess(legacySend(), { passwordHashB64: HASH });
    expect(result.ok).toBe(true);
  });

  it('accepts a matching password field', async () => {
    const result = await validatePublicSendAccess(legacySend(), { password: HASH });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing password with a 401 reason', async () => {
    const result = await validatePublicSendAccess(legacySend(), {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('password_missing');
  });

  it('rejects a wrong password with an invalid_password reason', async () => {
    const result = await validatePublicSendAccess(legacySend(), { passwordHashB64: 'BBBBBB' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_password');
  });
});

describe('sendPasswordLockedOAuthResponse', () => {
  it('builds a 429 OAuth-style lockout response', async () => {
    const res = sendPasswordLockedOAuthResponse(60);
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error).toBe('invalid_grant');
    expect(body.send_access_error_type).toBe('too_many_password_attempts');
  });
});
