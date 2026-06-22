import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Guard branches of the account-passkey (WebAuthn) management endpoints:
// listing, the create-credential invalid-body / invalid-token guards, and the
// delete not-found guard. Real D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('passkeyguards');
  token = session.accessToken;
});

describe('account passkey management guards', () => {
  it('lists passkey credentials (empty)', async () => {
    const res = await api('GET', '/api/webauthn', token);
    expect(res.status).toBe(200);
  });

  it('400s create-credential with a malformed body', async () => {
    const res = await SELF.fetch(url('/api/webauthn'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });

  it('400s create-credential with an invalid challenge token', async () => {
    const res = await api('POST', '/api/webauthn', token, { token: 'not-a-valid-challenge-token', deviceResponse: {} });
    expect(res.status).toBe(400);
  });

  it('404s deleting an unknown passkey credential', async () => {
    const res = await api('DELETE', `/api/webauthn/${crypto.randomUUID()}`, token, {});
    expect([400, 404]).toContain(res.status);
  });
});
