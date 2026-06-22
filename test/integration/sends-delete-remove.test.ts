import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// Delete / bulk-delete / remove-password / remove-auth send endpoints,
// including the file-send blob-cleanup branches and the malformed-body and
// not-found guards. Real D1 + R2, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('senddelremove');
  token = session.accessToken;
});

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function createTextSend(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api('POST', '/api/sends', token, {
    type: 0,
    name: enc('t'),
    key: ENC_STRING,
    deletionDate: future(),
    text: { text: enc('secret'), hidden: false },
    ...extra,
  });
  return ((await res.json()) as any).id;
}

async function reserveFileSend(): Promise<string> {
  const reserve = (await (await api('POST', '/api/sends/file/v2', token, {
    type: 1,
    name: enc('f'),
    key: ENC_STRING,
    fileLength: 8,
    deletionDate: future(),
    file: { fileName: enc('doc'), size: 8 },
  })).json()) as any;
  return reserve.sendResponse.id;
}

describe('delete send', () => {
  it('404s an unknown send', async () => {
    expect((await api('DELETE', `/api/sends/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('deletes a text send and it is then gone', async () => {
    const id = await createTextSend();
    expect((await api('DELETE', `/api/sends/${id}`, token)).status).toBe(200);
    expect((await api('GET', `/api/sends/${id}`, token)).status).toBe(404);
  });

  it('deletes a reserved file send (clears its blob)', async () => {
    const id = await reserveFileSend();
    expect((await api('DELETE', `/api/sends/${id}`, token)).status).toBe(200);
    expect((await api('GET', `/api/sends/${id}`, token)).status).toBe(404);
  });
});

describe('bulk delete sends', () => {
  it('rejects a malformed JSON body', async () => {
    const res = await SELF.fetch(url('/api/sends/delete'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('requires an ids array', async () => {
    expect((await api('POST', '/api/sends/delete', token, { ids: 'nope' })).status).toBe(400);
  });

  it('bulk-deletes a mix of text and file sends', async () => {
    const textId = await createTextSend();
    const fileId = await reserveFileSend();
    const res = await api('POST', '/api/sends/delete', token, { ids: [textId, fileId] });
    expect([200, 204]).toContain(res.status);
    expect((await api('GET', `/api/sends/${textId}`, token)).status).toBe(404);
    expect((await api('GET', `/api/sends/${fileId}`, token)).status).toBe(404);
  });
});

describe('remove send password', () => {
  it('404s an unknown send', async () => {
    expect((await api('PUT', `/api/sends/${crypto.randomUUID()}/remove-password`, token, {})).status).toBe(404);
  });

  it('clears the password of a password-protected send', async () => {
    const id = await createTextSend({ authType: 1, password: 'a-secret-password' });
    const res = await api('PUT', `/api/sends/${id}/remove-password`, token, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).password).toBeNull();
  });
});

describe('remove send auth', () => {
  it('404s an unknown send', async () => {
    expect((await api('PUT', `/api/sends/${crypto.randomUUID()}/remove-auth`, token, {})).status).toBe(404);
  });

  it('resets an email-auth send to no auth', async () => {
    const id = await createTextSend({ authType: 0, emails: 'recipient@example.com' });
    const res = await api('PUT', `/api/sends/${id}/remove-auth`, token, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // SendAuthType.None === 2
    expect(body.authType).toBe(2);
    expect(body.emails).toBeNull();
  });
});
