import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, login, newAccount, register } from './helpers';

// Every admin endpoint self-checks isAdmin and returns 403 for a non-admin
// caller. A single invited member (role: user) sweeps all of those guards in
// one place. Real D1, no mocks.
let admin: Session;
let memberToken: string;

beforeAll(async () => {
  admin = await authenticate('adminforbidden');
  const invite = (await (await api('POST', '/api/admin/invites', admin.accessToken, {})).json()) as any;
  const member = newAccount('member');
  const reg = await register(member, invite.code);
  expect(reg.status).toBe(200);
  const loginRes = await login(member);
  expect(loginRes.status).toBe(200);
  memberToken = ((await loginRes.json()) as any).access_token;
});

const uuid = () => crypto.randomUUID();

describe('admin endpoints reject non-admin callers (403)', () => {
  const cases: Array<[string, string]> = [
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/logs'],
    ['DELETE', '/api/admin/logs'],
    ['GET', '/api/admin/logs/settings'],
    ['PUT', '/api/admin/logs/settings'],
    ['GET', '/api/admin/invites'],
    ['POST', '/api/admin/invites'],
    ['DELETE', '/api/admin/invites'],
    ['GET', '/api/admin/backup/settings'],
    ['PUT', '/api/admin/backup/settings'],
    ['GET', '/api/admin/backup/settings/repair'],
    ['POST', '/api/admin/backup/settings/repair'],
    ['POST', '/api/admin/backup/run'],
    ['POST', '/api/admin/backup/export'],
    ['GET', '/api/admin/backup/remote'],
    ['POST', '/api/admin/backup/remote/download?path=x.zip'],
    ['GET', '/api/admin/backup/remote/integrity?path=x.zip'],
    ['DELETE', '/api/admin/backup/remote/file?path=x.zip'],
    ['POST', '/api/admin/backup/remote/restore'],
    ['POST', '/api/admin/backup/import'],
  ];

  it.each(cases)('%s %s -> 403', async (method, path) => {
    const res = await api(method, path, memberToken, method === 'GET' || method === 'DELETE' ? undefined : {});
    expect(res.status).toBe(403);
  });

  it('per-id admin endpoints reject non-admin callers', async () => {
    expect((await api('PUT', `/api/admin/users/${uuid()}/status`, memberToken, { status: 'active' })).status).toBe(403);
    expect((await api('DELETE', `/api/admin/users/${uuid()}`, memberToken)).status).toBe(403);
    expect((await api('DELETE', `/api/admin/invites/${uuid()}`, memberToken)).status).toBe(403);
    expect((await api('GET', `/api/admin/backup/blob?blobName=attachments/${uuid()}/${uuid()}.bin`, memberToken)).status).toBe(403);
  });
});
