import { describe, expect, it } from 'vitest';
import {
  fromAccessId,
  isSendAvailable,
  parseMaxAccessCount,
  setSendPassword,
  validateDeletionDate,
  validatePublicSendAccess,
  verifySendPassword,
} from '../../src/handlers/sends-shared';
import { type Send, SendAuthType, SendType } from '../../src/types';

// These functions enforce who can access a Send and when. They live in a module
// that imports cloudflare:workers, so they run in the workers project even
// though the functions themselves are pure.
// Generate test passwords at runtime so static scanners don't treat them as
// committed credentials. Within a test, set and verify with the same value.
function pw(): string {
  return `pw-${crypto.randomUUID()}`;
}

function makeSend(overrides: Partial<Send> = {}): Send {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    type: SendType.Text,
    name: 'name',
    notes: null,
    key: 'key',
    data: '{}',
    passwordHash: null,
    passwordSalt: null,
    passwordIterations: null,
    maxAccessCount: null,
    accessCount: 0,
    expirationDate: null,
    deletionDate: new Date(now + 7 * 86_400_000).toISOString(),
    disabled: false,
    hideEmail: false,
    authType: SendAuthType.None,
    emails: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    ...overrides,
  } as Send;
}

describe('isSendAvailable', () => {
  it('is true for a fresh, enabled, unexpired send', () => {
    expect(isSendAvailable(makeSend())).toBe(true);
  });

  it('is false once the access count is exhausted', () => {
    expect(isSendAvailable(makeSend({ maxAccessCount: 3, accessCount: 3 }))).toBe(false);
    expect(isSendAvailable(makeSend({ maxAccessCount: 3, accessCount: 2 }))).toBe(true);
  });

  it('is false past the expiration or deletion date', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isSendAvailable(makeSend({ expirationDate: past }))).toBe(false);
    expect(isSendAvailable(makeSend({ deletionDate: past }))).toBe(false);
  });

  it('is false when disabled', () => {
    expect(isSendAvailable(makeSend({ disabled: true }))).toBe(false);
  });
});

describe('send password set/verify', () => {
  it('round-trips a password and rejects the wrong one', async () => {
    const send = makeSend();
    const password = pw();
    await setSendPassword(send, password);
    expect(send.passwordHash).toBeTruthy();
    expect(send.authType).toBe(SendAuthType.Password);

    expect(await verifySendPassword(send, password)).toBe(true);
    expect(await verifySendPassword(send, pw())).toBe(false);
  });

  it('clears the password when set to null', async () => {
    const send = makeSend();
    await setSendPassword(send, pw());
    await setSendPassword(send, null);
    expect(send.passwordHash).toBeNull();
    expect(send.authType).toBe(SendAuthType.None);
  });
});

describe('validatePublicSendAccess', () => {
  it('allows access to a send with no password', async () => {
    expect((await validatePublicSendAccess(makeSend(), {})).ok).toBe(true);
  });

  it('requires the correct password', async () => {
    const send = makeSend();
    const password = pw();
    await setSendPassword(send, password);

    expect((await validatePublicSendAccess(send, {})).reason).toBe('password_missing');
    expect((await validatePublicSendAccess(send, { password: pw() })).reason).toBe('invalid_password');
    expect((await validatePublicSendAccess(send, { password })).ok).toBe(true);
  });

  it('refuses email-auth sends (unsupported on this server)', async () => {
    const result = await validatePublicSendAccess(makeSend({ authType: SendAuthType.Email }), {});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('email_auth_unsupported');
  });
});

describe('validateDeletionDate', () => {
  it('accepts a date within the allowed window', () => {
    expect(validateDeletionDate(new Date(Date.now() + 5 * 86_400_000))).toBeNull();
  });

  it('rejects a date too far in the future', () => {
    const res = validateDeletionDate(new Date(Date.now() + 60 * 86_400_000));
    expect(res?.status).toBe(400);
  });
});

describe('parseMaxAccessCount', () => {
  it('treats empty as unlimited (null) and parses valid counts', () => {
    expect(parseMaxAccessCount(undefined)).toEqual({ ok: true, value: null });
    expect(parseMaxAccessCount('')).toEqual({ ok: true, value: null });
    expect(parseMaxAccessCount(5)).toEqual({ ok: true, value: 5 });
  });

  it('rejects negative counts', () => {
    const res = parseMaxAccessCount(-1);
    expect(res.ok).toBe(false);
  });
});

describe('fromAccessId', () => {
  function uuidToAccessId(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    let binary = '';
    for (let i = 0; i < 16; i++) binary += String.fromCharCode(parseInt(hex.substr(i * 2, 2), 16));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  it('round-trips a uuid <-> access id', () => {
    const uuid = crypto.randomUUID();
    expect(fromAccessId(uuidToAccessId(uuid))).toBe(uuid);
  });

  it('returns null for malformed access ids', () => {
    expect(fromAccessId('too-short')).toBeNull();
    expect(fromAccessId('')).toBeNull();
  });
});
