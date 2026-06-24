import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';
import { SELF } from 'cloudflare:test';

// Device key/token endpoints and the /api/sync cache path, exercised through the
// real authenticated API. No mocks.
let session: Session;
let token: string;

function putAuthed(path: string, body?: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'PUT',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: body ?? '{}',
  });
}

beforeAll(async () => {
  session = await authenticate('devicessync');
  token = session.accessToken;
});

describe('device key/token branches', () => {
  it('404s updating keys for an unknown device', async () => {
    const res = await putAuthed(`/api/devices/identifier/${crypto.randomUUID()}/keys`, JSON.stringify({ encryptedPublicKey: 'x', encryptedUserKey: 'y' }));
    expect(res.status).toBe(404);
  });

  it('200s clearing a device token', async () => {
    expect((await putAuthed(`/api/devices/identifier/${session.account.deviceIdentifier}/clear-token`)).status).toBe(200);
  });
});

describe('sync cache path', () => {
  it('serves a second identical sync request from cache', async () => {
    const path = '/api/sync?excludeDomains=1&excludeSends=1';
    const first = await api('GET', path, token);
    expect(first.status).toBe(200);
    // A second identical request (same revision, same params) is served from the
    // edge cache, exercising the cache-hit return path.
    const second = await api('GET', path, token);
    expect(second.status).toBe(200);
    const body = (await second.json()) as any;
    expect(body.object).toBe('sync');
  });
});
