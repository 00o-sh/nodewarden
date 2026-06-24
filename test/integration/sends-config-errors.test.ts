import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';
import { handleAccessSendFile, handleDownloadSendFile } from '../../src/handlers/sends-public';
import { handleGetSendFileUpload } from '../../src/handlers/sends-private';

// More 'server configuration error' (500) branches: the REAL send handlers are
// invoked against an env whose JWT_SECRET is genuinely empty. handleAccessSendFile
// and handleDownloadSendFile check up front (no fixtures), while
// handleGetSendFileUpload reaches its check only for a real file send. No mocks.
let session: Session;
let token: string;
let userId: string;
let sendId: string;
let fileId: string;

const noJwtEnv = { ...(env as any), JWT_SECRET: '' } as any;
const uuid = () => crypto.randomUUID();
const req = (path: string) => new Request(`https://vault.test${path}`, { method: 'POST' });

beforeAll(async () => {
  session = await authenticate('sendsconfigerr');
  token = session.accessToken;
  userId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;
  const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1, name: ENC_STRING, key: ENC_STRING, fileLength: 8,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: ENC_STRING, size: 8 },
  })).json()) as any;
  sendId = reserve.sendResponse.id;
  fileId = new URL(reserve.url).pathname.split('/file/')[1];
});

describe('send handlers with an unusable JWT secret', () => {
  it('500s public send-file access', async () => {
    expect((await handleAccessSendFile(req(`/api/sends/${uuid()}/access/file/${uuid()}`), noJwtEnv, uuid(), uuid())).status).toBe(500);
  });

  it('500s authenticated send-file download', async () => {
    expect((await handleDownloadSendFile(req(`/api/sends/${uuid()}/${uuid()}`), noJwtEnv, uuid(), uuid())).status).toBe(500);
  });

  it('500s the reserved send-file upload-url reissue', async () => {
    const res = await handleGetSendFileUpload(req(`/api/sends/${sendId}/file/${fileId}`), noJwtEnv, userId, sendId, fileId);
    expect(res.status).toBe(500);
  });
});
