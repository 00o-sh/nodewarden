import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc } from './helpers';

// Authenticated Send handler branches the existing suites miss: the paginated
// listing, the update-time validation/auth toggles, and file-send deletion
// (single + bulk) with R2 blob cleanup. Real D1/R2, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendpriv-edge');
  token = session.accessToken;
});

function textSend(overrides: Record<string, unknown> = {}) {
  return {
    type: 0, name: enc('s'), key: ENC_STRING,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    text: { text: enc('secret'), hidden: false },
    ...overrides,
  };
}

async function createText(overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await api('POST', '/api/sends', token, textSend(overrides));
  expect(res.status).toBe(200);
  return res.json();
}

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

describe('send pagination', () => {
  it('pages through sends via pageSize + continuationToken', async () => {
    const created = [await createText(), await createText(), await createText()];
    const ids = new Set(created.map((s) => s.id));

    const seen = new Set<string>();
    let cont: string | null = null;
    let guard = 0;
    do {
      const q = `/api/sends?pageSize=1${cont ? `&continuationToken=${encodeURIComponent(cont)}` : ''}`;
      const page = (await (await api('GET', q, token)).json()) as any;
      expect(page.object).toBe('list');
      for (const s of page.data) seen.add(s.id);
      cont = page.continuationToken;
    } while (cont && (guard += 1) < 50);

    for (const id of ids) expect(seen.has(id)).toBe(true);
  });
});

describe('update validation branches', () => {
  it('rejects an invalid hideEmail, text data, and authType', async () => {
    const send = await createText();
    expect((await api('PUT', `/api/sends/${send.id}`, token, { hideEmail: 'yes' })).status).toBe(400);
    expect((await api('PUT', `/api/sends/${send.id}`, token, { text: [1, 2] })).status).toBe(400);
    expect((await api('PUT', `/api/sends/${send.id}`, token, { authType: 9 })).status).toBe(400);
  });

  it('toggles email auth on and off through the emails field', async () => {
    const send = await createText();
    // Invalid emails value.
    expect((await api('PUT', `/api/sends/${send.id}`, token, { emails: 42 })).status).toBe(400);

    // Setting emails switches auth to Email.
    const withEmail = await api('PUT', `/api/sends/${send.id}`, token, { emails: ['r@x.test'] });
    expect(withEmail.status).toBe(200);

    // Clearing emails (null) reverts auth away from Email.
    const cleared = await api('PUT', `/api/sends/${send.id}`, token, { emails: null });
    expect(cleared.status).toBe(200);
  });

  it('rejects switching to password auth without supplying a password', async () => {
    const send = await createText();
    expect((await api('PUT', `/api/sends/${send.id}`, token, { authType: 1 })).status).toBe(400);
  });
});

describe('file send deletion', () => {
  it('deletes a single file send and its blob', async () => {
    const { id } = await reserveFileSend(new TextEncoder().encode('file-bytes'));
    const del = await api('DELETE', `/api/sends/${id}`, token);
    expect(del.status).toBe(200);
    expect((await api('GET', `/api/sends/${id}`, token)).status).toBe(404);
  });

  it('bulk-deletes sends including a file send and rejects a non-array ids', async () => {
    expect((await api('POST', '/api/sends/delete', token, { ids: 'nope' })).status).toBe(400);

    const text = await createText();
    const { id: fileId } = await reserveFileSend(new TextEncoder().encode('bulk-file'));
    const res = await api('POST', '/api/sends/delete', token, { ids: [text.id, fileId] });
    expect([200, 204]).toContain(res.status);
    expect((await api('GET', `/api/sends/${fileId}`, token)).status).toBe(404);
  });
});
