import { beforeAll, describe, expect, it } from 'vitest';
import { createCipher } from '@/lib/api/vault';
import {
  getCachedVaultCoreSnapshot,
  invalidateVaultCoreSyncSnapshot,
  loadVaultCoreSyncSnapshot,
  saveVaultCoreSyncSnapshot,
} from '@/lib/api/vault-sync';
import { importCipherToDraft } from '@/lib/app-support';
import type { VaultCoreSnapshot } from '@/lib/vault-cache';
import { type ContractSession, freshCacheKey, registerAndLogin } from './helpers';

// Vault-core sync snapshot caching driven through the real webapp api client
// against the real worker. workerd has NO IndexedDB, so vault-cache degrades to
// an in-memory-only cache; these tests assert the real in-memory behavior:
// /api/sync fetch -> snapshot, same-key cache hit, manual save, and invalidate.
let ctx: ContractSession;

beforeAll(async () => {
  ctx = await registerAndLogin('vault-sync');
});

describe('vault-core sync snapshot contract', () => {
  it('loads a snapshot from /api/sync containing a freshly created cipher', async () => {
    const created = await createCipher(
      ctx.authedFetch,
      ctx.session,
      importCipherToDraft(
        { type: 1, name: 'SyncTarget', login: { username: 'syncuser', password: 'syncpass' } },
        null
      )
    );
    expect(created.id).toBeTruthy();

    const key = freshCacheKey('sync-load');
    const snapshot = await loadVaultCoreSyncSnapshot(ctx.authedFetch, key);

    expect(Array.isArray(snapshot.ciphers)).toBe(true);
    expect(Array.isArray(snapshot.folders)).toBe(true);
    expect(Array.isArray(snapshot.sends)).toBe(true);
    expect(snapshot.ciphers.some((c) => c.id === created.id)).toBe(true);
  });

  it('serves a second same-key load from the in-memory cache (identity match)', async () => {
    const key = freshCacheKey('sync-cache');
    const first = await loadVaultCoreSyncSnapshot(ctx.authedFetch, key);

    // Same revision + same key => returns the exact cached snapshot object.
    const second = await loadVaultCoreSyncSnapshot(ctx.authedFetch, key);
    expect(second).toBe(first);

    // getCachedVaultCoreSnapshot exposes the same in-memory snapshot.
    const cached = await getCachedVaultCoreSnapshot(key);
    expect(cached).toBe(first);
  });

  it('returns null from getCachedVaultCoreSnapshot for an unknown key', async () => {
    // No IndexedDB fallback in workerd, so an unseen key has nothing cached.
    const cached = await getCachedVaultCoreSnapshot(freshCacheKey('sync-unknown'));
    expect(cached).toBeNull();
  });

  it('saveVaultCoreSyncSnapshot populates the in-memory cache', async () => {
    const key = freshCacheKey('sync-save');
    const snapshot: VaultCoreSnapshot = { ciphers: [], folders: [], sends: [] };

    await saveVaultCoreSyncSnapshot(key, snapshot, Date.now());

    const cached = await getCachedVaultCoreSnapshot(key);
    expect(cached).not.toBeNull();
    expect(cached).toEqual(snapshot);
  });

  it('invalidateVaultCoreSyncSnapshot clears the in-memory cache', async () => {
    const key = freshCacheKey('sync-invalidate');
    await loadVaultCoreSyncSnapshot(ctx.authedFetch, key);
    expect(await getCachedVaultCoreSnapshot(key)).not.toBeNull();

    await invalidateVaultCoreSyncSnapshot(key);

    // With no IndexedDB persistence, invalidation leaves nothing behind.
    expect(await getCachedVaultCoreSnapshot(key)).toBeNull();
  });
});
