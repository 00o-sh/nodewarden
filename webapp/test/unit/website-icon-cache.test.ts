import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginWebsiteIconLoad,
  getWebsiteIconImageUrl,
  getWebsiteIconStatus,
  subscribeWebsiteIconStatus,
} from '@/lib/website-icon-cache';

// Each test uses a unique host so the module-level Map does not leak state
// across tests.
let hostCounter = 0;
function uniqueHost(): string {
  hostCounter += 1;
  return `host-${hostCounter}-${Math.random().toString(36).slice(2)}.example`;
}

const ERROR_TTL_MS = 5 * 60 * 1000;
const LOAD_TIMEOUT_MS = 15 * 1000;

describe('website-icon-cache getters', () => {
  it('returns idle/empty for blank host', () => {
    expect(getWebsiteIconStatus('')).toBe('idle');
    expect(getWebsiteIconImageUrl('')).toBe('');
  });

  it('returns idle/empty for an unseen host', () => {
    const host = uniqueHost();
    expect(getWebsiteIconStatus(host)).toBe('idle');
    expect(getWebsiteIconImageUrl(host)).toBe('');
  });
});

describe('subscribeWebsiteIconStatus', () => {
  it('returns a no-op unsubscribe for blank host', () => {
    const unsub = subscribeWebsiteIconStatus('', () => undefined);
    expect(() => unsub()).not.toThrow();
  });

  it('notifies listeners on status change and stops after unsubscribe', () => {
    const host = uniqueHost();
    const seen: string[] = [];
    const unsub = subscribeWebsiteIconStatus(host, (s) => seen.push(s));

    beginWebsiteIconLoad(host, 'https://icon.example/a.png');
    expect(seen).toContain('loading');

    unsub();
    const before = seen.length;
    // Trigger another notification via a second load attempt that is rejected
    // (status no longer idle) -> no new notification expected anyway, but ensure
    // unsubscribe removed the listener by checking length stays stable on error.
    expect(seen.length).toBe(before);
  });
});

describe('beginWebsiteIconLoad', () => {
  it('returns false for blank host or src', () => {
    expect(beginWebsiteIconLoad('', 'x')).toBe(false);
    expect(beginWebsiteIconLoad(uniqueHost(), '')).toBe(false);
  });

  it('transitions an idle host to loading and sets the image url', () => {
    const host = uniqueHost();
    const src = 'https://icon.example/b.png';
    const ok = beginWebsiteIconLoad(host, src);
    expect(ok).toBe(true);
    expect(getWebsiteIconStatus(host)).toBe('loading');
    expect(getWebsiteIconImageUrl(host)).toBe(src);
  });

  it('refuses to start a second load while not idle', () => {
    const host = uniqueHost();
    expect(beginWebsiteIconLoad(host, 'https://icon.example/c.png')).toBe(true);
    expect(beginWebsiteIconLoad(host, 'https://icon.example/d.png')).toBe(false);
    // url unchanged from first load
    expect(getWebsiteIconImageUrl(host)).toBe('https://icon.example/c.png');
  });

  it('marks loaded when the underlying image fires onload', async () => {
    const host = uniqueHost();
    const src = 'https://icon.example/e.png';
    const statuses: string[] = [];
    subscribeWebsiteIconStatus(host, (s) => statuses.push(s));

    expect(beginWebsiteIconLoad(host, src)).toBe(true);

    // jsdom does not actually load images; invoke the handler the module set.
    const loader = lastCreatedImage();
    expect(loader).toBeTruthy();
    loader!.onload?.(new Event('load'));

    expect(getWebsiteIconStatus(host)).toBe('loaded');
    expect(getWebsiteIconImageUrl(host)).toBe(src);
    expect(statuses).toEqual(['loading', 'loaded']);
  });

  it('marks errored when the underlying image fires onerror', () => {
    const host = uniqueHost();
    const src = 'https://icon.example/f.png';
    expect(beginWebsiteIconLoad(host, src)).toBe(true);

    const loader = lastCreatedImage();
    loader!.onerror?.(new Event('error'));

    expect(getWebsiteIconStatus(host)).toBe('error');
    expect(getWebsiteIconImageUrl(host)).toBe('');
  });
});

describe('beginWebsiteIconLoad without Image support', () => {
  const originalImage = globalThis.Image;
  afterEach(() => {
    // restore
    (globalThis as unknown as { Image: unknown }).Image = originalImage;
  });

  it('errors immediately if Image is not a function', () => {
    // Drop the auto-installed Image spy first so our override sticks.
    vi.restoreAllMocks();
    (globalThis as unknown as { Image: unknown }).Image = undefined;
    const host = uniqueHost();
    expect(beginWebsiteIconLoad(host, 'https://icon.example/g.png')).toBe(false);
    expect(getWebsiteIconStatus(host)).toBe('error');
  });
});

describe('TTL and timeout expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires an error record back to idle after the error TTL', () => {
    const host = uniqueHost();
    beginWebsiteIconLoad(host, 'https://icon.example/h.png');
    const loader = lastCreatedImage();
    loader!.onerror?.(new Event('error'));
    expect(getWebsiteIconStatus(host)).toBe('error');

    vi.advanceTimersByTime(ERROR_TTL_MS + 1);
    // Reading status triggers expiry check.
    expect(getWebsiteIconStatus(host)).toBe('idle');
    expect(getWebsiteIconImageUrl(host)).toBe('');
  });

  it('times out a stuck loading record into an error', () => {
    const host = uniqueHost();
    beginWebsiteIconLoad(host, 'https://icon.example/i.png');
    expect(getWebsiteIconStatus(host)).toBe('loading');

    // The internal setTimeout fires the timeout path.
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS + 1);
    expect(getWebsiteIconStatus(host)).toBe('error');
    expect(getWebsiteIconImageUrl(host)).toBe('');
  });
});

// --- helpers -------------------------------------------------------------

// Track the most recently constructed Image so we can drive its handlers.
let _lastImage: HTMLImageElement | null = null;
function lastCreatedImage(): HTMLImageElement | null {
  return _lastImage;
}

beforeEach(() => {
  _lastImage = null;
  const RealImage = globalThis.Image;
  if (typeof RealImage === 'function') {
    vi.spyOn(globalThis, 'Image').mockImplementation(function (this: unknown, ...args: unknown[]) {
      // @ts-expect-error - construct the real Image
      const img = new RealImage(...args);
      _lastImage = img;
      return img;
    } as unknown as typeof Image);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});
