// Contract-test setup: make the webapp's browser-oriented api client runnable
// inside the Workers runtime and route its requests to the real worker.
//
// 1. The frontend api modules call the GLOBAL `fetch` with same-origin relative
//    paths ("/identity/...", "/api/..."). We override `fetch` to resolve those
//    against a fixed origin and forward them to the worker under test (SELF),
//    injecting the same-origin Origin + client-IP headers the worker requires
//    (mirroring test/integration/helpers.ts).
// 2. The client also touches `localStorage` (device identifier, session) which
//    workerd does not provide, so we install a minimal in-memory shim.
import { SELF } from 'cloudflare:test';

// Single logical origin so the worker's same-origin write checks pass and a
// deterministic client IP is always present for rate limiting.
export const CONTRACT_ORIGIN = 'https://vault.test';
const CLIENT_IP = '203.0.113.9';

const originalFetch = globalThis.fetch;

globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const absolute = new URL(rawUrl, CONTRACT_ORIGIN);

  // Only intercept same-origin app traffic; let anything else through.
  if (absolute.origin !== CONTRACT_ORIGIN) {
    return originalFetch(input as RequestInfo, init);
  }

  const headers = new Headers(init.headers || {});
  if (!headers.has('Origin')) headers.set('Origin', CONTRACT_ORIGIN);
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', CLIENT_IP);

  return SELF.fetch(absolute.toString(), { ...init, headers });
}) as typeof fetch;

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
