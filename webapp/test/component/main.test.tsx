import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The app entry point. It builds the QueryClient, renders <App/> into #root, and
// bootstraps i18n + the service worker. Everything with side effects is mocked
// so importing the module exercises the bootstrap wiring without a real render.

const render = vi.fn();
vi.mock('preact', async (importOriginal) => {
  const actual = await importOriginal<typeof import('preact')>();
  return { ...actual, render: (...args: unknown[]) => render(...args) };
});

const initI18n = vi.fn<() => Promise<void>>();
vi.mock('@/lib/i18n', () => ({ initI18n: () => initI18n() }));

const registerNodeWardenServiceWorker = vi.fn();
vi.mock('@/lib/pwa', () => ({
  registerNodeWardenServiceWorker: () => registerNodeWardenServiceWorker(),
}));

vi.mock('@/App', () => ({ default: () => null }));

describe('main entry point', () => {
  beforeEach(() => {
    render.mockReset();
    registerNodeWardenServiceWorker.mockReset();
    initI18n.mockReset();
    initI18n.mockResolvedValue(undefined);
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the app into #root and bootstraps i18n + the service worker', async () => {
    await import('@/main');

    // i18n init kicks off immediately.
    expect(initI18n).toHaveBeenCalledTimes(1);

    // renderApp runs after initI18n settles (its .finally); wait for it.
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    const root = document.getElementById('root');
    // Rendered into #root, which is marked translate="no".
    expect(render.mock.calls[0][1]).toBe(root);
    expect(root?.getAttribute('translate')).toBe('no');

    // Service worker is registered as part of the same post-init step.
    await vi.waitFor(() => expect(registerNodeWardenServiceWorker).toHaveBeenCalledTimes(1));
  });

  // NOTE: main.tsx uses `void initI18n().finally(...)` with no `.catch`, so a
  // failed i18n load rejects unhandled (the app still renders via `finally`).
  // Not exercised here to avoid an unhandled rejection in the suite; flagged in
  // the PR as a minor source follow-up.
});
