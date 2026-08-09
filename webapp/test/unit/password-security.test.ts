import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cipher } from '@/lib/types';
import {
  checkPasswordHashLeaked,
  checkPasswordLeaked,
  inspectVaultPasswordSecurity,
  isWeakPassword,
  sha1Password,
} from '@/lib/password-security';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
// Well-known upper-cased SHA-1 of the literal string "password".
const SHA1_PASSWORD = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
const PASSWORD_PREFIX = SHA1_PASSWORD.slice(0, 5); // 5BAA6
const PASSWORD_SUFFIX = SHA1_PASSWORD.slice(5); // 35 hex chars

const textResponse = (body: string, status = 200) => Promise.resolve(new Response(body, { status }));
const abortError = (message = 'boom') => Object.assign(new Error(message), { name: 'AbortError' });

// Build a fetch stub that behaves like the Pwned Passwords range API: it returns,
// for a given 5-char prefix, the k-anonymity suffix lines of every "leaked"
// password whose hash starts with that prefix. `errorPassword`'s prefix rejects.
async function buildRangeMock(opts: {
  leaked?: Record<string, number>;
  errorPassword?: string;
}): Promise<ReturnType<typeof vi.fn>> {
  const byPrefix = new Map<string, string[]>();
  for (const [password, count] of Object.entries(opts.leaked ?? {})) {
    const hash = await sha1Password(password);
    const lines = byPrefix.get(hash.slice(0, 5)) ?? [];
    // Lower-case the suffix on purpose: the parser must compare case-insensitively.
    lines.push(`${hash.slice(5).toLowerCase()}:${count}`);
    byPrefix.set(hash.slice(0, 5), lines);
  }
  const errorPrefix = opts.errorPassword ? (await sha1Password(opts.errorPassword)).slice(0, 5) : null;
  return vi.fn((url: string) => {
    const prefix = url.slice(-5);
    if (prefix === errorPrefix) return Promise.reject(new Error('network down'));
    // A non-matching noise line proves the parser filters by suffix, not position.
    const body = ['0'.repeat(35) + ':9', ...(byPrefix.get(prefix) ?? [])].join('\r\n');
    return textResponse(body);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sha1Password', () => {
  it('hashes with real WebCrypto to the known upper-cased SHA-1 vector', async () => {
    expect(await sha1Password('password')).toBe(SHA1_PASSWORD);
  });

  it('produces a 40-char upper-hex digest for the empty string', async () => {
    const hash = await sha1Password('');
    expect(hash).toBe('DA39A3EE5E6B4B0D3255BFEF95601890AFD80709');
    expect(hash).toMatch(/^[A-F0-9]{40}$/);
  });
});

describe('checkPasswordHashLeaked request shaping', () => {
  it('requests the 5-char prefix with the padding header and returns the parsed count', async () => {
    const fetchMock = vi.fn(() => textResponse(`${PASSWORD_SUFFIX}:42\r\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:7`));
    const count = await checkPasswordHashLeaked(SHA1_PASSWORD, fetchMock);
    expect(count).toBe(42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${RANGE_URL}${PASSWORD_PREFIX}`);
    expect(init.method).toBe('GET');
    expect(init.mode).toBe('cors');
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.headers['Add-Padding']).toBe('true');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('matches the suffix case-insensitively', async () => {
    const fetchMock = vi.fn(() => textResponse(`${PASSWORD_SUFFIX.toLowerCase()}:5`));
    expect(await checkPasswordHashLeaked(SHA1_PASSWORD, fetchMock)).toBe(5);
  });

  it('returns 0 when the suffix is absent from the range response', async () => {
    const fetchMock = vi.fn(() => textResponse('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:12'));
    expect(await checkPasswordHashLeaked(SHA1_PASSWORD, fetchMock)).toBe(0);
  });

  it('ignores lines whose colon is not at the suffix boundary and non-positive counts', async () => {
    const body = [
      'short:5', // colon at index 5, skipped
      `${PASSWORD_SUFFIX}:0`, // matches but count 0 => treated as not found
    ].join('\n');
    expect(await checkPasswordHashLeaked(SHA1_PASSWORD, vi.fn(() => textResponse(body)))).toBe(0);
  });

  it('treats an unparseable count as 0', async () => {
    expect(await checkPasswordHashLeaked(SHA1_PASSWORD, vi.fn(() => textResponse(`${PASSWORD_SUFFIX}:notanumber`)))).toBe(0);
  });

  it('rejects a malformed (non upper-hex) hash without calling fetch', async () => {
    const fetchMock = vi.fn();
    await expect(checkPasswordHashLeaked('not-a-hash', fetchMock)).rejects.toThrow('Password hash is invalid.');
    await expect(checkPasswordHashLeaked(SHA1_PASSWORD.toLowerCase(), fetchMock)).rejects.toThrow('Password hash is invalid.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the range endpoint responds non-2xx', async () => {
    const fetchMock = vi.fn(() => textResponse('', 503));
    await expect(checkPasswordHashLeaked(SHA1_PASSWORD, fetchMock)).rejects.toThrow('Pwned Passwords returned 503.');
  });

  it('maps an internal timeout abort (no external signal) to a timeout error', async () => {
    const fetchMock = vi.fn(() => Promise.reject(abortError()));
    await expect(checkPasswordHashLeaked(SHA1_PASSWORD, fetchMock)).rejects.toThrow('Pwned Passwords request timed out.');
  });

  it('rethrows a generic network failure verbatim', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(checkPasswordHashLeaked(SHA1_PASSWORD, fetchMock)).rejects.toThrow('offline');
  });

  it('throws AbortError immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    await expect(checkPasswordHashLeaked(SHA1_PASSWORD, fetchMock, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an external cancel as a distinct AbortError even mid-request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(() => {
      controller.abort();
      return Promise.reject(abortError('cancelled'));
    });
    await expect(checkPasswordHashLeaked(SHA1_PASSWORD, fetchMock, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The operation was aborted.',
    });
  });
});

describe('checkPasswordLeaked', () => {
  it('short-circuits an empty password without a network call', async () => {
    const fetchMock = vi.fn();
    expect(await checkPasswordLeaked('', fetchMock)).toEqual({ count: 0, available: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the breach count for a leaked password', async () => {
    const fetchMock = await buildRangeMock({ leaked: { password: 100 } });
    expect(await checkPasswordLeaked('password', fetchMock)).toEqual({ count: 100, available: true });
  });

  it('reports unavailable (count null) on a network failure', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    expect(await checkPasswordLeaked('password', fetchMock)).toEqual({ count: null, available: false });
  });

  it('rethrows when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(checkPasswordLeaked('password', vi.fn(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('isWeakPassword', () => {
  it('flags known common passwords', () => {
    expect(isWeakPassword('password')).toBe(true);
    expect(isWeakPassword('iloveyou')).toBe(true);
  });

  it('flags short passwords (< 10 chars)', () => {
    expect(isWeakPassword('Ab3$xyz')).toBe(true);
  });

  it('flags all-identical-character passwords', () => {
    expect(isWeakPassword('aaaaaaaaaa')).toBe(true);
  });

  it('flags simple keyboard/number sequences in either direction', () => {
    expect(isWeakPassword('0123456789')).toBe(true);
    expect(isWeakPassword('9876543210')).toBe(true);
    expect(isWeakPassword('qwertyuiop')).toBe(true);
  });

  it('flags a password that embeds the username local-part', () => {
    // 16 chars => would otherwise pass the length gate; the username match is what fails it.
    expect(isWeakPassword('Str0ng!Passalice', 'alice@example.com')).toBe(true);
  });

  it('flags a medium-length password with fewer than three character classes', () => {
    // 12 lowercase-only chars: length < 14 and only one class.
    expect(isWeakPassword('xkcdhorseba')).toBe(true);
  });

  it('accepts a 13-char password with >= 3 character classes', () => {
    expect(isWeakPassword('Str0ng!Pass99')).toBe(false);
  });

  it('accepts a long (>= 14 char) passphrase even with a single class', () => {
    expect(isWeakPassword('xkcdhorsebattery')).toBe(false);
  });

  it('does not treat a short username as a match', () => {
    // username local-part "ab" is under the 3-char threshold, so it is ignored.
    expect(isWeakPassword('Str0ng!Pass99', 'ab@x.com')).toBe(false);
  });
});

// Helper for building eligible/ineligible ciphers.
const cipher = (id: string, password: string, extra: Partial<Cipher> = {}): Cipher =>
  ({ id, type: 1, decName: id, login: { decPassword: password, decUsername: '' }, ...extra }) as Cipher;

describe('inspectVaultPasswordSecurity', () => {
  it('returns an all-zero report when nothing is eligible', async () => {
    const ciphers = [
      { id: 'note', type: 2, login: { decPassword: 'password' } },
      { id: 'deleted', type: 1, deletedDate: '2020-01-01', login: { decPassword: 'password' } },
      { id: 'nopw', type: 1, login: { decPassword: '' } },
    ] as unknown as Cipher[];
    const fetchMock = vi.fn();
    const report = await inspectVaultPasswordSecurity(ciphers, undefined, fetchMock);
    expect(report).toEqual({
      eligibleCount: 0,
      checkedCount: 0,
      exposedCount: 0,
      reusedCount: 0,
      weakCount: 0,
      unavailableCount: 0,
      items: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aggregates exposure, reuse, weakness and unavailability with a stable item ordering', async () => {
    const fetchMock = await buildRangeMock({
      leaked: { password: 100, 'Str0ng!Leaked88': 5 },
      errorPassword: 'Str0ng!ErrPwd77',
    });
    const ciphers = [
      cipher('c-pw-1', 'password'),
      cipher('c-pw-2', 'password'), // reused => shares the 'password' hash group
      cipher('c-strong-clean', 'Str0ng!Clean99'), // strong + not leaked => filtered out
      cipher('c-strong-leaked', 'Str0ng!Leaked88'),
      cipher('c-weak-clean', 'letmein123'), // weak but not leaked
      cipher('c-err', 'Str0ng!ErrPwd77'), // network failure => unavailable
      // Ineligible ciphers, ignored entirely:
      { id: 'x-note', type: 2, login: { decPassword: 'password' } },
      { id: 'x-deleted', type: 1, deletedDate: '2020', login: { decPassword: 'password' } },
      { id: 'x-nopw', type: 1, login: { decPassword: '' } },
    ] as unknown as Cipher[];

    const progress = vi.fn();
    const report = await inspectVaultPasswordSecurity(ciphers, progress, fetchMock);

    expect(report.eligibleCount).toBe(6);
    expect(report.checkedCount).toBe(6);
    expect(report.exposedCount).toBe(3); // c-pw-1, c-pw-2, c-strong-leaked
    expect(report.reusedCount).toBe(2); // the two 'password' entries
    expect(report.weakCount).toBe(3); // both 'password' + 'letmein123'
    expect(report.unavailableCount).toBe(1); // c-err

    expect(report.items).toEqual([
      { cipherId: 'c-pw-1', exposedCount: 100, reusedCount: 2, weak: true },
      { cipherId: 'c-pw-2', exposedCount: 100, reusedCount: 2, weak: true },
      { cipherId: 'c-strong-leaked', exposedCount: 5, reusedCount: 1, weak: false },
      { cipherId: 'c-weak-clean', exposedCount: 0, reusedCount: 1, weak: true },
      { cipherId: 'c-err', exposedCount: null, reusedCount: 1, weak: false },
    ]);

    // Progress is reported per unique hash and ends at (total, total).
    expect(progress).toHaveBeenCalled();
    expect(progress.mock.calls.every(([, total]) => total === 6)).toBe(true);
    expect(progress.mock.calls.at(-1)).toEqual([6, 6]);

    // One request per unique hash: 'password' is de-duplicated to a single fetch.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    await expect(
      inspectVaultPasswordSecurity([cipher('c1', 'password')], undefined, fetchMock, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
