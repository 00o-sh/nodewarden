import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sends');
  token = session.accessToken;
});

function textSend(overrides: Record<string, unknown> = {}) {
  return {
    type: 0, // Text
    name: enc('send'),
    key: ENC_STRING,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    text: { text: enc('secret'), hidden: false },
    ...overrides,
  };
}

async function createSend(overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await api('POST', '/api/sends', token, textSend(overrides));
  if (res.status !== 200) throw new Error(`createSend failed ${res.status}: ${await res.text()}`);
  return res.json();
}

describe('send CRUD', () => {
  it('creates a text send', async () => {
    const send = await createSend();
    expect(send.object).toBe('send');
    expect(typeof send.id).toBe('string');
    expect(typeof send.accessId).toBe('string');
    expect(send.type).toBe(0);
  });

  it('lists and reads a send', async () => {
    const created = await createSend();
    const list = (await (await api('GET', '/api/sends', token)).json()) as any;
    expect((list.data ?? []).map((s: any) => s.id)).toContain(created.id);

    const got = await api('GET', `/api/sends/${created.id}`, token);
    expect(got.status).toBe(200);
  });

  it('updates a send name', async () => {
    const created = await createSend();
    const res = await api('PUT', `/api/sends/${created.id}`, token, textSend({ name: enc('renamed') }));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe(enc('renamed'));
  });

  it('deletes a send', async () => {
    const created = await createSend();
    const del = await api('DELETE', `/api/sends/${created.id}`, token);
    expect(del.status).toBe(200);
    expect((await api('GET', `/api/sends/${created.id}`, token)).status).toBe(404);
  });

  it('bulk-deletes sends', async () => {
    const a = await createSend();
    const b = await createSend();
    const res = await api('POST', '/api/sends/delete', token, { ids: [a.id, b.id] });
    expect([200, 204]).toContain(res.status);
  });
});

describe('send password', () => {
  it('removes a password from a protected send', async () => {
    const created = await createSend({ password: `p-${crypto.randomUUID()}` });
    const res = await api('POST', `/api/sends/${created.id}/remove-password`, token, {});
    expect(res.status).toBe(200);
  });
});

describe('send validation', () => {
  it('requires a name (400)', async () => {
    const res = await api('POST', '/api/sends', token, textSend({ name: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects a deletion date too far in the future (400)', async () => {
    const res = await api('POST', '/api/sends', token, textSend({
      deletionDate: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a file-type send on the text endpoint (400)', async () => {
    const res = await api('POST', '/api/sends', token, textSend({ type: 1 }));
    expect(res.status).toBe(400);
  });
});
