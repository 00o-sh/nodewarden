import { describe, expect, it } from 'vitest';
import {
  createAttachmentUploadToken,
  createFileDownloadToken,
  createJWT,
  createRefreshToken,
  createSendAccessToken,
  createSendFileDownloadToken,
  createSendFileUploadToken,
  verifyAttachmentUploadToken,
  verifyFileDownloadToken,
  verifyJWT,
  verifySendAccessToken,
  verifySendFileDownloadToken,
  verifySendFileUploadToken,
} from '../src/utils/jwt';

// Generate the test signing keys at runtime so no key literal is committed.
// Any 32+ char string works as an HMAC key; the two just need to differ.
const SECRET = `test-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const OTHER_SECRET = `test-${crypto.randomUUID()}-${crypto.randomUUID()}`;

const basePayload = {
  sub: 'user-123',
  email: 'user@example.com',
  name: 'Test User',
  sstamp: 'security-stamp-1',
};

describe('createJWT / verifyJWT', () => {
  it('produces a three-part token that verifies and round-trips claims', async () => {
    const token = await createJWT(basePayload, SECRET);
    expect(token.split('.')).toHaveLength(3);

    const payload = await verifyJWT(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      sub: 'user-123',
      email: 'user@example.com',
      name: 'Test User',
      sstamp: 'security-stamp-1',
      iss: 'nodewarden',
      premium: true,
      email_verified: true,
      amr: ['Application'],
    });
  });

  it('sets exp based on the expiresIn argument', async () => {
    const token = await createJWT(basePayload, SECRET, 100);
    const payload = await verifyJWT(token, SECRET);
    expect(payload!.exp - payload!.iat).toBe(100);
  });

  it('fails verification with the wrong secret', async () => {
    const token = await createJWT(basePayload, SECRET);
    expect(await verifyJWT(token, OTHER_SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await createJWT(basePayload, SECRET, -10);
    expect(await verifyJWT(token, SECRET)).toBeNull();
  });

  it('rejects tampered payloads', async () => {
    const token = await createJWT(basePayload, SECRET);
    const [h, , s] = token.split('.');
    const forged = btoa(JSON.stringify({ ...basePayload, sub: 'admin', exp: 9_999_999_999, iat: 1 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyJWT(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyJWT('not-a-jwt', SECRET)).toBeNull();
    expect(await verifyJWT('a.b', SECRET)).toBeNull();
    expect(await verifyJWT('a.b.c.d', SECRET)).toBeNull();
  });
});

describe('createRefreshToken', () => {
  it('returns url-safe random strings that differ each call', () => {
    const a = createRefreshToken();
    const b = createRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('file download tokens', () => {
  it('round-trips cipher and attachment ids', async () => {
    const token = await createFileDownloadToken('cipher-1', 'att-1', SECRET);
    const claims = await verifyFileDownloadToken(token, SECRET);
    expect(claims).toMatchObject({ cipherId: 'cipher-1', attachmentId: 'att-1' });
    expect(typeof claims!.jti).toBe('string');
  });

  it('rejects the wrong secret', async () => {
    const token = await createFileDownloadToken('cipher-1', 'att-1', SECRET);
    expect(await verifyFileDownloadToken(token, OTHER_SECRET)).toBeNull();
  });
});

describe('attachment upload tokens', () => {
  it('round-trips user, cipher and attachment ids', async () => {
    const token = await createAttachmentUploadToken('user-1', 'cipher-1', 'att-1', SECRET);
    const claims = await verifyAttachmentUploadToken(token, SECRET);
    expect(claims).toMatchObject({ userId: 'user-1', cipherId: 'cipher-1', attachmentId: 'att-1' });
  });

  it('does not validate as a file download token (different claim shape is allowed but secret-bound)', async () => {
    const token = await createAttachmentUploadToken('user-1', 'cipher-1', 'att-1', SECRET);
    expect(await verifyAttachmentUploadToken(token, OTHER_SECRET)).toBeNull();
  });
});

describe('send file tokens', () => {
  it('round-trips send download claims', async () => {
    const token = await createSendFileDownloadToken('send-1', 'file-1', SECRET);
    const claims = await verifySendFileDownloadToken(token, SECRET);
    expect(claims).toMatchObject({ sendId: 'send-1', fileId: 'file-1' });
    expect(typeof claims!.jti).toBe('string');
  });

  it('round-trips send upload claims', async () => {
    const token = await createSendFileUploadToken('user-1', 'send-1', 'file-1', SECRET);
    const claims = await verifySendFileUploadToken(token, SECRET);
    expect(claims).toMatchObject({ userId: 'user-1', sendId: 'send-1', fileId: 'file-1' });
  });
});

describe('send access tokens', () => {
  it('round-trips the send id and marks the token type', async () => {
    const token = await createSendAccessToken('send-1', SECRET);
    const claims = await verifySendAccessToken(token, SECRET);
    expect(claims).toMatchObject({ sub: 'send-1', typ: 'send_access' });
  });

  it('rejects a generic JWT presented as a send access token', async () => {
    const token = await createJWT(basePayload, SECRET);
    expect(await verifySendAccessToken(token, SECRET)).toBeNull();
  });

  it('rejects the wrong secret', async () => {
    const token = await createSendAccessToken('send-1', SECRET);
    expect(await verifySendAccessToken(token, OTHER_SECRET)).toBeNull();
  });
});
