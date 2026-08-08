import { describe, expect, it, vi } from 'vitest';
import { deleteInvalidInvites, deleteInvite } from '@/lib/api/admin';
import { deleteAuthorizedDevices } from '@/lib/api/auth';

const ok = () => Promise.resolve(new Response(null, { status: 200 }));
const bad = () => Promise.resolve(new Response(null, { status: 500 }));

describe('api/admin invite deletion', () => {
  it('deleteInvite hits the code-scoped endpoint with the master-password hash and resolves on success', async () => {
    const authedFetch = vi.fn(ok);
    await deleteInvite(authedFetch as any, 'CODE 1', 'mph');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/invites/CODE%201');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'mph' });
  });

  it('deleteInvite throws on a non-ok response', async () => {
    await expect(deleteInvite(vi.fn(bad) as any, 'CODE1', 'mph')).rejects.toThrow('Delete invite failed');
  });

  it('deleteInvalidInvites targets the invalid scope with the master-password hash and resolves on success', async () => {
    const authedFetch = vi.fn(ok);
    await deleteInvalidInvites(authedFetch as any, 'mph');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/invites?scope=invalid');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ masterPasswordHash: 'mph' });
  });

  it('deleteInvalidInvites throws on a non-ok response', async () => {
    await expect(deleteInvalidInvites(vi.fn(bad) as any, 'mph')).rejects.toThrow('Delete invalid invites failed');
  });
});

describe('api/auth deleteAuthorizedDevices', () => {
  it('dedupes, skips blank identifiers, and routes by hasStoredDevice', async () => {
    const authedFetch = vi.fn(ok);
    await deleteAuthorizedDevices(authedFetch as any, [
      { identifier: 'a', hasStoredDevice: false }, // -> revoke trust
      { identifier: 'b', hasStoredDevice: true }, // -> delete device
      { identifier: 'a', hasStoredDevice: false }, // duplicate, collapsed
      { identifier: '   ', hasStoredDevice: true }, // blank, filtered out
      { identifier: undefined as any, hasStoredDevice: true }, // nullish -> `|| ''` fallback, filtered
    ]);
    const urls = authedFetch.mock.calls.map((call) => call[0]);
    expect(urls).toContain('/api/devices/authorized/a'); // revokeAuthorizedDeviceTrust
    expect(urls).toContain('/api/devices/b'); // deleteAuthorizedDevice
    expect(authedFetch).toHaveBeenCalledTimes(2);
  });
});
