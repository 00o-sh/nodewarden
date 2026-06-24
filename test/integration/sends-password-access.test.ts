import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// The send_access OAuth grant for a password-protected send: a wrong plaintext
// password and a wrong password hash are both rejected, and repeated failures
// from one client trip the per-IP send-password lockout. Real grant + D1
// lockout, no mocks.
let session: Session;
let token: string;
let sendId: string;

const futureDeletion = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

function grant(params: Record<string, string>, ip: string): Promise<Response> {
  return SELF.fetch(url('/identity/connect/token'), {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'send_access', send_id: sendId, ...params }).toString(),
  });
}

beforeAll(async () => {
  session = await authenticate('sendspwaccess');
  token = session.accessToken;
  const send = (await (await api('POST', '/api/sends', token, {
    type: 0, name: ENC_STRING, key: ENC_STRING, deletionDate: futureDeletion(),
    text: { text: ENC_STRING, hidden: false }, password: 'the-real-password',
  })).json()) as any;
  sendId = send.id;
});

describe('send_access grant for a password-protected send', () => {
  it('rejects a wrong plaintext password', async () => {
    const res = await grant({ password: 'wrong' }, '198.51.110.1');
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('invalid password');
  });

  it('rejects a wrong password hash (hash-b64 path)', async () => {
    const res = await grant({ password_hash_b64: btoa('not-the-hash') }, '198.51.110.2');
    expect(res.status).toBe(400);
  });

  it('locks out after repeated wrong passwords from one client', async () => {
    const ip = '198.51.110.3';
    let last: Response | null = null;
    // The send-password lockout trips after the configured attempt budget.
    for (let i = 0; i < 12; i++) {
      last = await grant({ password: 'still-wrong' }, ip);
    }
    expect(last!.status).toBe(429);
  });
});
