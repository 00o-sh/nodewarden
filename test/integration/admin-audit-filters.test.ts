import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, createFolder } from './helpers';

// The admin audit-log listing's filter branches (category / level / from / to),
// which the unfiltered listing test doesn't reach. Real D1, no mocks.
let admin: Session;
let token: string;

beforeAll(async () => {
  admin = await authenticate('auditfilter');
  token = admin.accessToken;
  // Generate a security-level 'data' audit event: folder.delete.
  const folder = await createFolder(token);
  expect((await api('DELETE', `/api/folders/${folder.id}`, token)).status).toBe(204);
});

async function listLogs(query: string): Promise<any> {
  const res = await api('GET', `/api/admin/logs${query}`, token);
  expect(res.status).toBe(200);
  return res.json();
}

describe('admin audit-log filters', () => {
  it('filters by category', async () => {
    const body = await listLogs('?category=data');
    expect(Array.isArray(body.data)).toBe(true);
    for (const log of body.data) expect(log.category).toBe('data');
  });

  it('filters by level', async () => {
    const body = await listLogs('?level=security');
    for (const log of body.data) expect(log.level).toBe('security');
  });

  it('filters by a from/to time window', async () => {
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const within = await listLogs(`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(within.data.length).toBeGreaterThanOrEqual(1);

    // A window entirely in the future contains nothing.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const empty = await listLogs(`?from=${encodeURIComponent(future)}`);
    expect(empty.data.length).toBe(0);
  });

  it('filters by a free-text query', async () => {
    const body = await listLogs('?q=folder.delete');
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const log of body.data) expect(String(log.action)).toContain('folder.delete');
  });
});
