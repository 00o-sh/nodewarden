import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate } from './helpers';
import { handleCreateAttachment } from '../../src/handlers/attachments';

// handleCreateAttachment reaches its JWT-secret check only after the cipher is
// resolved and the body validated, so it needs a real cipher. The REAL handler
// then runs against an env with an empty JWT_SECRET, taking its genuine
// 'server configuration error' branch (500). No mocks.
let session: Session;
let token: string;
let userId: string;
let cipherId: string;

const noJwtEnv = { ...(env as any), JWT_SECRET: '' } as any;

beforeAll(async () => {
  session = await authenticate('attachconfigerr');
  token = session.accessToken;
  userId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;
  const cipher = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any;
  cipherId = cipher.id;
});

describe('attachment create with an unusable JWT secret', () => {
  it('500s reserving an attachment', async () => {
    const request = new Request(`https://vault.test/api/ciphers/${cipherId}/attachment/v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: ENC_STRING, key: ENC_STRING, fileSize: 8 }),
    });
    const res = await handleCreateAttachment(request, noJwtEnv, userId, cipherId);
    expect(res.status).toBe(500);
  });
});
