import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleAccessSendV2, handleAccessSendFileV2 } from '../../src/handlers/sends-public';
import { handlePublicUploadSendFile } from '../../src/handlers/sends-private';
import { handlePublicUploadAttachment, handlePublicDownloadAttachment } from '../../src/handlers/attachments';

// Several public handlers reject up front when the server has no usable
// JWT_SECRET. Rather than fabricate the condition, the REAL handlers are run
// against an env whose JWT_SECRET is genuinely empty, so getSafeJwtSecret takes
// its real misconfiguration branch (500). No mocks.
const noJwtEnv = { ...(env as any), JWT_SECRET: '' } as any;
const uuid = () => crypto.randomUUID();
const req = (path: string) => new Request(`https://vault.test${path}`, { method: 'POST' });

describe('handlers reject when JWT secret is unusable', () => {
  it('500s send access v2', async () => {
    expect((await handleAccessSendV2(req('/api/sends/access'), noJwtEnv)).status).toBe(500);
  });

  it('500s send file access v2', async () => {
    expect((await handleAccessSendFileV2(req(`/api/sends/access/file/${uuid()}`), noJwtEnv, uuid())).status).toBe(500);
  });

  it('500s public send file upload', async () => {
    expect((await handlePublicUploadSendFile(req(`/api/sends/${uuid()}/file/${uuid()}`), noJwtEnv, uuid(), uuid())).status).toBe(500);
  });

  it('500s public attachment upload', async () => {
    expect((await handlePublicUploadAttachment(req(`/api/ciphers/${uuid()}/attachment/${uuid()}`), noJwtEnv, uuid(), uuid())).status).toBe(500);
  });

  it('500s public attachment download', async () => {
    const r = new Request(`https://vault.test/api/attachments/${uuid()}/${uuid()}`);
    expect((await handlePublicDownloadAttachment(r, noJwtEnv, uuid(), uuid())).status).toBe(500);
  });
});
