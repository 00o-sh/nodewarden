import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders } from './helpers';
import { handleUploadAttachment } from '../../src/handlers/attachments';
import { handleUploadSendFile } from '../../src/handlers/sends-private';

// The "storage not configured" 500 branches are only reachable when no blob
// backend is bound. Rather than fabricate a failure, we run the REAL handlers
// against the real D1 but with the R2/KV bindings genuinely absent, so
// putBlobObject throws its real "not configured" error. The cipher/send rows
// are created through the normal API first (shared D1), then the handler is
// invoked directly with the stripped env.
let session: Session;
let token: string;
let userId: string;
let cipherId: string;
let attachmentId: string;
let fileSendId: string;
let fileId: string;

const noBlobEnv = { ...(env as any), ATTACHMENTS: undefined, ATTACHMENTS_KV: undefined } as any;

beforeAll(async () => {
  session = await authenticate('storagenotconfigured');
  token = session.accessToken;
  userId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;

  const cipher = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any;
  cipherId = cipher.id;
  const reserve = (await (await api('POST', `/api/ciphers/${cipherId}/attachment/v2`, token, {
    fileName: ENC_STRING, key: ENC_STRING, fileSize: 8,
  })).json()) as any;
  attachmentId = reserve.attachmentId;

  const sendReserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1, name: ENC_STRING, key: ENC_STRING, fileLength: 8,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: ENC_STRING, size: 8 },
  })).json()) as any;
  fileSendId = sendReserve.sendResponse.id;
  fileId = new URL(sendReserve.url).pathname.split('/file/')[1];
});

function uploadRequest(path: string): Request {
  return new Request(`https://vault.test${path}`, {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: new Uint8Array(8),
  });
}

describe('blob storage not configured', () => {
  it('500s an attachment upload when no blob backend is bound', async () => {
    const res = await handleUploadAttachment(
      uploadRequest(`/api/ciphers/${cipherId}/attachment/${attachmentId}`),
      noBlobEnv,
      userId,
      cipherId,
      attachmentId
    );
    expect(res.status).toBe(500);
  });

  it('500s a send file upload when no blob backend is bound', async () => {
    const res = await handleUploadSendFile(
      uploadRequest(`/api/sends/${fileSendId}/file/${fileId}`),
      noBlobEnv,
      userId,
      fileSendId,
      fileId
    );
    expect(res.status).toBe(500);
  });

  // Sanity: with the real bindings, the same uploads succeed (no mocked happy path).
  it('succeeds against the real blob backend', async () => {
    const ok = await SELF.fetch(`https://vault.test/api/ciphers/${cipherId}/attachment/${attachmentId}`, {
      method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: new Uint8Array(8),
    });
    expect(ok.status).toBe(201);
  });
});
