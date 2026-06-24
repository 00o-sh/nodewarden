import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Admin backup settings/repair/run validation branches, exercised as an admin
// with malformed and well-formed bodies. Real D1, no mocks.
let token: string;
let masterPasswordHash: string;

beforeAll(async () => {
  const session: Session = await authenticate('adminbackuprepair');
  token = session.accessToken;
  masterPasswordHash = session.account.masterPasswordHash;
});

function raw(method: string, path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    body,
  });
}

describe('admin backup settings / repair / run validation', () => {
  it('400s a malformed settings update body', async () => {
    expect((await raw('PUT', '/api/admin/backup/settings', '{bad')).status).toBe(400);
  });

  it('400s a malformed repair body', async () => {
    expect((await raw('POST', '/api/admin/backup/settings/repair', '{bad')).status).toBe(400);
  });

  it('400s a repair body that is not an object', async () => {
    expect((await raw('POST', '/api/admin/backup/settings/repair', '"not-an-object"')).status).toBe(400);
  });

  it('repairs settings from a well-formed body', async () => {
    const res = await api('POST', '/api/admin/backup/settings/repair', token, { masterPasswordHash, destinations: [] });
    expect(res.status).toBe(200);
    expect(Array.isArray(((await res.json()) as any).destinations)).toBe(true);
  });

  it('400s a malformed run body', async () => {
    expect((await raw('POST', '/api/admin/backup/run', '{bad')).status).toBe(400);
  });
});
