import { describe, expect, it } from 'vitest';
import type { CiphersImportPayload } from '@/lib/api/vault';
import {
  addFolder,
  addLoginUri,
  convertToNoteIfNeeded,
  extractTotpValue,
  isTotpFieldName,
  makeLoginCipher,
  nameFromUrl,
  normalizeUri,
  normalizeUriList,
  parseCsvRows,
  parseEpochMaybe,
  processKvp,
  setLoginUris,
  txt,
  val,
} from '@/lib/import-format-shared';

describe('txt', () => {
  it('returns empty string for null and undefined', () => {
    expect(txt(null)).toBe('');
    expect(txt(undefined)).toBe('');
  });

  it('stringifies and trims other values', () => {
    expect(txt('  hello  ')).toBe('hello');
    expect(txt(42)).toBe('42');
    expect(txt(false)).toBe('false');
  });
});

describe('val', () => {
  it('returns the trimmed string when non-empty', () => {
    expect(val('  hi  ')).toBe('hi');
  });

  it('returns the fallback (default null) for empty/blank input', () => {
    expect(val('')).toBeNull();
    expect(val('   ')).toBeNull();
    expect(val(null)).toBeNull();
    expect(val('', 'fallback')).toBe('fallback');
  });
});

describe('normalizeUri', () => {
  it('returns null for blank input', () => {
    expect(normalizeUri('')).toBeNull();
    expect(normalizeUri('   ')).toBeNull();
  });

  it('prefixes http:// when a scheme is missing but a dot is present', () => {
    expect(normalizeUri('example.com')).toBe('http://example.com');
  });

  it('leaves an existing scheme untouched', () => {
    expect(normalizeUri('https://example.com')).toBe('https://example.com');
  });

  it('leaves a schemeless, dotless value untouched', () => {
    expect(normalizeUri('localhost')).toBe('localhost');
  });

  it('truncates to 1000 characters', () => {
    const long = `${'a'.repeat(2000)}.com`;
    const out = normalizeUri(long)!;
    expect(out.length).toBe(1000);
    expect(out.startsWith('http://')).toBe(true);
  });
});

describe('normalizeUriList', () => {
  it('normalises, drops empties, and dedupes case-insensitively', () => {
    // 'example.com' becomes 'http://example.com'; 'HTTP://EXAMPLE.COM' keeps its
    // case but its lowercased key collides, so it is dropped as a duplicate.
    expect(normalizeUriList(['example.com', '', 'HTTP://EXAMPLE.COM', 'http://example.com'])).toEqual([
      'http://example.com',
    ]);
  });

  it('keeps two distinct hosts and preserves original casing of the survivor', () => {
    expect(normalizeUriList(['HTTPS://A.test', 'b.test'])).toEqual([
      'HTTPS://A.test',
      'http://b.test',
    ]);
  });

  it('returns empty array for no valid uris', () => {
    expect(normalizeUriList(['', '   '])).toEqual([]);
  });
});

describe('setLoginUris', () => {
  it('sets a mapped array of {uri, match}', () => {
    const login: Record<string, unknown> = {};
    setLoginUris(login, ['example.com', 'https://a.test']);
    expect(login.uris).toEqual([
      { uri: 'http://example.com', match: null },
      { uri: 'https://a.test', match: null },
    ]);
  });

  it('sets uris to null when none survive normalisation', () => {
    const login: Record<string, unknown> = {};
    setLoginUris(login, ['']);
    expect(login.uris).toBeNull();
  });
});

describe('addLoginUri', () => {
  it('appends to existing uris and dedupes', () => {
    const login: Record<string, unknown> = { uris: [{ uri: 'https://a.test', match: null }] };
    addLoginUri(login, 'b.test');
    expect(login.uris).toEqual([
      { uri: 'https://a.test', match: null },
      { uri: 'http://b.test', match: null },
    ]);
  });

  it('handles a login with no existing uris', () => {
    const login: Record<string, unknown> = {};
    addLoginUri(login, 'a.test');
    expect(login.uris).toEqual([{ uri: 'http://a.test', match: null }]);
  });

  it('does not duplicate an existing uri', () => {
    const login: Record<string, unknown> = { uris: [{ uri: 'http://a.test', match: null }] };
    addLoginUri(login, 'a.test');
    expect(login.uris).toEqual([{ uri: 'http://a.test', match: null }]);
  });
});

