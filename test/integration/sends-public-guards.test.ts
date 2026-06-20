import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// Public Send access guards driven over HTTP: max-access exhaustion, disabled,
// expired, and the per-IP password-attempt lockout (real D1-backed rate limit).
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendguard');
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
  if (res.status !== 200) throw new Error(`createSend ${res.status}: ${await res.text()}`);
  return res.json();
}

function access(accessId: string, body: unknown = {}, ip?: string): Promise<Response> {
  const headers = baseHeaders({ 'Content-Type': 'application/json' });
  if (ip) headers['CF-Connecting-IP'] = ip;
  return SELF.fetch(url(`/api/sends/access/${accessId}`), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('public send access guards', () => {
  it('serves a text send until its max access count is exhausted', async () => {
    const send = await createSend({ maxAccessCount: 1 });
    expect((await access(send.accessId)).status).toBe(200);
    // The second access exceeds the cap and the send becomes inaccessible.
    expect((await access(send.accessId)).status).toBe(404);
  });

  it('refuses a disabled send', async () => {
    const send = await createSend({ disabled: true });
    expect((await access(send.accessId)).status).toBe(404);
  });

  it('refuses an expired send', async () => {
    const send = await createSend({ expirationDate: new Date(Date.now() - 60_000).toISOString() });
    expect((await access(send.accessId)).status).toBe(404);
  });

  it('locks out repeated wrong-password attempts from one IP (429)', async () => {
    const password = `pw-${crypto.randomUUID()}`;
    const send = await createSend({ password });
    // Isolated IP so the lockout does not poison other tests sharing the
    // default client IP.
    const ip = '198.51.100.42';

    // The default login lockout threshold is 10 attempts; the 10th failure
    // trips the lock and returns 429.
    let lockedStatus = 0;
    for (let i = 0; i < 10; i++) {
      lockedStatus = (await access(send.accessId, { password: 'wrong' }, ip)).status;
    }
    expect(lockedStatus).toBe(429);

    // Even the correct password is refused while the IP is locked.
    expect((await access(send.accessId, { password }, ip)).status).toBe(429);

    // A different IP is unaffected and can access with the correct password.
    expect((await access(send.accessId, { password }, '198.51.100.99')).status).toBe(200);
  });
});
