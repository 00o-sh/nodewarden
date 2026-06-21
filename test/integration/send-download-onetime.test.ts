import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// The send file-download token is one-time and path-bound: a second download
// with the same token is rejected, and the token does not work against a
// different send/file. Real D1/R2, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('senddl1');
  token = session.accessToken;
});

async function reserveFileSend(bytes: Uint8Array): Promise<{ id: string; fileId: string }> {
  const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1, name: enc('f'), key: ENC_STRING, fileLength: bytes.byteLength,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: enc('doc'), size: bytes.byteLength },
  })).json()) as any;
  const fileId = new URL(reserve.url).pathname.split('/file/')[1];
  const up = await SELF.fetch(reserve.url, { method: 'POST', headers: baseHeaders(), body: bytes });
  expect(up.status).toBeLessThan(300);
  return { id: reserve.sendResponse.id, fileId };
}

async function downloadUrlFor(sendId: string, fileId: string): Promise<string> {
  const res = await SELF.fetch(url(`/api/sends/${sendId}/access/file/${fileId}`), {
    method: 'POST', headers: baseHeaders({ 'Content-Type': 'application/json' }), body: '{}',
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).url as string;
}

describe('send file download one-time token', () => {
  it('rejects reusing a download token', async () => {
    const bytes = new TextEncoder().encode('send-file-content');
    const { id, fileId } = await reserveFileSend(bytes);
    const downloadUrl = await downloadUrlFor(id, fileId);

    const first = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);

    const second = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
    expect(second.status).toBe(401);
  });

  it('rejects a download token used against a different send id', async () => {
    const a = await reserveFileSend(new TextEncoder().encode('a'));
    const b = await reserveFileSend(new TextEncoder().encode('b'));
    const downloadUrl = await downloadUrlFor(a.id, a.fileId);

    // Swap the send id in the path while keeping a's token -> mismatch.
    const tampered = downloadUrl.replace(a.id, b.id);
    const res = await SELF.fetch(tampered, { headers: baseHeaders() });
    expect(res.status).toBe(401);
  });
});
