import { SELF, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// The authenticated admin-approval auth-request endpoint
// (POST /api/auth-requests/admin-request) and the list/pending dispatch guards
// the public + happy-path suites never reach: type/email/field validation, a
// successful admin request, the pending-list device-resolution branch, and the
// method-not-allowed responses. Real worker + real D1.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('authreq-admin');
  token = session.accessToken;
});

beforeEach(async () => {
  // Upstream enforces a strict 5/min auth-request-create budget keyed by
  // IP/email/device, all shared across this file's account. Clear the buckets so
  // each test can create the request(s) it needs.
  await (env as { DB: D1Database }).DB
    .prepare("DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'auth-request:%'")
    .run();
});

function adminBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: session.account.email,
    publicKey: btoa('admin-public-key'),
    accessCode: crypto.randomUUID().slice(0, 24),
    deviceIdentifier: crypto.randomUUID(),
    type: 2,
    ...overrides,
  };
}

describe('admin auth-request validation', () => {
  it('400s when the type is not AdminApproval (2)', async () => {
    const res = await api('POST', '/api/auth-requests/admin-request', token, adminBody({ type: 0 }));
    expect(res.status).toBe(400);
  });

  it('400s when the email does not match the authenticated user', async () => {
    const res = await api('POST', '/api/auth-requests/admin-request', token, adminBody({ email: 'someone-else@vault.test' }));
    expect(res.status).toBe(400);
  });

  it('400s when the public key / device identifier / access code are missing', async () => {
    const res = await api('POST', '/api/auth-requests/admin-request', token, {
      email: session.account.email,
      type: 2,
    });
    expect(res.status).toBe(400);
  });

  it('creates an admin-approval auth request for the authenticated user', async () => {
    const res = await api('POST', '/api/auth-requests/admin-request', token, adminBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.id).toBe('string');
    expect(body.requestApproved).toBe(false);
    expect(body.object).toBe('auth-request');
  });
});

describe('pending list device resolution', () => {
  it('lists a pending request and resolves its originating device', async () => {
    // Create a normal (type-0) login request via the public endpoint, keyed to
    // the session's REAL device identifier so the pending-list mapping takes the
    // "device found" branch (device?.deviceIdentifier) instead of the fallback
    // to the raw request device identifier.
    const create = await SELF.fetch(url('/api/auth-requests'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', 'X-Request-Email': session.account.email }),
      body: JSON.stringify({
        email: session.account.email,
        publicKey: btoa('pending-public-key'),
        accessCode: crypto.randomUUID().slice(0, 24),
        deviceIdentifier: session.account.deviceIdentifier,
        type: 0,
      }),
    });
    expect(create.status).toBe(200);
    const createdId = ((await create.json()) as any).id;

    const pending = await api('GET', '/api/auth-requests/pending', token);
    expect(pending.status).toBe(200);
    const body = (await pending.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
    const found = body.data.find((r: any) => r.id === createdId);
    expect(found).toBeTruthy();
    expect(found.requestDeviceId).toBe(session.account.deviceIdentifier);
  });
});

describe('auth-request route method guards', () => {
  it('405s a GET on the admin-request endpoint', async () => {
    expect((await api('GET', '/api/auth-requests/admin-request', token)).status).toBe(405);
  });

  it('405s a POST on the pending endpoint', async () => {
    expect((await api('POST', '/api/auth-requests/pending', token, {})).status).toBe(405);
  });

  it('405s a DELETE on a single auth-request id', async () => {
    expect((await api('DELETE', `/api/auth-requests/${crypto.randomUUID()}`, token)).status).toBe(405);
  });
});
