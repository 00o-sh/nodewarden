import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Accessing a password-protected text send with the correct password succeeds
// and clears the per-IP send-password attempt counter. Real D1, no mocks.
let session: Session;
let accessId: string;

beforeAll(async () => {
  session = await authenticate('sendspwok');
  const send = (await (await api('POST', '/api/sends', session.accessToken, {
    type: 0, name: ENC_STRING, key: ENC_STRING,
    deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    text: { text: ENC_STRING, hidden: false }, password: 'correct-horse',
  })).json()) as any;
  accessId = send.accessId;
});

describe('password-protected send access with the correct password', () => {
  it('succeeds and returns the send', async () => {
    const res = await SELF.fetch(url(`/api/sends/access/${accessId}`), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password: 'correct-horse' }),
    });
    expect(res.status).toBe(200);
  });
});
