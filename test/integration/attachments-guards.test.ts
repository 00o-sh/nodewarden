import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Guard branches (cipher-not-found, attachment-not-found, malformed body) and
// the success paths of the attachment create / get / update-metadata / delete
// endpoints. Real D1 + R2, no mocks.
let session: Session;
let token: string;
let cipherId: string;

beforeAll(async () => {
  session = await authenticate('attachguards');
  token = session.accessToken;
  const cipher = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any;
  cipherId = cipher.id;
});

async function reserveAttachment(): Promise<string> {
  const res = await api('POST', `/api/ciphers/${cipherId}/attachment/v2`, token, {
    fileName: ENC_STRING, key: ENC_STRING, fileSize: 16,
  });
  return ((await res.json()) as any).attachmentId;
}

function rawPost(path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    body,
  });
}

describe('create attachment guards', () => {
  it('404s when the cipher is unknown', async () => {
    expect((await api('POST', `/api/ciphers/${crypto.randomUUID()}/attachment/v2`, token, {
      fileName: ENC_STRING, key: ENC_STRING, fileSize: 16,
    })).status).toBe(404);
  });

  it('400s a malformed body', async () => {
    expect((await rawPost(`/api/ciphers/${cipherId}/attachment/v2`, '{bad')).status).toBe(400);
  });

  it('400s when fileName/key are missing', async () => {
    expect((await api('POST', `/api/ciphers/${cipherId}/attachment/v2`, token, {})).status).toBe(400);
  });
});

describe('get attachment', () => {
  it('404s when the cipher is unknown', async () => {
    expect((await api('GET', `/api/ciphers/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('404s when the attachment is unknown', async () => {
    expect((await api('GET', `/api/ciphers/${cipherId}/attachment/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('returns a download URL for a reserved attachment', async () => {
    const attachmentId = await reserveAttachment();
    const res = await api('GET', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('attachment');
    expect(body.id).toBe(attachmentId);
    expect(String(body.url)).toContain(`/api/attachments/${cipherId}/${attachmentId}`);
  });
});

describe('update attachment metadata guards', () => {
  it('404s when the cipher is unknown', async () => {
    expect((await api('POST', `/api/ciphers/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}/metadata`, token, {})).status).toBe(404);
  });

  it('404s when the attachment is unknown', async () => {
    expect((await api('POST', `/api/ciphers/${cipherId}/attachment/${crypto.randomUUID()}/metadata`, token, {})).status).toBe(404);
  });

  it('400s a malformed body', async () => {
    const attachmentId = await reserveAttachment();
    expect((await rawPost(`/api/ciphers/${cipherId}/attachment/${attachmentId}/metadata`, '{bad')).status).toBe(400);
  });
});

describe('delete attachment', () => {
  it('404s when the cipher is unknown', async () => {
    expect((await api('DELETE', `/api/ciphers/${crypto.randomUUID()}/attachment/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('404s when the attachment is unknown', async () => {
    expect((await api('DELETE', `/api/ciphers/${cipherId}/attachment/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('deletes a reserved attachment and it is then gone', async () => {
    const attachmentId = await reserveAttachment();
    expect((await api('DELETE', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token)).status).toBe(200);
    expect((await api('GET', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token)).status).toBe(404);
  });
});