describe('isTotpFieldName', () => {
  it('detects known totp field names ignoring case and separators', () => {
    expect(isTotpFieldName('TOTP')).toBe(true);
    expect(isTotpFieldName('otp auth')).toBe(true);
    expect(isTotpFieldName('one-time password')).toBe(true);
    expect(isTotpFieldName('2FA')).toBe(true);
    expect(isTotpFieldName('two_factor')).toBe(true);
    expect(isTotpFieldName('verification-code')).toBe(true);
  });

  it('returns false for empty or unrelated names', () => {
    expect(isTotpFieldName('')).toBe(false);
    expect(isTotpFieldName(null)).toBe(false);
    expect(isTotpFieldName('password')).toBe(false);
  });
});

describe('extractTotpValue', () => {
  it('returns trimmed primitive values', () => {
    expect(extractTotpValue('  abc  ')).toBe('abc');
    expect(extractTotpValue(123)).toBe('123');
    expect(extractTotpValue(true)).toBe('true');
  });

  it('returns empty for null/undefined', () => {
    expect(extractTotpValue(null)).toBe('');
    expect(extractTotpValue(undefined)).toBe('');
  });

  it('finds the first non-empty value in an array', () => {
    expect(extractTotpValue(['', null, 'secret'])).toBe('secret');
    expect(extractTotpValue([])).toBe('');
  });

  it('pulls from known object keys in priority order', () => {
    expect(extractTotpValue({ totpUri: 'otpauth://x', secret: 'ignored' })).toBe('otpauth://x');
    expect(extractTotpValue({ secret: 'JBSW' })).toBe('JBSW');
    expect(extractTotpValue({ unrelated: 'x' })).toBe('');
  });
});

describe('nameFromUrl', () => {
  it('returns hostname stripped of www', () => {
    expect(nameFromUrl('https://www.example.com/path')).toBe('example.com');
    expect(nameFromUrl('example.com')).toBe('example.com');
  });

  it('returns null for blank or unparseable input', () => {
    expect(nameFromUrl('')).toBeNull();
    expect(nameFromUrl('   ')).toBeNull();
  });
});

describe('convertToNoteIfNeeded', () => {
  it('converts a login with no login data into a secure note', () => {
    const cipher = makeLoginCipher();
    convertToNoteIfNeeded(cipher);
    expect(cipher.type).toBe(2);
    expect(cipher.login).toBeNull();
    expect(cipher.secureNote).toEqual({ type: 0 });
  });

  it('leaves a login with a username intact', () => {
    const cipher = makeLoginCipher();
    (cipher.login as Record<string, unknown>).username = 'alice';
    convertToNoteIfNeeded(cipher);
    expect(cipher.type).toBe(1);
    expect(cipher.secureNote).toBeNull();
  });

  it('leaves a login with uris intact', () => {
    const cipher = makeLoginCipher();
    (cipher.login as Record<string, unknown>).uris = [{ uri: 'http://a.test', match: null }];
    convertToNoteIfNeeded(cipher);
    expect(cipher.type).toBe(1);
  });

  it('ignores non-login ciphers', () => {
    const cipher = makeLoginCipher();
    cipher.type = 3;
    cipher.login = null;
    convertToNoteIfNeeded(cipher);
    expect(cipher.type).toBe(3);
  });
});

describe('parseEpochMaybe', () => {
  it('treats large values as milliseconds', () => {
    expect(parseEpochMaybe(1_600_000_000_000)).toBe(new Date(1_600_000_000_000).toISOString());
  });

  it('treats small values as seconds', () => {
    expect(parseEpochMaybe(1_600_000_000)).toBe(new Date(1_600_000_000_000).toISOString());
  });

  it('returns null for non-finite or non-positive input', () => {
    expect(parseEpochMaybe(0)).toBeNull();
    expect(parseEpochMaybe(-5)).toBeNull();
    expect(parseEpochMaybe('not-a-number')).toBeNull();
    expect(parseEpochMaybe(null)).toBeNull();
  });
});

