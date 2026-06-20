import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendupd');
  token = session.accessToken;
});

function textSend(overrides: Record<string, unknown> = {}) {
  return {
    type: 0,
    name: enc('send'),
    key: ENC_STRING,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    text: { text: enc('secret'), hidden: false },
    ...overrides,
  };
}

async function createSend(overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await api('POST', '/api/sends', token, textSend(overrides));
  expect(res.status).toBe(200);
  return res.json();
}

describe('send update', () => {
  it('updates access limits, expiration, and disabled flag', async () => {
    const created = await createSend();
    const res = await api('PUT', `/api/sends/${created.id}`, token, textSend({
      name: enc('updated'),
      maxAccessCount: 5,
      expirationDate: new Date(Date.now() + 86_400_000).toISOString(),
      disabled: true,
    }));
    expect(res.status).toBe(200);
    const updated = (await res.json()) as any;
    expect(updated.name).toBe(enc('updated'));
    expect(updated.maxAccessCount).toBe(5);
    expect(updated.disabled).toBe(true);
  });

  it('clears the expiration date when set to null', async () => {
    const created = await createSend({ expirationDate: new Date(Date.now() + 86_400_000).toISOString() });
    const res = await api('PUT', `/api/sends/${created.id}`, token, textSend({ expirationDate: null }));
    expect(res.status).toBe(200);
    expect((await res.json()).expirationDate).toBeNull();
  });

  it('rejects changing a send type (400)', async () => {
    const created = await createSend();
    const res = await api('PUT', `/api/sends/${created.id}`, token, textSend({ type: 1 }));
    expect(res.status).toBe(400);
  });

  it('removes auth from a password-protected send', async () => {
    const created = await createSend({ password: `p-${crypto.randomUUID()}` });
    const res = await api('POST', `/api/sends/${created.id}/remove-auth`, token, {});
    expect(res.status).toBe(200);
  });
});
