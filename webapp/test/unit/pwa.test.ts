import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PwaModule = typeof import('@/lib/pwa');

async function freshModule(): Promise<PwaModule> {
  vi.resetModules();
  return import('@/lib/pwa');
}

function setReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get: () => value,
  });
}

function installServiceWorker(register: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register },
  });
}

function removeServiceWorker(): void {
  // jsdom does not define serviceWorker by default; ensure it is absent.
  // @ts-expect-error deleting the optional property for the guard branch
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
}

describe('registerNodeWardenServiceWorker', () => {
  const originalReadyState = Object.getOwnPropertyDescriptor(document, 'readyState');

  beforeEach(() => {
    removeServiceWorker();
    setReadyState('complete');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    removeServiceWorker();
    if (originalReadyState) {
      Object.defineProperty(document, 'readyState', originalReadyState);
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('does nothing when serviceWorker is unsupported', async () => {
    removeServiceWorker();
    const mod = await freshModule();
    // No serviceWorker on navigator; should simply return without throwing.
    expect(() => mod.registerNodeWardenServiceWorker()).not.toThrow();
  });

  it('does nothing in DEV mode even when serviceWorker is supported', async () => {
    vi.stubEnv('DEV', true);
    const register = vi.fn().mockResolvedValue({});
    installServiceWorker(register);
    const mod = await freshModule();
    mod.registerNodeWardenServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers immediately when document is already complete (prod)', async () => {
    vi.stubEnv('DEV', false);
    setReadyState('complete');
    const register = vi.fn().mockResolvedValue({});
    installServiceWorker(register);
    const mod = await freshModule();
    mod.registerNodeWardenServiceWorker();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('swallows a rejected registration promise', async () => {
    vi.stubEnv('DEV', false);
    setReadyState('complete');
    const register = vi.fn().mockRejectedValue(new Error('no sw'));
    installServiceWorker(register);
    const mod = await freshModule();
    expect(() => mod.registerNodeWardenServiceWorker()).not.toThrow();
    // Let the rejected promise settle to confirm the .catch handles it.
    await Promise.resolve();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('defers registration to the window load event when not yet complete', async () => {
    vi.stubEnv('DEV', false);
    setReadyState('loading');
    const register = vi.fn().mockResolvedValue({});
    installServiceWorker(register);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const mod = await freshModule();

    mod.registerNodeWardenServiceWorker();
    // Registration must not happen until load fires.
    expect(register).not.toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledWith('load', expect.any(Function), { once: true });

    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });
});
