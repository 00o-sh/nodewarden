import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Passwordless login via an approved auth request: create the request, approve
// it as the authenticated user, then exchange it at the token endpoint using the
// access code as the password. Exercises the real auth-request validation path
// in the identity handler (no crypto fabricated — the access code is a plain
// shared secret we control end to end).
let session: Session;
let token: string;
let email: string;
const accessCode = 'auth-req-code-123';
const requestDevice = crypto.randomUUID();

beforeAll(async () => {
  session = await authenticate('authreqlogin');
  token = session.accessToken;
  email = session.account.email;
});

describe('auth-request passwordless login', () => {
  it('logs in with an approved auth request and its access code', async () => {
    // 1. Create the auth request (anonymous endpoint).
    const create = await SELF.fetch(url('/api/auth-requests'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email,
        publicKey: btoa('auth-request-public-key'),
        accessCode,
        deviceIdentifier: requestDevice,
        deviceType: 10,
        type: 0,
      }),
    });
    expect(create.status).toBe(200);
    const authRequestId = ((await create.json()) as any).id as string;
    expect(typeof authRequestId).toBe('string');

    // 2. Approve it as the signed-in user, supplying the encrypted key.
    const approve = await api('PUT', `/api/auth-requests/${authRequestId}`, token, {
      requestApproved: true,
      key: ENC_STRING,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(approve.status).toBe(200);

    // 3. Exchange it at the token endpoint, using the access code as password.
    const form = new URLSearchParams({
      grant_type: 'password',
      username: email,
      password: accessCode,
      authRequest: authRequestId,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '10',
      deviceIdentifier: crypto.randomUUID(),
      deviceName: 'auth-request-login',
    });
    const login = await SELF.fetch(url('/identity/connect/token'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form.toString(),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as any;
    expect(typeof body.access_token).toBe('string');
  });
});
