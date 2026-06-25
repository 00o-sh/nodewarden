import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type NetworkStatusModule = typeof import('@/lib/network-status');

// network-status.ts keeps module-level state (currentStatus, probe caches,
// failure counters). To get a clean slate per test we reset the module registry
// and dynamically re-import.
async function freshModule(): Promise<NetworkStatusModule> {
  vi.resetModules();
  return import('@/lib/network-status');
}

function setNavigatorOnLine(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('network-status', () => {
  beforeEach(() => {
    setNavigatorOnLine(true);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    setNavigatorOnLine(true);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('browserReportsOffline', () => {
    it('returns false when navigator.onLine is true', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      expect(mod.browserReportsOffline()).toBe(false);
    });

    it('returns true when navigator.onLine is false', async () => {
      setNavigatorOnLine(false);
      const mod = await freshModule();
      expect(mod.browserReportsOffline()).toBe(true);
    });
  });

  describe('getInitialNetworkStatus', () => {
    it('is online when the browser is online', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      expect(mod.getInitialNetworkStatus()).toBe('online');
    });

    it('is offline when the browser is offline', async () => {
      setNavigatorOnLine(false);
      const mod = await freshModule();
      expect(mod.getInitialNetworkStatus()).toBe('offline');
    });
  });

  describe('getCurrentNetworkStatus / setCurrentNetworkStatus', () => {
    it('initializes from the browser status', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      expect(mod.getCurrentNetworkStatus()).toBe('online');
    });

    it('updates the current status', async () => {
      const mod = await freshModule();
      mod.setCurrentNetworkStatus('offline');
      expect(mod.getCurrentNetworkStatus()).toBe('offline');
    });

    it('notifies listeners on a status change', async () => {
      const mod = await freshModule();
      const listener = vi.fn();
      mod.subscribeNetworkStatus(listener);
      mod.setCurrentNetworkStatus('offline');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('offline');
    });

    it('does not notify when the status is unchanged', async () => {
      const mod = await freshModule();
      const listener = vi.fn();
      mod.subscribeNetworkStatus(listener);
      // Already 'online'; setting it again is a no-op.
      mod.setCurrentNetworkStatus('online');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('subscribeNetworkStatus', () => {
    it('returns an unsubscribe function that stops notifications', async () => {
      const mod = await freshModule();
      const listener = vi.fn();
      const unsubscribe = mod.subscribeNetworkStatus(listener);
      mod.setCurrentNetworkStatus('offline');
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
      mod.setCurrentNetworkStatus('online');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('supports multiple independent listeners', async () => {
      const mod = await freshModule();
      const a = vi.fn();
      const b = vi.fn();
      mod.subscribeNetworkStatus(a);
      mod.subscribeNetworkStatus(b);
      mod.setCurrentNetworkStatus('offline');
      expect(a).toHaveBeenCalledWith('offline');
      expect(b).toHaveBeenCalledWith('offline');
    });
  });

  describe('recordNodeWardenReachable', () => {
    it('marks the status online and notifies listeners', async () => {
      const mod = await freshModule();
      mod.setCurrentNetworkStatus('offline');
      const listener = vi.fn();
      mod.subscribeNetworkStatus(listener);
      mod.recordNodeWardenReachable();
      expect(mod.getCurrentNetworkStatus()).toBe('online');
      expect(listener).toHaveBeenCalledWith('online');
    });

    it('clears accumulated failures so a single later failure stays online', async () => {
      const mod = await freshModule();
      // One failure brings us toward offline but not past the threshold.
      mod.recordNodeWardenUnreachable();
      mod.recordNodeWardenReachable();
      // Failure counter reset; a single failure should not flip offline.
      mod.recordNodeWardenUnreachable();
      expect(mod.getCurrentNetworkStatus()).toBe('online');
    });
  });

  describe('recordNodeWardenUnreachable', () => {
    it('stays online after a single failure when the browser is online', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      mod.recordNodeWardenUnreachable();
      expect(mod.getCurrentNetworkStatus()).toBe('online');
    });

    it('flips offline once failures reach the threshold (2)', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      mod.recordNodeWardenUnreachable();
      mod.recordNodeWardenUnreachable();
      expect(mod.getCurrentNetworkStatus()).toBe('offline');
    });

    it('flips offline immediately when the browser reports offline', async () => {
      const mod = await freshModule();
      // Module initialized online; now the browser drops offline.
      setNavigatorOnLine(false);
      mod.recordNodeWardenUnreachable();
      expect(mod.getCurrentNetworkStatus()).toBe('offline');
    });
  });

  describe('probeNodeWardenService', () => {
    it('returns false and goes offline without fetching when the browser is offline', async () => {
      setNavigatorOnLine(false);
      const mod = await freshModule();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await mod.probeNodeWardenService();
      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mod.getCurrentNetworkStatus()).toBe('offline');
    });

    it('returns true and records reachable on a successful fetch', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
      const result = await mod.probeNodeWardenService();
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('/api/web-bootstrap?statusProbe=');
      expect(mod.getCurrentNetworkStatus()).toBe('online');
    });

    it('treats a 4xx/5xx HTTP response as reachable (online)', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      // A resolved fetch (even a 500) proves the server answered.
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      vi.stubGlobal('fetch', fetchMock);
      const result = await mod.probeNodeWardenService();
      expect(result).toBe(true);
      expect(mod.getCurrentNetworkStatus()).toBe('online');
    });

    it('returns false and counts a failure when fetch rejects', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
      vi.stubGlobal('fetch', fetchMock);
      const result = await mod.probeNodeWardenService();
      expect(result).toBe(false);
      // A single failure (browser online) is below the offline threshold.
      expect(mod.getCurrentNetworkStatus()).toBe('online');
    });

    it('flips offline after two consecutive rejected probes', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
      vi.stubGlobal('fetch', fetchMock);
      await mod.probeNodeWardenService();
      // Second probe must bypass the 5s result cache: advance the clock.
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
      await mod.probeNodeWardenService();
      expect(mod.getCurrentNetworkStatus()).toBe('offline');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent probes into a single in-flight request', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      let resolveFetch: (value: unknown) => void = () => {};
      const fetchMock = vi.fn().mockImplementation(
        () => new Promise((resolve) => { resolveFetch = resolve; })
      );
      vi.stubGlobal('fetch', fetchMock);
      const p1 = mod.probeNodeWardenService();
      const p2 = mod.probeNodeWardenService();
      resolveFetch({ ok: true, status: 200 });
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('serves the cached result within the cache window without re-fetching', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
      const first = await mod.probeNodeWardenService();
      expect(first).toBe(true);
      // Immediately probing again should hit the cache (lastProbeAt is recent).
      const second = await mod.probeNodeWardenService();
      expect(second).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('passes an abort signal and no-store cache option to fetch', async () => {
      setNavigatorOnLine(true);
      const mod = await freshModule();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
      await mod.probeNodeWardenService();
      const init = fetchMock.mock.calls[0][1];
      expect(init.method).toBe('GET');
      expect(init.cache).toBe('no-store');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
