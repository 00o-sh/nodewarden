import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type VaultCacheModule = typeof import('@/lib/vault-cache');

// vault-cache.ts caches the opened-database promise at module scope, so each
// test re-imports the module after (re)installing a fresh fake IndexedDB.
async function freshModule(): Promise<VaultCacheModule> {
  vi.resetModules();
  return import('@/lib/vault-cache');
}

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB stub. jsdom does not implement IndexedDB, and the
// project has no fake-indexeddb dependency, so we stub just enough of the API
// surface that vault-cache.ts exercises: open() with onupgradeneeded/onsuccess,
// objectStoreNames.contains, createObjectStore, transaction/objectStore, and
// store.get/put/delete returning request objects with onsuccess/onerror.
// ---------------------------------------------------------------------------

function microtask(fn: () => void): void {
  Promise.resolve().then(fn);
}

interface FakeRequest<T = unknown> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
}

function makeRequest<T>(): FakeRequest<T> {
  return {
    result: undefined as unknown as T,
    error: null,
    onsuccess: null,
    onerror: null,
  };
}

class FakeObjectStore {
  constructor(private data: Map<string, unknown>, private keyPath: string) {}

  get(key: string): FakeRequest {
    const req = makeRequest();
    microtask(() => {
      req.result = this.data.get(key);
      req.onsuccess?.();
    });
    return req;
  }

  put(record: Record<string, unknown>): FakeRequest {
    const req = makeRequest();
    microtask(() => {
      this.data.set(String(record[this.keyPath]), record);
      req.onsuccess?.();
    });
    return req;
  }

  delete(key: string): FakeRequest {
    const req = makeRequest();
    microtask(() => {
      this.data.delete(key);
      req.onsuccess?.();
    });
    return req;
  }
}

class FakeTransaction {
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor(private store: FakeObjectStore) {}
  objectStore(): FakeObjectStore {
    return this.store;
  }
}

class FakeDatabase {
  data = new Map<string, unknown>();
  storeNames = new Set<string>();
  objectStoreNames = {
    contains: (name: string) => this.storeNames.has(name),
  };
  createObjectStore(name: string, opts: { keyPath: string }): FakeObjectStore {
    this.storeNames.add(name);
    this.keyPath = opts.keyPath;
    return new FakeObjectStore(this.data, opts.keyPath);
  }
  private keyPath = 'cacheKey';
  transaction(): FakeTransaction {
    return new FakeTransaction(new FakeObjectStore(this.data, this.keyPath));
  }
}

interface FakeIndexedDbOptions {
  failOpen?: boolean;
  throwOnOpen?: boolean;
  failTransaction?: boolean;
}

