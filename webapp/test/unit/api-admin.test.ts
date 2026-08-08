import { describe, expect, it, vi } from 'vitest';
import {
  clearAuditLogs,
  createInvite,
  deleteAllInvites,
  deleteUser,
  getAuditLogSettings,
  listAdminInvites,
  listAdminUsers,
  listAuditLogs,
  saveAuditLogSettings,
  setUserStatus,
} from '@/lib/api/admin';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const emptyOk = () => Promise.resolve(new Response(null, { status: 200 }));
const fail = () => Promise.resolve(new Response(null, { status: 500 }));

describe('api/admin listAdminUsers', () => {
  it('returns the data array on success', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ data: [{ id: 'u1' }, { id: 'u2' }] }));
    const users = await listAdminUsers(authedFetch as any);
    expect(authedFetch).toHaveBeenCalledWith('/api/admin/users');
    expect(users).toEqual([{ id: 'u1' }, { id: 'u2' }]);
  });

  it('returns an empty array when the body has no data', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    expect(await listAdminUsers(authedFetch as any)).toEqual([]);
  });

  it('throws when the response is not ok', async () => {
    await expect(listAdminUsers(vi.fn(fail) as any)).rejects.toThrow('Failed to load users');
  });
});

describe('api/admin listAdminInvites', () => {
  it('requests inactive invites too and returns data', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ data: [{ code: 'A' }] }));
    const invites = await listAdminInvites(authedFetch as any);
    expect(authedFetch).toHaveBeenCalledWith('/api/admin/invites?includeInactive=true');
    expect(invites).toEqual([{ code: 'A' }]);
  });

  it('throws when the response is not ok', async () => {
    await expect(listAdminInvites(vi.fn(fail) as any)).rejects.toThrow('Failed to load invites');
  });
});

describe('api/admin createInvite', () => {
  it('POSTs the requested expiry window with the master-password hash', async () => {
    const authedFetch = vi.fn(emptyOk);
    await createInvite(authedFetch as any, 48, 'mph');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/invites');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ expiresInHours: 48, masterPasswordHash: 'mph' });
  });

  it('throws when the response is not ok', async () => {
    await expect(createInvite(vi.fn(fail) as any, 1, 'mph')).rejects.toThrow('Create invite failed');
  });
});

describe('api/admin deleteAllInvites', () => {
  it('DELETEs the whole invite collection with the master-password hash', async () => {
    const authedFetch = vi.fn(emptyOk);
    await deleteAllInvites(authedFetch as any, 'mph');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/invites');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'mph' });
  });

  it('throws when the response is not ok', async () => {
    await expect(deleteAllInvites(vi.fn(fail) as any, 'mph')).rejects.toThrow('Delete all invites failed');
  });
});

describe('api/admin setUserStatus', () => {
  it('PUTs the status to the encoded user endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await setUserStatus(authedFetch as any, 'user id/1', 'banned', 'mph');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/users/user%20id%2F1/status');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ status: 'banned', masterPasswordHash: 'mph' });
  });

  it('throws when the response is not ok', async () => {
    await expect(setUserStatus(vi.fn(fail) as any, 'u1', 'active', 'mph')).rejects.toThrow('Update user status failed');
  });
});

describe('api/admin deleteUser', () => {
  it('DELETEs the encoded user endpoint with the master-password hash', async () => {
    const authedFetch = vi.fn(emptyOk);
    await deleteUser(authedFetch as any, 'u 1', 'mph');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/users/u%201');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'mph' });
  });

  it('throws when the response is not ok', async () => {
    await expect(deleteUser(vi.fn(fail) as any, 'u1', 'mph')).rejects.toThrow('Delete user failed');
  });
});

describe('api/admin listAuditLogs', () => {
  it('applies defaults and omits "all" category/level plus blank query', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ data: [{ id: 'l1' }], total: 1, limit: 50, offset: 0, hasMore: false }));
    const result = await listAuditLogs(authedFetch as any, { category: 'all', level: 'all', q: '   ' });
    const url = authedFetch.mock.calls[0][0] as string;
    expect(url).toBe('/api/admin/logs?limit=50&offset=0');
    expect(result).toEqual({ logs: [{ id: 'l1' }], total: 1, limit: 50, offset: 0, hasMore: false });
  });

  it('serializes every provided filter and trims the query', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ data: [], total: 0 }));
    await listAuditLogs(authedFetch as any, {
      limit: 10,
      offset: 20,
      category: 'auth',
      level: 'warn',
      q: '  hello  ',
      from: '2024-01-01',
      to: '2024-02-01',
    } as any);
    const url = new URL(authedFetch.mock.calls[0][0] as string, 'https://x');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('offset')).toBe('20');
    expect(url.searchParams.get('category')).toBe('auth');
    expect(url.searchParams.get('level')).toBe('warn');
    expect(url.searchParams.get('q')).toBe('hello');
    expect(url.searchParams.get('from')).toBe('2024-01-01');
    expect(url.searchParams.get('to')).toBe('2024-02-01');
  });

  it('falls back to filter/default paging when the body omits them', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    const result = await listAuditLogs(authedFetch as any, { limit: 25, offset: 5 });
    expect(result).toEqual({ logs: [], total: 0, limit: 25, offset: 5, hasMore: false });
  });

  it('throws when the response is not ok', async () => {
    await expect(listAuditLogs(vi.fn(fail) as any)).rejects.toThrow('Failed to load audit logs');
  });
});

describe('api/admin getAuditLogSettings', () => {
  it('normalizes present values', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ retentionDays: 30, maxEntries: 100 }));
    expect(await getAuditLogSettings(authedFetch as any)).toEqual({ retentionDays: 30, maxEntries: 100 });
    expect(authedFetch).toHaveBeenCalledWith('/api/admin/logs/settings');
  });

  it('defaults missing values to null', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    expect(await getAuditLogSettings(authedFetch as any)).toEqual({ retentionDays: null, maxEntries: null });
  });

  it('throws when the response is not ok', async () => {
    await expect(getAuditLogSettings(vi.fn(fail) as any)).rejects.toThrow('Failed to load audit log settings');
  });
});

describe('api/admin saveAuditLogSettings', () => {
  it('PUTs the settings and returns the normalized echo', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ retentionDays: 7, maxEntries: null }));
    const result = await saveAuditLogSettings(authedFetch as any, { retentionDays: 7, maxEntries: null });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/logs/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ retentionDays: 7, maxEntries: null });
    expect(result).toEqual({ retentionDays: 7, maxEntries: null });
  });

  it('throws when the response is not ok', async () => {
    await expect(
      saveAuditLogSettings(vi.fn(fail) as any, { retentionDays: null, maxEntries: null })
    ).rejects.toThrow('Failed to save audit log settings');
  });
});

describe('api/admin clearAuditLogs', () => {
  it('returns the deleted count', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ deleted: 12 }));
    expect(await clearAuditLogs(authedFetch as any)).toBe(12);
    expect(authedFetch).toHaveBeenCalledWith('/api/admin/logs', { method: 'DELETE' });
  });

  it('coerces a missing count to 0', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    expect(await clearAuditLogs(authedFetch as any)).toBe(0);
  });

  it('throws when the response is not ok', async () => {
    await expect(clearAuditLogs(vi.fn(fail) as any)).rejects.toThrow('Failed to clear audit logs');
  });
});
