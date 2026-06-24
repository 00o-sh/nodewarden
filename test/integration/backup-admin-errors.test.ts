import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, login, newAccount, register, url } from './helpers';

// Authorization, validation, and no-destination error paths of the admin backup
// handlers — the orchestration branches the happy-path remote tests don't hit.
let admin: Session;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  admin = await authenticate('bkerr');
  adminToken = admin.accessToken;

  const invite = (await (await api('POST', '/api/admin/invites', adminToken, {})).json()) as any;
  const user = newAccount('bkerr-user');
  expect((await register(user, invite.code)).status).toBe(200);
  userToken = ((await (await login(user)).json()) as any).access_token;
});

// Admin endpoints, as [method, path] with a JSON body where relevant.
const endpoints: Array<{ method: string; path: string; body?: unknown }> = [
  { method: 'POST', path: '/api/admin/backup/run', body: {} },
  { method: 'GET', path: '/api/admin/backup/remote' },
  { method: 'POST', path: '/api/admin/backup/remote/download', body: { path: 'x.zip' } },
  { method: 'GET', path: '/api/admin/backup/remote/integrity?path=x.zip' },
  { method: 'DELETE', path: '/api/admin/backup/remote/file?path=x.zip' },
  { method: 'POST', path: '/api/admin/backup/remote/restore', body: { path: 'x.zip' } },
  { method: 'PUT', path: '/api/admin/backup/settings', body: { destinations: [] } },
  { method: 'GET', path: '/api/admin/backup/settings/repair' },
  { method: 'POST', path: '/api/admin/backup/settings/repair', body: { destinations: [] } },
];

describe('admin backup authorization', () => {
  it('forbids a non-admin from every admin backup endpoint (403)', async () => {
    for (const ep of endpoints) {
      const res = await api(ep.method, ep.path, userToken, ep.body);
      expect(res.status, `${ep.method} ${ep.path}`).toBe(403);
    }
  });
});

describe('admin backup validation', () => {
  it('rejects a run with an invalid JSON body (400)', async () => {
    const res = await SELF.fetch(url('/api/admin/backup/run'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }),
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a remote restore with an invalid JSON body (400)', async () => {
    const res = await SELF.fetch(url('/api/admin/backup/remote/restore'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid settings and repair payloads (400)', async () => {
    expect((await api('PUT', '/api/admin/backup/settings', adminToken, { destinations: 'nope', masterPasswordHash: admin.account.masterPasswordHash })).status).toBe(400);
    expect((await api('POST', '/api/admin/backup/settings/repair', adminToken, { destinations: 'nope', masterPasswordHash: admin.account.masterPasswordHash })).status).toBe(400);
  });
});

describe('admin backup missing-destination and bad-path branches', () => {
  it('409s remote ops that reference an unknown destination', async () => {
    const ghost = crypto.randomUUID();
    expect((await api('GET', `/api/admin/backup/remote?destinationId=${ghost}`, adminToken)).status).toBe(409);
    expect((await api('POST', '/api/admin/backup/remote/download', adminToken, { path: 'a.zip', destinationId: ghost, masterPasswordHash: admin.account.masterPasswordHash })).status).toBe(409);
    expect((await api('GET', `/api/admin/backup/remote/integrity?path=a.zip&destinationId=${ghost}`, adminToken)).status).toBe(409);
    expect((await api('DELETE', `/api/admin/backup/remote/file?path=a.zip&destinationId=${ghost}`, adminToken)).status).toBe(409);
  });

  it('409s download/integrity/delete for a non-zip path before touching the remote', async () => {
    expect((await api('POST', '/api/admin/backup/remote/download', adminToken, { path: 'notes.txt', masterPasswordHash: admin.account.masterPasswordHash })).status).toBe(409);
    expect((await api('GET', '/api/admin/backup/remote/integrity?path=notes.txt', adminToken)).status).toBe(409);
    expect((await api('DELETE', '/api/admin/backup/remote/file?path=notes.txt', adminToken)).status).toBe(409);
  });

  it('fails a configured run against an unknown destination (500)', async () => {
    const res = await api('POST', '/api/admin/backup/run', adminToken, { destinationId: crypto.randomUUID(), masterPasswordHash: admin.account.masterPasswordHash });
    expect(res.status).toBe(500);
  });
});
