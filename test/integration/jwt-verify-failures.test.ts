import { describe, expect, it } from 'vitest';
import {
  createAttachmentUploadToken,
  createFileDownloadToken,
  createJWT,
  createSendAccessToken,
  createSendFileDownloadToken,
  createSendFileUploadToken,
  verifyAttachmentUploadToken,
  verifyFileDownloadToken,
  verifyJWT,
  verifySendAccessToken,
  verifySendFileDownloadToken,
  verifySendFileUploadToken,
} from '../../src/utils/jwt';

// Failure paths of every JWT verifier: a structurally-valid token whose
// signature segment is not valid base64 forces the decode to throw (exercising
// each catch), a token signed with a different secret fails the HMAC check, and
// a wrong-purpose token trips the claim guards. Real HMAC crypto, no mocks.
const SECRET = `jwt-test-secret-${'x'.repeat(40)}`;
const OTHER = `jwt-other-secret-${'y'.repeat(40)}`;

// header.payload.<invalid base64> — base64UrlDecode(atob) throws on '@'.
const badSig = `${btoa('{}').replace(/=/g, '')}.${btoa('{}').replace(/=/g, '')}.@@@@`;

describe('jwt verifier failure paths', () => {
  it('verifyJWT returns null for a malformed signature and a wrong secret', async () => {
    expect(await verifyJWT(badSig, SECRET)).toBeNull();
    const token = await createJWT({ sub: 'u1', name: 'n', email: 'e', kdf: 0, kdfIterations: 1000 } as any, SECRET);
    expect(await verifyJWT(token, OTHER)).toBeNull();
  });

  it('verifyFileDownloadToken returns null for a malformed signature and a wrong secret', async () => {
    expect(await verifyFileDownloadToken(badSig, SECRET)).toBeNull();
    const token = await createFileDownloadToken('cipher1', 'att1', SECRET);
    expect(await verifyFileDownloadToken(token, OTHER)).toBeNull();
    // Sanity: the genuine token verifies under its own secret.
    expect(await verifyFileDownloadToken(token, SECRET)).not.toBeNull();
  });

  it('verifyAttachmentUploadToken returns null for a malformed signature and a wrong secret', async () => {
    expect(await verifyAttachmentUploadToken(badSig, SECRET)).toBeNull();
    const token = await createAttachmentUploadToken('u1', 'cipher1', 'att1', SECRET);
    expect(await verifyAttachmentUploadToken(token, OTHER)).toBeNull();
  });

  it('verifySendFileDownloadToken returns null for a malformed signature and missing claims', async () => {
    expect(await verifySendFileDownloadToken(badSig, SECRET)).toBeNull();
    // A correctly-signed token of the wrong shape (no jti) trips the claim guard.
    const wrongShape = await createSendFileUploadToken('u1', 'send1', 'file1', SECRET);
    expect(await verifySendFileDownloadToken(wrongShape, SECRET)).toBeNull();
  });

  it('verifySendFileUploadToken returns null for a malformed signature and a wrong secret', async () => {
    expect(await verifySendFileUploadToken(badSig, SECRET)).toBeNull();
    const token = await createSendFileUploadToken('u1', 'send1', 'file1', SECRET);
    expect(await verifySendFileUploadToken(token, OTHER)).toBeNull();
  });

  it('verifySendAccessToken returns null for a malformed signature and a wrong-purpose token', async () => {
    expect(await verifySendAccessToken(badSig, SECRET)).toBeNull();
    // A file-download token verifies its HMAC but lacks typ === 'send_access'.
    const wrongPurpose = await createSendFileDownloadToken('send1', 'file1', SECRET);
    expect(await verifySendAccessToken(wrongPurpose, SECRET)).toBeNull();
    // The genuine send-access token round-trips.
    const access = await createSendAccessToken('send1', SECRET);
    expect(await verifySendAccessToken(access, SECRET)).not.toBeNull();
  });
});
