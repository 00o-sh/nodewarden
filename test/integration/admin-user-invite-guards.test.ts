import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Guard branches of the admin user/invite/audit-log management endpoints: the
// first-registered user is admin, so each guard is reachable with bad inputs.
// Real D1, no mocks.
let session: Session;
let token: string;
let adminId: string;

beforeAll(async () => {
  session = await authenticate('adminuserinvite');
  token = session.accessToken;
  adminId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;
});

function rawPut(path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'PUT',
    headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    body,
  });
}

describe('admin audit-log settings', () => {
  it('400s a malformed settings body', async () => {
    expect((await rawPut('/api/admin/logs/settings', '{bad')).status).toBe(400);
  });

  it('accepts an audit-log settings update', async () => {
    const res = await api('PUT', '/api/admin/logs/settings', token, { retentionDays: 30 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).object).toBe('auditLogSettings');
  });
});

describe('admin set user status', () => {
  it('400s a malformed body', async () => {
    expect((await rawPut(`/api/admin/users/${crypto.randomUUID()}/status`, '{bad')).status).toBe(400);
  });

  it('400s an invalid status value', async () => {
    expect((await api('PUT', `/api/admin/users/${crypto.randomUUID()}/status`, token, { status: 'sideways' })).status).toBe(400);
  });

  it('400s banning yourself', async () => {
    expect((await api('PUT', `/api/admin/users/${adminId}/status`, token, { status: 'banned' })).status).toBe(400);
  });

  it('404s an unknown user', async () => {
    expect((await api('PUT', `/api/admin/users/${crypto.randomUUID()}/status`, token, { status: 'active' })).status).toBe(404);
  });
});

describe('admin delete user', () => {
  it('400s deleting yourself', async () => {
    expect((await api('DELETE', `/api/admin/users/${adminId}`, token)).status).toBe(400);
  });

  it('404s deleting an unknown user', async () => {
    expect((await api('DELETE', `/api/admin/users/${crypto.randomUUID()}`, token)).status).toBe(404);
  });
});

describe('admin invites', () => {
  it('creates an invite', async () => {
    const res = await api('POST', '/api/admin/invites', token, {});
    expect(res.status).toBe(201);
    expect(typeof ((await res.json()) as any).code).toBe('string');
  });

  it('404s revoking an unknown invite', async () => {
    expect((await api('DELETE', `/api/admin/invites/${crypto.randomUUID()}`, token)).status).toBe(404);
  });
});
