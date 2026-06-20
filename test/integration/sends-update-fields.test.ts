import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc } from './helpers';

let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendfields');
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

describe('send field updates', () => {
  it('persists notes and hideEmail on update', async () => {
    const created = await createSend();
    const res = await api('PUT', `/api/sends/${created.id}`, token, textSend({
      notes: enc('a note'),
      hideEmail: true,
      maxAccessCount: 3,
    }));
    expect(res.status).toBe(200);
    const updated = (await res.json()) as any;
    expect(updated.maxAccessCount).toBe(3);
    expect(updated.hideEmail).toBe(true);
  });

  it('creates a send with notes and disabled set', async () => {
    const send = await createSend({ notes: enc('note'), disabled: true });
    expect(send.disabled).toBe(true);
  });

  it('rejects an invalid maxAccessCount (400)', async () => {
    const res = await api('POST', '/api/sends', token, textSend({ maxAccessCount: -3 }));
    expect(res.status).toBe(400);
  });

  it('returns 404 updating a missing send', async () => {
    const res = await api('PUT', `/api/sends/${crypto.randomUUID()}`, token, textSend());
    expect(res.status).toBe(404);
  });
});
