import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, enc, url } from './helpers';

// Public (unauthenticated) Send access by access id, including the password gate.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('sendpub');
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

function access(accessId: string, body: unknown = {}): Promise<Response> {
  return SELF.fetch(url(`/api/sends/access/${accessId}`), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

describe('public send access', () => {
  it('serves a passwordless send to anonymous callers', async () => {
    const send = await createSend();
    const res = await access(send.accessId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id ?? body.Id).toBeTruthy();
  });

  it('gates a password-protected send', async () => {
    const password = `pw-${crypto.randomUUID()}`;
    const send = await createSend({ password });

    // No password -> rejected.
    expect((await access(send.accessId, {})).status).not.toBe(200);
    // Wrong password -> rejected.
    expect((await access(send.accessId, { password: 'nope' })).status).not.toBe(200);
    // Correct password -> served.
    expect((await access(send.accessId, { password })).status).toBe(200);
  });

  it('returns 404 for an unknown access id', async () => {
    const res = await access('AAAAAAAAAAAAAAAAAAAAAA');
    expect(res.status).toBe(404);
  });
});
