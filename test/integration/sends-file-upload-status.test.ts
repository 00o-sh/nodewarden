import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

// The GET send file-upload status endpoint (re-issues a fresh upload token):
// success and its not-found / wrong-type / file-id-mismatch guards. Real D1,
// no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendfilestatus');
  token = session.accessToken;
});

async function reserveFileSend(): Promise<{ sendId: string; fileId: string }> {
  const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1, name: enc('f'), key: ENC_STRING, fileLength: 8,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: enc('doc'), size: 8 },
  })).json()) as any;
  const fileId = new URL(reserve.url).pathname.split('/file/')[1];
  return { sendId: reserve.sendResponse.id, fileId };
}

describe('send file upload status', () => {
  it('re-issues an upload URL for a reserved file send', async () => {
    const { sendId, fileId } = await reserveFileSend();
    const res = await api('GET', `/api/sends/${sendId}/file/${fileId}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('send-fileUpload');
    expect(String(body.url)).toContain(`/api/sends/${sendId}/file/${fileId}`);
    expect(body.sendResponse.id).toBe(sendId);
  });

  it('404s an unknown send', async () => {
    expect((await api('GET', `/api/sends/${crypto.randomUUID()}/file/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('400s a non-file (text) send', async () => {
    const text = (await (await api('POST', '/api/sends', token, {
      type: 0, name: enc('t'), key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: enc('secret'), hidden: false },
    })).json()) as any;
    expect((await api('GET', `/api/sends/${text.id}/file/${crypto.randomUUID()}`, token)).status).toBe(400);
  });

  it('400s a mismatched file id', async () => {
    const { sendId } = await reserveFileSend();
    expect((await api('GET', `/api/sends/${sendId}/file/${crypto.randomUUID()}`, token)).status).toBe(400);
  });
});
