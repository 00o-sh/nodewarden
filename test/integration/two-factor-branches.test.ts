import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';
import { SELF } from 'cloudflare:test';
import { randomBase32 } from './helpers';

// Validation / verification-failure branches of the TOTP two-factor handlers,
// exercised through the real authenticated API. No mocks.
let session: Session;
let token: string;

function rawJson(method: string, path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body,
  });
}

beforeAll(async () => {
  session = await authenticate('twofactorbranches');
  token = session.accessToken;
});

describe('two-factor authenticator branches', () => {
  it('400s get-authenticator with malformed JSON', async () => {
    expect((await rawJson('POST', '/api/two-factor/get-authenticator', '{bad')).status).toBe(400);
  });

  it('400s get-authenticator when the master password is wrong', async () => {
    const res = await api('POST', '/api/two-factor/get-authenticator', token, { masterPasswordHash: 'definitely-wrong' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('verification failed');
  });

  it('400s enabling the authenticator without the required fields', async () => {
    const res = await api('PUT', '/api/two-factor/authenticator', token, {});
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('required');
  });

  it('400s enabling the authenticator with an invalid verification token', async () => {
    const res = await api('PUT', '/api/two-factor/authenticator', token, {
      key: randomBase32(), token: '123456', userVerificationToken: 'not-a-valid-token',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('verification failed');
  });

  it('400s disabling an unsupported two-factor provider', async () => {
    const res = await api('DELETE', '/api/two-factor/authenticator', token, { type: 99 });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('not supported');
  });

  it('400s disabling the authenticator when verification fails', async () => {
    const res = await api('DELETE', '/api/two-factor/authenticator', token, { masterPasswordHash: 'definitely-wrong' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('verification failed');
  });
});
