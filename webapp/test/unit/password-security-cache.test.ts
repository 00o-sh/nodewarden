import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cipher } from '@/lib/types';
import { sha1Password } from '@/lib/password-security';
import {
  clearPasswordSecurityCache,
  getPasswordSecurityState,
  readPasswordSecurityState,
  startPasswordSecurityScan,
  subscribePasswordSecurityState,
} from '@/lib/password-security-cache';

const textResponse = (body: string, status = 200) => Promise.resolve(new Response(body, { status }));

// A Pwned Passwords range stub (see the sibling password-security suite).
async function buildRangeMock(leaked: Record<string, number>): Promise<ReturnType<typeof vi.fn>> {
  const byPrefix = new Map<string, string[]>();
  for (const [password, count] of Object.entries(leaked)) {
    const hash = await sha1Password(password);
    const lines = byPrefix.get(hash.slice(0, 5)) ?? [];
    lines.push(`${hash.slice(5)}:${count}`);
    byPrefix.set(hash.slice(0, 5), lines);
  }
  return vi.fn((url: string) => textResponse((byPrefix.get(url.slice(-5)) ?? []).join('\r\n')));
}

const cipher = (id: string, password: string, extra: Partial<Cipher> = {}): Cipher =>
  ({ id, type: 1, decName: id, login: { decPassword: password, decUsername: '' }, ...extra }) as Cipher;

// Poll until a predicate holds (scans complete on real microtasks/timers).
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  // Drain any in-flight scan, then reset the module singleton + globals.
  clearPasswordSecurityCache();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearPasswordSecurityCache();
  vi.unstubAllGlobals();
});

describe('getPasswordSecurityState / readPasswordSecurityState', () => {
  it('lazily creates a fresh default state for a new fingerprint', () => {
    const state = getPasswordSecurityState('fp1');
    expect(state).toMatchObject({
      fingerprint: 'fp1',
      report: null,
      scannedAt: null,
      scanning: false,
      progress: { checked: 0, total: 0 },
      scanError: false,
    });
  });

  it('returns the same object on repeated reads of the same fingerprint', () => {
    const first = getPasswordSecurityState('fp1');
    expect(getPasswordSecurityState('fp1')).toBe(first);
    expect(readPasswordSecurityState('fp1')).toBe(first);
  });

  it('readPasswordSecurityState returns null before any state exists and for a mismatched fingerprint', () => {
    expect(readPasswordSecurityState('nobody')).toBeNull();
    getPasswordSecurityState('fp1');
    expect(readPasswordSecurityState('other')).toBeNull();
  });

  it('replaces the state when the fingerprint changes', () => {
    getPasswordSecurityState('fpA');
    const b = getPasswordSecurityState('fpB');
    expect(b.fingerprint).toBe('fpB');
    expect(readPasswordSecurityState('fpA')).toBeNull();
    expect(readPasswordSecurityState('fpB')).toBe(b);
  });
});

describe('subscribePasswordSecurityState', () => {
  it('notifies subscribers and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePasswordSecurityState(listener);
    clearPasswordSecurityCache(); // notify()
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearPasswordSecurityCache(); // notify() again, but we are no longer subscribed
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('clearPasswordSecurityCache', () => {
  it('drops the cached state', () => {
    getPasswordSecurityState('fp1');
    clearPasswordSecurityCache();
    expect(readPasswordSecurityState('fp1')).toBeNull();
  });
});

describe('startPasswordSecurityScan', () => {
  it('flips to scanning immediately, counts only eligible ciphers, and notifies', () => {
    const fetchMock = vi.fn(() => textResponse(''));
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    subscribePasswordSecurityState(listener);

    startPasswordSecurityScan('fp1', [
      cipher('c1', 'password'),
      { id: 'note', type: 2, login: { decPassword: 'password' } } as unknown as Cipher,
      { id: 'nopw', type: 1, login: { decPassword: '' } } as unknown as Cipher,
    ]);

    const during = readPasswordSecurityState('fp1')!;
    expect(during.scanning).toBe(true);
    expect(during.scanError).toBe(false);
    expect(during.report).toBeNull();
    expect(during.progress.total).toBe(1); // only c1 is an eligible login with a password
    expect(listener).toHaveBeenCalled();
  });

  it('resolves into a completed report with scannedAt set and scanning cleared', async () => {
    const fetchMock = await buildRangeMock({ password: 100 });
    vi.stubGlobal('fetch', fetchMock);

    startPasswordSecurityScan('fp1', [cipher('c1', 'password')]);
    await waitUntil(() => readPasswordSecurityState('fp1')?.scanning === false);

    const done = readPasswordSecurityState('fp1')!;
    expect(done.scanning).toBe(false);
    expect(done.scanError).toBe(false);
    expect(typeof done.scannedAt).toBe('number');
    expect((done as { controller: unknown }).controller).toBeNull();
    expect(done.report).toMatchObject({ eligibleCount: 1, exposedCount: 1, weakCount: 1 });
    expect(done.report?.items[0]).toMatchObject({ cipherId: 'c1', exposedCount: 100, weak: true });
    // Progress reached the total.
    expect(done.progress).toEqual({ checked: 1, total: 1 });
  });

  it('sets scanError when the scan fails unexpectedly and leaves report null', async () => {
    // Two weak, unexposed ciphers with no id force the item comparator to
    // dereference an undefined cipherId, so inspection rejects with a
    // non-abort error and the scan is marked failed.
    const fetchMock = vi.fn(() => textResponse(''));
    vi.stubGlobal('fetch', fetchMock);
    const malformed = (password: string) =>
      ({ type: 1, login: { decPassword: password, decUsername: '' } }) as unknown as Cipher;

    startPasswordSecurityScan('fpErr', [malformed('letmein123'), malformed('abcdefghij')]);
    await waitUntil(() => readPasswordSecurityState('fpErr')?.scanning === false);

    const state = readPasswordSecurityState('fpErr')!;
    expect(state.scanError).toBe(true);
    expect(state.report).toBeNull();
    expect(state.scanning).toBe(false);
  });
});