describe('parseCsvRows', () => {
  it('parses raw rows without a header mapping, handling quotes', () => {
    expect(parseCsvRows('a,b\n"c,c",d')).toEqual([
      ['a', 'b'],
      ['c,c', 'd'],
    ]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsvRows('"say ""hi"""')).toEqual([['say "hi"']]);
  });

  it('drops fully blank rows', () => {
    expect(parseCsvRows('a,b\n,\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('processKvp', () => {
  it('adds a short value as a field', () => {
    const cipher = makeLoginCipher();
    processKvp(cipher, 'PIN', '1234');
    expect(cipher.fields).toEqual([{ type: 0, name: 'PIN', value: '1234', linkedId: null }]);
  });

  it('marks hidden fields with type 1', () => {
    const cipher = makeLoginCipher();
    processKvp(cipher, 'Secret', 'shh', true);
    expect((cipher.fields as any[])[0].type).toBe(1);
  });

  it('skips empty values', () => {
    const cipher = makeLoginCipher();
    processKvp(cipher, 'k', '');
    expect(cipher.fields).toEqual([]);
  });

  it('does not duplicate an identical field', () => {
    const cipher = makeLoginCipher();
    processKvp(cipher, 'k', 'v');
    processKvp(cipher, 'k', 'v');
    expect(cipher.fields).toHaveLength(1);
  });

  it('routes long values (>200 chars) to notes instead of fields', () => {
    const cipher = makeLoginCipher();
    const long = 'x'.repeat(201);
    processKvp(cipher, 'Long', long);
    expect(cipher.fields).toEqual([]);
    expect(cipher.notes).toBe(`Long: ${long}`);
  });

  it('routes multiline values to notes', () => {
    const cipher = makeLoginCipher();
    processKvp(cipher, 'Multi', 'line1\nline2');
    expect(cipher.fields).toEqual([]);
    expect(cipher.notes).toBe('Multi: line1\nline2');
  });

  it('appends a long single-line note entry and dedupes identical lines', () => {
    const cipher = makeLoginCipher();
    cipher.notes = 'existing';
    const long = 'y'.repeat(201);
    processKvp(cipher, '', long);
    expect(cipher.notes).toBe(`existing\n${long}`);
    // Re-adding the same single-line entry is a no-op (line-level dedup).
    processKvp(cipher, '', long);
    expect(cipher.notes).toBe(`existing\n${long}`);
  });
});

describe('makeLoginCipher', () => {
  it('produces a fresh login-cipher skeleton', () => {
    const a = makeLoginCipher();
    const b = makeLoginCipher();
    expect(a.type).toBe(1);
    expect(a.login).toEqual({ username: null, password: null, totp: null, uris: null });
    expect(a.fields).toEqual([]);
    expect(a).not.toBe(b);
    expect(a.login).not.toBe(b.login);
  });
});

describe('addFolder', () => {
  const emptyResult = (): CiphersImportPayload => ({ ciphers: [], folders: [], folderRelationships: [] });

  it('creates a folder and records the relationship', () => {
    const result = emptyResult();
    addFolder(result, 'Work', 0);
    expect(result.folders).toEqual([{ name: 'Work' }]);
    expect(result.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('reuses an existing folder by name', () => {
    const result = emptyResult();
    addFolder(result, 'Work', 0);
    addFolder(result, 'Work', 1);
    expect(result.folders).toEqual([{ name: 'Work' }]);
    expect(result.folderRelationships).toEqual([
      { key: 0, value: 0 },
      { key: 1, value: 0 },
    ]);
  });

  it('normalises backslashes to forward slashes', () => {
    const result = emptyResult();
    addFolder(result, 'Work\\Sub', 0);
    expect(result.folders).toEqual([{ name: 'Work/Sub' }]);
  });

  it('ignores blank names and the literal (none)', () => {
    const result = emptyResult();
    addFolder(result, '', 0);
    addFolder(result, '(none)', 0);
    expect(result.folders).toEqual([]);
    expect(result.folderRelationships).toEqual([]);
  });
});
