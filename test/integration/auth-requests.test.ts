import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Login-with-device (passwordless auth request) flow: a new device creates a
// request (public endpoint), and the authenticated account lists/approves it.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('authreq');
  token = session.accessToken;
});

async function createAuthRequest(): Promise<any> {
  const res = await SELF.fetch(url('/api/auth-requests'), {
    method: 'POST',
    headers: baseHeaders({
      'Content-Type': 'application/json',
      'X-Request-Email': session.account.email,
    }),
    body: JSON.stringify({
      email: session.account.email,
      publicKey: 'cHVibGljLWtleQ==',
      accessCode: crypto.randomUUID().slice(0, 24),
      deviceIdentifier: crypto.randomUUID(),
      type: 0,
    }),
  });
  if (res.status !== 200) throw new Error(`createAuthRequest ${res.status}: ${await res.text()}`);
  return res.json();
}

describe('auth requests', () => {
  it('creates an auth request for an existing account', async () => {
    const created = await createAuthRequest();
    expect(typeof created.id).toBe('string');
  });

  it('lists auth requests and pending requests for the account', async () => {
    const created = await createAuthRequest();

    const all = await api('GET', '/api/auth-requests', token);
    expect(all.status).toBe(200);
    expect(JSON.stringify(await all.json())).toContain(created.id);

    const pending = await api('GET', '/api/auth-requests/pending', token);
    expect(pending.status).toBe(200);
  });

  it('fetches a single auth request by id', async () => {
    const created = await createAuthRequest();
    const res = await api('GET', `/api/auth-requests/${created.id}`, token);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(created.id);
  });

  it('approves an auth request', async () => {
    const created = await createAuthRequest();
    const res = await api('PUT', `/api/auth-requests/${created.id}`, token, {
      requestApproved: true,
      key: ENC_STRING,
      deviceIdentifier: session.account.deviceIdentifier,
    });
    expect(res.status).toBe(200);
  });

  it('rejects creating an auth request for an unknown account (400)', async () => {
    const res = await SELF.fetch(url('/api/auth-requests'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email: `ghost-${crypto.randomUUID()}@vault.test`,
        publicKey: 'cHVibGljLWtleQ==',
        accessCode: crypto.randomUUID().slice(0, 24),
        deviceIdentifier: crypto.randomUUID(),
        type: 0,
      }),
    });
    expect(res.status).toBe(400);
  });
});
