import { describe, expect, it, vi } from 'vitest';
import { deleteInvalidInvites, deleteInvite } from '@/lib/api/admin';
import { deleteAuthorizedDevices } from '@/lib/api/auth';

const ok = () => Promise.resolve(new Response(null, { status: 200 }));
const bad = () => Promise.resolve(new Response(null, { status: 500 }));

describe('api/admin invite deletion', () => {
  it('deleteInvite hits the code-scoped endpoint and resolves on success', async () => {
    const authedFetch = vi.fn(ok);
    await deleteInvite(authedFetch as any, 'CODE 1');
    expect(authedFetch).toHaveBeenCalledWith('/api/admin/invites/CODE%201', { method: 'DELETE' });
  });

  it('deleteInvite throws on a non-ok response', async () => {
    await expect(deleteInvite(vi.fn(bad) as any, 'CODE1')).rejects.toThrow('Delete invite failed');
  });

  it('deleteInvalidInvites targets the invalid scope and resolves on success', async () => {
    const authedFetch = vi.fn(ok);
    await deleteInvalidInvites(authedFetch as any);
    expect(authedFetch).toHaveBeenCalledWith('/api/admin/invites?scope=invalid', { method: 'DELETE' });
  });

  it('deleteInvalidInvites throws on a non-ok response', async () => {
    await expect(deleteInvalidInvites(vi.fn(bad) as any)).rejects.toThrow('Delete invalid invites failed');
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
