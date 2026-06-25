import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PreloadModule = typeof import('@/lib/app-preload');

async function freshModule(): Promise<PreloadModule> {
  vi.resetModules();
  return import('@/lib/app-preload');
}

describe('preloadAuthenticatedWorkspace', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a promise for non-admin users', async () => {
    const mod = await freshModule();
    const result = mod.preloadAuthenticatedWorkspace(false);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeDefined();
  });

  it('memoizes the workspace preload across calls', async () => {
    const mod = await freshModule();
    const a = mod.preloadAuthenticatedWorkspace(false);
    const b = mod.preloadAuthenticatedWorkspace(false);
    // Same cached promise instance is returned, not a new allSettled batch.
    expect(a).toBe(b);
  });

  it('returns a distinct admin preload promise when isAdmin is true', async () => {
    const mod = await freshModule();
    const workspace = mod.preloadAuthenticatedWorkspace(false);
    const admin = mod.preloadAuthenticatedWorkspace(true);
    expect(admin).not.toBe(workspace);
    await expect(admin).resolves.toBeDefined();
  });

  it('memoizes the admin preload across admin calls', async () => {
    const mod = await freshModule();
    const a = mod.preloadAuthenticatedWorkspace(true);
    const b = mod.preloadAuthenticatedWorkspace(true);
    expect(a).toBe(b);
  });

  it('resolves to allSettled results (never rejects)', async () => {
    const mod = await freshModule();
    const settled = (await mod.preloadAuthenticatedWorkspace(true)) as PromiseSettledResult<unknown>[];
    expect(Array.isArray(settled)).toBe(true);
    for (const entry of settled) {
      expect(['fulfilled', 'rejected']).toContain(entry.status);
    }
  });
});

describe('preloadDemoExperience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a no-op canceller when window is undefined', async () => {
    const mod = await freshModule();
    const originalWindow = globalThis.window;
    // @ts-expect-error removing window to take the guard branch
    delete (globalThis as { window?: unknown }).window;
    try {
      const cancel = mod.preloadDemoExperience();
      expect(typeof cancel).toBe('function');
      // The canceller is the no-op (returns undefined) and must not throw.
      expect(cancel()).toBeUndefined();
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('schedules the first import after an initial delay and is idempotent', async () => {
    const mod = await freshModule();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    const cancelFirst = mod.preloadDemoExperience();
    expect(typeof cancelFirst).toBe('function');
    // Initial wait is scheduled.
    expect(setTimeoutSpy).toHaveBeenCalled();

    // A second call is a no-op because the singleton flag is already set; it
    // returns a no-op canceller and schedules nothing new.
    const callsAfterFirst = setTimeoutSpy.mock.calls.length;
    const cancelSecond = mod.preloadDemoExperience();
    expect(cancelSecond()).toBeUndefined();
    expect(setTimeoutSpy.mock.calls.length).toBe(callsAfterFirst);

    cancelFirst();
  });

  it('cancels the pending timer when the canceller runs before the delay elapses', async () => {
    const mod = await freshModule();
    const clearSpy = vi.spyOn(window, 'clearTimeout');

    const cancel = mod.preloadDemoExperience();
    // Cancel before advancing time: the active timer should be cleared.
    cancel();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('drives the import loop forward as timers advance', async () => {
    const mod = await freshModule();
    const cancel = mod.preloadDemoExperience();

    // Advance past the initial 120ms wait and a couple of inter-task waits.
    // The imports themselves are swallowed by .catch, so advancing must not throw.
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(180);
    await vi.advanceTimersByTimeAsync(180);

    cancel();
    expect(typeof cancel).toBe('function');
  });
});
