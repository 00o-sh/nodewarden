import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the persistence layer and the revision-date probe so we exercise only the
// request-shaping + cache-orchestration logic in vault-sync.
const loadCachedVaultCoreSnapshot = vi.fn();
const saveCachedVaultCoreSnapshot = vi.fn();
const clearCachedVaultCoreSnapshot = vi.fn();
const getVaultRevisionDate = vi.fn();

vi.mock('@/lib/vault-cache', () => ({
  loadCachedVaultCoreSnapshot: (...a: unknown[]) => loadCachedVaultCoreSnapshot(...a),
  saveCachedVaultCoreSnapshot: (...a: unknown[]) => saveCachedVaultCoreSnapshot(...a),
  clearCachedVaultCoreSnapshot: (...a: unknown[]) => clearCachedVaultCoreSnapshot(...a),
}));
vi.mock('@/lib/api/auth', () => ({
  getVaultRevisionDate: (...a: unknown[]) => getVaultRevisionDate(...a),
}));

import {
  getCachedVaultCoreSnapshot,
  invalidateVaultCoreSyncSnapshot,
  loadVaultCoreSyncSnapshot,
  saveVaultCoreSyncSnapshot,
} from '@/lib/api/vault-sync';

let keyCounter = 0;
const uniqueKey = () => `k-${keyCounter++}`;

beforeEach(() => {
  vi.clearAllMocks();
  loadCachedVaultCoreSnapshot.mockResolvedValue(null);
  saveCachedVaultCoreSnapshot.mockResolvedValue(undefined);
  clearCachedVaultCoreSnapshot.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe('loadVaultCoreSyncSnapshot', () => {
  it('returns an empty snapshot for a blank cache key without touching the network', async () => {
    const authedFetch = vi.fn();
    expect(await loadVaultCoreSyncSnapshot(authedFetch as any, '   ')).toEqual({
      ciphers: [],
      folders: [],
      sends: [],
    });
    expect(authedFetch).not.toHaveBeenCalled();
    expect(getVaultRevisionDate).not.toHaveBeenCalled();
  });

  it('fetches /api/sync with no-store caching and normalizes the body', async () => {
    getVaultRevisionDate.mockResolvedValue(1234);
    const authedFetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ciphers: [{ id: 'c1' }], folders: null, sends: [{ id: 's1' }] }), {
          status: 200,
        })
      )
    );
    const snapshot = await loadVaultCoreSyncSnapshot(authedFetch as any, uniqueKey());
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/sync');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toMatchObject({ 'Cache-Control': 'no-cache', Pragma: 'no-cache' });
    // folders was null -> normalized to [].
    expect(snapshot).toEqual({ ciphers: [{ id: 'c1' }], folders: [], sends: [{ id: 's1' }] });
    // Successful fetch persists the snapshot with its revision stamp.
    expect(saveCachedVaultCoreSnapshot).toHaveBeenCalledWith(expect.any(String), 1234, snapshot);
  });

  it('serves the persisted snapshot when the revision stamp is unchanged, skipping /api/sync', async () => {
    const key = uniqueKey();
    getVaultRevisionDate.mockResolvedValue(555);
    loadCachedVaultCoreSnapshot.mockResolvedValue({
      revisionStamp: 555,
      snapshot: { ciphers: [{ id: 'cached' }], folders: [], sends: [] },
    });
    const authedFetch = vi.fn();
    const snapshot = await loadVaultCoreSyncSnapshot(authedFetch as any, key);
    expect(snapshot.ciphers).toEqual([{ id: 'cached' }]);
    // No /api/sync call since the cached revision matched.
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it('falls back to the cached snapshot when the sync request fails', async () => {
    const key = uniqueKey();
    getVaultRevisionDate.mockResolvedValue(9);
    loadCachedVaultCoreSnapshot.mockResolvedValue({
      revisionStamp: 1, // different stamp forces a fetch attempt
      snapshot: { ciphers: [{ id: 'stale' }], folders: [], sends: [] },
    });
    const authedFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    const snapshot = await loadVaultCoreSyncSnapshot(authedFetch as any, key);
    expect(snapshot.ciphers).toEqual([{ id: 'stale' }]);
  });

  it('rethrows when the sync request fails and there is no cached fallback', async () => {
    getVaultRevisionDate.mockRejectedValue(new Error('revision boom'));
    const authedFetch = vi.fn();
    await expect(loadVaultCoreSyncSnapshot(authedFetch as any, uniqueKey())).rejects.toThrow('revision boom');
  });
});

describe('getCachedVaultCoreSnapshot', () => {
  it('returns null for a blank key', async () => {
    expect(await getCachedVaultCoreSnapshot('  ')).toBeNull();
  });

  it('returns null when nothing is cached', async () => {
    loadCachedVaultCoreSnapshot.mockResolvedValue(null);
    expect(await getCachedVaultCoreSnapshot(uniqueKey())).toBeNull();
  });

  it('normalizes and returns a persisted snapshot', async () => {
    loadCachedVaultCoreSnapshot.mockResolvedValue({
      revisionStamp: 3,
      snapshot: { ciphers: [{ id: 'c' }], folders: undefined, sends: null },
    });
    expect(await getCachedVaultCoreSnapshot(uniqueKey())).toEqual({
      ciphers: [{ id: 'c' }],
      folders: [],
      sends: [],
    });
  });
});

describe('saveVaultCoreSyncSnapshot', () => {
  it('ignores a blank cache key', async () => {
    await saveVaultCoreSyncSnapshot('  ', { ciphers: [], folders: [], sends: [] });
    expect(saveCachedVaultCoreSnapshot).not.toHaveBeenCalled();
  });

  it('persists with the provided positive revision stamp', async () => {
    const key = uniqueKey();
    await saveVaultCoreSyncSnapshot(key, { ciphers: [{ id: 'c' }], folders: [], sends: [] }, 42);
    expect(saveCachedVaultCoreSnapshot).toHaveBeenCalledWith(key, 42, {
      ciphers: [{ id: 'c' }],
      folders: [],
      sends: [],
    });
  });

  it('derives a stamp when the provided value is not positive', async () => {
    const key = uniqueKey();
    loadCachedVaultCoreSnapshot.mockResolvedValue({ revisionStamp: 77, snapshot: null });
    await saveVaultCoreSyncSnapshot(key, { ciphers: [], folders: [], sends: [] }, 0);
    expect(saveCachedVaultCoreSnapshot).toHaveBeenCalledWith(key, 77, expect.anything());
  });
});

describe('invalidateVaultCoreSyncSnapshot', () => {
  it('ignores a blank key', async () => {
    await invalidateVaultCoreSyncSnapshot('   ');
    expect(clearCachedVaultCoreSnapshot).not.toHaveBeenCalled();
  });

  it('clears the persisted snapshot for a real key', async () => {
    const key = uniqueKey();
    await invalidateVaultCoreSyncSnapshot(key);
    expect(clearCachedVaultCoreSnapshot).toHaveBeenCalledWith(key);
  });
});
