import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// handleUpdateAuthRequest edge branches: a non-existent request 404s, and
// approving with an invalid encrypted key is rejected. Real D1, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('authrequpdate');
  token = session.accessToken;
});

describe('auth request update edges', () => {
  it('404s updating a non-existent auth request', async () => {
    const res = await api('PUT', `/api/auth-requests/${crypto.randomUUID()}`, token, { requestApproved: false });
    expect(res.status).toBe(404);
  });

  it('400s approving with an invalid encrypted key', async () => {
    // Create a real auth request for this user, then approve with a bad key.
    const create = await SELF.fetch(url('/api/auth-requests'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        email: session.account.email,
        publicKey: btoa('auth-request-public-key'),
        accessCode: 'access-code-xyz',
        deviceIdentifier: crypto.randomUUID(),
        deviceType: 10,
        type: 0,
      }),
    });
    expect(create.status).toBe(200);
    const id = ((await create.json()) as any).id as string;

    const res = await api('PUT', `/api/auth-requests/${id}`, token, {
      requestApproved: true,
      key: 'not-a-valid-encrypted-string',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('encrypted');
  });
});
