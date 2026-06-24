import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';
import { SELF } from 'cloudflare:test';

// Not-found / wrong-type / malformed-body branches of the authenticated send
// file-upload and update handlers, driven through the real API. No mocks.
let session: Session;
let token: string;
let textSendId: string;
let fileSendId: string;
let realFileId: string;

const futureDeletion = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

beforeAll(async () => {
  session = await authenticate('sendsfileupdate');
  token = session.accessToken;

  const text = (await (await api('POST', '/api/sends', token, {
    type: 0, name: ENC_STRING, key: ENC_STRING, deletionDate: futureDeletion(),
    text: { text: ENC_STRING, hidden: false },
  })).json()) as any;
  textSendId = text.id;

  const fileReserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1, name: ENC_STRING, key: ENC_STRING, fileLength: 16, deletionDate: futureDeletion(),
    file: { fileName: ENC_STRING, size: 16 },
  })).json()) as any;
  fileSendId = fileReserve.sendResponse.id;
  realFileId = new URL(fileReserve.url).pathname.split('/file/')[1];
});

describe('send file-upload and update branches', () => {
  it('404s an upload-url request for a non-existent send', async () => {
    expect((await api('GET', `/api/sends/${crypto.randomUUID()}/file/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('400s an upload-url request against a text send', async () => {
    expect((await api('GET', `/api/sends/${textSendId}/file/${crypto.randomUUID()}`, token)).status).toBe(400);
  });

  it('400s an upload-url request whose file id does not match the send', async () => {
    const res = await api('GET', `/api/sends/${fileSendId}/file/${crypto.randomUUID()}`, token);
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('does not match');
  });

  it('404s a file upload for a non-existent send', async () => {
    const res = await SELF.fetch(url(`/api/sends/${crypto.randomUUID()}/file/${crypto.randomUUID()}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: 'data',
    });
    expect(res.status).toBe(404);
  });

  it('400s a file upload against a text send', async () => {
    const res = await SELF.fetch(url(`/api/sends/${textSendId}/file/${realFileId}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: 'data',
    });
    expect(res.status).toBe(400);
  });

  it('404s an update for a non-existent send', async () => {
    expect((await api('PUT', `/api/sends/${crypto.randomUUID()}`, token, { name: ENC_STRING })).status).toBe(404);
  });

  it('400s an update with a malformed JSON body', async () => {
    const res = await SELF.fetch(url(`/api/sends/${textSendId}`), {
      method: 'PUT',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });
});
