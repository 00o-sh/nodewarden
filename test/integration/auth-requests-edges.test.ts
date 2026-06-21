import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Auth-request (login-with-device) branches the happy-path suite misses:
// create-time validation, the public response-poll endpoint, and the update
// guards (deny, already-answered, superseded request, approve-without-key).
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('authreq-edge');
  token = session.accessToken;
});

async function create(overrides: Record<string, unknown> = {}): Promise<{ id: string; accessCode: string; deviceIdentifier: string }> {
  const accessCode = crypto.randomUUID().slice(0, 24);
  const deviceIdentifier = (overrides.deviceIdentifier as string) ?? crypto.randomUUID();
  const res = await SELF.fetch(url('/api/auth-requests'), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', 'X-Request-Email': session.account.email }),
    body: JSON.stringify({
      email: session.account.email,
      publicKey: 'cHVibGljLWtleQ==',
      accessCode,
      deviceIdentifier,
      type: 0,
      ...overrides,
    }),
  });
  if (res.status !== 200) throw new Error(`create ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as any;
  return { id: body.id, accessCode, deviceIdentifier };
}

function poll(id: string, code: string): Promise<Response> {
  return SELF.fetch(url(`/api/auth-requests/${id}/response?code=${encodeURIComponent(code)}`), {
    headers: baseHeaders(),
  });
}

describe('auth request create validation', () => {
  it('400s on a non-JSON payload', async () => {
    const res = await SELF.fetch(url('/api/auth-requests'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('400s when required fields are missing', async () => {
    const res = await SELF.fetch(url('/api/auth-requests'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: session.account.email, type: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('400s for the unsupported admin-approval type', async () => {
    await expect(create({ type: 2 })).rejects.toThrow(/400/);
  });
});

describe('auth request response poll', () => {
  it('returns the request for the correct access code and reflects approval', async () => {
    const { id, accessCode } = await create();

    const before = await poll(id, accessCode);
    expect(before.status).toBe(200);
    expect((await before.json() as any).requestApproved).toBe(false);

    // A wrong access code is indistinguishable from "not found".
    expect((await poll(id, 'wrong-code')).status).toBe(404);

    // Approve, then the poll reflects it.
    const approve = await api('PUT', `/api/auth-requests/${id}`, token, {
      requestApproved: true, key: ENC_STRING, deviceIdentifier: session.account.deviceIdentifier,
    });
    expect(approve.status).toBe(200);
    expect((await (await poll(id, accessCode)).json() as any).requestApproved).toBe(true);
  });
});

describe('auth request update guards', () => {
  it('404s fetching an unknown auth request', async () => {
    expect((await api('GET', `/api/auth-requests/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('400s approving without an encrypted key', async () => {
    const { id } = await create();
    const res = await api('PUT', `/api/auth-requests/${id}`, token, { requestApproved: true });
    expect(res.status).toBe(400);
  });

  it('denies a request (no key required) and then rejects a second answer (409)', async () => {
    const { id } = await create();
    const denied = await api('PUT', `/api/auth-requests/${id}`, token, { requestApproved: false });
    expect(denied.status).toBe(200);
    expect((await denied.json() as any).requestApproved).toBe(false);

    const again = await api('PUT', `/api/auth-requests/${id}`, token, {
      requestApproved: true, key: ENC_STRING,
    });
    expect(again.status).toBe(409);
  });

  it('400s answering a superseded request for the same device', async () => {
    const deviceIdentifier = crypto.randomUUID();
    const first = await create({ deviceIdentifier });
    await create({ deviceIdentifier }); // a newer request supersedes the first
    const res = await api('PUT', `/api/auth-requests/${first.id}`, token, {
      requestApproved: true, key: ENC_STRING,
    });
    expect(res.status).toBe(400);
  });
});
