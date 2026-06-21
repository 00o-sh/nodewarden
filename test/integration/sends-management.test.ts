import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// Send update branches, password removal, and file-send create/upload error
// paths that the existing send suites don't reach.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendmgmt');
  token = session.accessToken;
});

function textSend(overrides: Record<string, unknown> = {}) {
  return {
    type: 0,
    name: enc('s'),
    key: ENC_STRING,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    text: { text: enc('secret'), hidden: false },
    ...overrides,
  };
}

async function createText(overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await api('POST', '/api/sends', token, textSend(overrides));
  if (res.status !== 200) throw new Error(`create ${res.status}: ${await res.text()}`);
  return res.json();
}

function fileSendBody(bytesLen: number, overrides: Record<string, unknown> = {}) {
  return {
    type: 1,
    name: enc('file-send'),
    key: ENC_STRING,
    fileLength: bytesLen,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    file: { fileName: enc('doc'), size: bytesLen },
    ...overrides,
  };
}

describe('send update branches', () => {
  it('updates name, key, notes, and text data', async () => {
    const s = await createText();
    const res = await api('PUT', `/api/sends/${s.id}`, token, {
      name: enc('renamed'),
      key: ENC_STRING,
      notes: enc('a note'),
      text: { text: enc('updated'), hidden: true },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe(enc('renamed'));
  });

  it('validates update fields (empty name/key, bad disabled, bad dates)', async () => {
    const s = await createText();
    expect((await api('PUT', `/api/sends/${s.id}`, token, { name: '' })).status).toBe(400);
    expect((await api('PUT', `/api/sends/${s.id}`, token, { key: '' })).status).toBe(400);
    expect((await api('PUT', `/api/sends/${s.id}`, token, { disabled: 'nope' })).status).toBe(400);
    expect((await api('PUT', `/api/sends/${s.id}`, token, { deletionDate: 'not-a-date' })).status).toBe(400);
    expect((await api('PUT', `/api/sends/${s.id}`, token, { expirationDate: 'not-a-date' })).status).toBe(400);
    expect((await api('PUT', `/api/sends/${s.id}`, token, { authType: 999 })).status).toBe(400);
  });

  it('sets hideEmail (bool and null) and toggles disabled', async () => {
    const s = await createText();
    expect((await api('PUT', `/api/sends/${s.id}`, token, { hideEmail: true, disabled: true })).status).toBe(200);
    expect((await api('PUT', `/api/sends/${s.id}`, token, { hideEmail: null })).status).toBe(200);
  });

  it('adds a password on update and removes it via remove-password', async () => {
    const password = `pw-${crypto.randomUUID()}`;
    const s = await createText();

    // Add a password on update.
    expect((await api('PUT', `/api/sends/${s.id}`, token, { password })).status).toBe(200);

    // Access now requires the password.
    const gated = await SELF.fetch(url(`/api/sends/access/${s.accessId}`), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(gated.status).not.toBe(200);

    // Remove the password; access is open again.
    const removed = await api('POST', `/api/sends/${s.id}/remove-password`, token, {});
    expect(removed.status).toBe(200);
    const open = await SELF.fetch(url(`/api/sends/access/${s.accessId}`), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(open.status).toBe(200);
  });

  it('404s updating or removing the password of a missing send', async () => {
    const ghost = crypto.randomUUID();
    expect((await api('PUT', `/api/sends/${ghost}`, token, { name: enc('x') })).status).toBe(404);
    expect((await api('POST', `/api/sends/${ghost}/remove-password`, token, {})).status).toBe(404);
  });
});

describe('file send create + upload errors', () => {
  it('rejects a file larger than the storage limit (400)', async () => {
    const res = await api('POST', '/api/sends/file/v2', token, fileSendBody(200 * 1024 * 1024));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid/missing fileLength (400)', async () => {
    expect((await api('POST', '/api/sends/file/v2', token, fileSendBody(0, { fileLength: 'big' }))).status).toBe(400);
    expect((await api('POST', '/api/sends/file/v2', token, fileSendBody(0, { fileLength: undefined }))).status).toBe(400);
  });

  it('reserves a password-protected file send', async () => {
    const res = await api('POST', '/api/sends/file/v2', token, fileSendBody(16, { password: `pw-${crypto.randomUUID()}` }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).sendResponse.type).toBe(1);
  });

  it('rejects an upload whose size does not match the reservation (400)', async () => {
    const reserve = (await (await api('POST', '/api/sends/file/v2', token, fileSendBody(20))).json()) as any;
    const fileId = new URL(reserve.url).pathname.split('/file/')[1];

    // Upload only 5 bytes against a 20-byte reservation -> size mismatch.
    const res = await SELF.fetch(url(`/api/sends/${reserve.sendResponse.id}/file/${fileId}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: new Uint8Array(5),
    });
    expect([400, 413]).toContain(res.status);
  });

  it('rejects an authenticated upload to the wrong file id (400)', async () => {
    const reserve = (await (await api('POST', '/api/sends/file/v2', token, fileSendBody(16))).json()) as any;
    const res = await SELF.fetch(url(`/api/sends/${reserve.sendResponse.id}/file/${crypto.randomUUID()}`), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: new Uint8Array(16),
    });
    expect(res.status).toBe(400);
  });
});