function installFakeIndexedDb(options: FakeIndexedDbOptions = {}): FakeDatabase {
  const db = new FakeDatabase();
  const indexedDBStub = {
    open(): FakeRequest<FakeDatabase> {
      if (options.throwOnOpen) {
        throw new Error('open exploded');
      }
      const req = makeRequest<FakeDatabase>();
      microtask(() => {
        if (options.failOpen) {
          req.onerror?.();
          return;
        }
        req.result = db;
        // Simulate first-time upgrade so the object store gets created.
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  if (options.failTransaction) {
    db.transaction = () => {
      throw new Error('tx failed');
    };
  }
  vi.stubGlobal('indexedDB', indexedDBStub);
  return db;
}

const SNAPSHOT = {
  ciphers: [{ id: 'c1', type: 1 }],
  folders: [{ id: 'f1', name: 'enc-name' }],
  sends: [{ id: 's1', accessId: 'a1', type: 0 }],
} as never;

describe('vault-cache', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('without IndexedDB support', () => {
    it('save/load/clear resolve to null/undefined gracefully', async () => {
      // indexedDB stays undefined (jsdom default) — supportsIndexedDb() is false.
      const mod = await freshModule();
      await expect(mod.saveCachedVaultCoreSnapshot('key', 1, SNAPSHOT)).resolves.toBeUndefined();
      await expect(mod.loadCachedVaultCoreSnapshot('key')).resolves.toBeNull();
      await expect(mod.clearCachedVaultCoreSnapshot('key')).resolves.toBeUndefined();
    });
  });

  describe('input normalization', () => {
    it('returns null and skips work for blank cache keys', async () => {
      installFakeIndexedDb();
      const mod = await freshModule();
      expect(await mod.loadCachedVaultCoreSnapshot('   ')).toBeNull();
      // Save with blank key is a no-op; nothing is persisted.
      await mod.saveCachedVaultCoreSnapshot('  ', 1, SNAPSHOT);
      expect(await mod.loadCachedVaultCoreSnapshot('  ')).toBeNull();
    });

    it('trims the cache key when reading and writing', async () => {
      installFakeIndexedDb();
      const mod = await freshModule();
      await mod.saveCachedVaultCoreSnapshot('  vault-key  ', 5, SNAPSHOT);
      const record = await mod.loadCachedVaultCoreSnapshot('vault-key');
      expect(record?.cacheKey).toBe('vault-key');
    });
  });

  describe('round-trip with a fake IndexedDB', () => {
    it('saves and loads a snapshot record', async () => {
      installFakeIndexedDb();
      const mod = await freshModule();
      await mod.saveCachedVaultCoreSnapshot('vault-key', 42, SNAPSHOT);
      const record = await mod.loadCachedVaultCoreSnapshot('vault-key');
      expect(record).not.toBeNull();
      expect(record?.cacheKey).toBe('vault-key');
      expect(record?.revisionStamp).toBe(42);
      expect(typeof record?.savedAt).toBe('number');
      expect(record?.snapshot).toEqual(SNAPSHOT);
    });

    it('returns null for a missing key', async () => {
      installFakeIndexedDb();
      const mod = await freshModule();
      expect(await mod.loadCachedVaultCoreSnapshot('absent')).toBeNull();
    });

    it('clears a stored snapshot', async () => {
      installFakeIndexedDb();
      const mod = await freshModule();
      await mod.saveCachedVaultCoreSnapshot('vault-key', 7, SNAPSHOT);
      expect(await mod.loadCachedVaultCoreSnapshot('vault-key')).not.toBeNull();
      await mod.clearCachedVaultCoreSnapshot('vault-key');
      expect(await mod.loadCachedVaultCoreSnapshot('vault-key')).toBeNull();
    });

    it('overwrites an existing record on re-save', async () => {
      installFakeIndexedDb();
      const mod = await freshModule();
      await mod.saveCachedVaultCoreSnapshot('vault-key', 1, SNAPSHOT);
      await mod.saveCachedVaultCoreSnapshot('vault-key', 2, SNAPSHOT);
      const record = await mod.loadCachedVaultCoreSnapshot('vault-key');
      expect(record?.revisionStamp).toBe(2);
    });
  });

  describe('failure handling', () => {
    it('returns null when the database fails to open', async () => {
      installFakeIndexedDb({ failOpen: true });
      const mod = await freshModule();
      expect(await mod.loadCachedVaultCoreSnapshot('vault-key')).toBeNull();
      await expect(mod.saveCachedVaultCoreSnapshot('vault-key', 1, SNAPSHOT)).resolves.toBeUndefined();
    });

    it('returns null when indexedDB.open throws synchronously', async () => {
      installFakeIndexedDb({ throwOnOpen: true });
      const mod = await freshModule();
      expect(await mod.loadCachedVaultCoreSnapshot('vault-key')).toBeNull();
    });

    it('returns null when creating a transaction throws', async () => {
      installFakeIndexedDb({ failTransaction: true });
      const mod = await freshModule();
      expect(await mod.loadCachedVaultCoreSnapshot('vault-key')).toBeNull();
      await expect(mod.clearCachedVaultCoreSnapshot('vault-key')).resolves.toBeUndefined();
    });
  });
});
