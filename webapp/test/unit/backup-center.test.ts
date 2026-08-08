import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REMOTE_BROWSER_ITEMS_PER_PAGE,
  REMOTE_BROWSER_STORAGE_KEY,
  compareRemoteItems,
  createDraftBackupSettings,
  createDraftDestinationRecord,
  detectBrowserTimeZone,
  formatBytes,
  formatDateTime,
  getDestinationById,
  getDestinationTypeLabel,
  getFirstVisibleDestinationId,
  getRemoteBrowserCacheKey,
  getVisibleDestinations,
  invalidateRemoteBrowserCacheForDestination,
  isReplaceRequiredError,
  isZipCandidate,
  loadPersistedRemoteBrowserState,
  persistRemoteBrowserState,
} from '@/lib/backup-center';
import type { RemoteBackupItem } from '@/lib/api/backup';
import type { BackupSettings } from '@shared/backup-schema';

function item(overrides: Partial<RemoteBackupItem> = {}): RemoteBackupItem {
  return { name: 'file.zip', isDirectory: false, modifiedAt: null, size: 0, ...overrides } as RemoteBackupItem;
}

describe('formatBytes', () => {
  it('reports an unknown-size label for zero, negative, or non-finite values', () => {
    expect(formatBytes(0)).toBe('Unknown size');
    expect(formatBytes(-5)).toBe('Unknown size');
    expect(formatBytes(null)).toBe('Unknown size');
    expect(formatBytes(Number.NaN)).toBe('Unknown size');
  });

  it('formats bytes, KB, MB and GB with the expected precision', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });
});

describe('formatDateTime', () => {
  it('returns the never label for empty input', () => {
    expect(formatDateTime(null)).toBe('Never');
    expect(formatDateTime(undefined)).toBe('Never');
    expect(formatDateTime('')).toBe('Never');
  });

  it('returns the raw value when it is not a parseable date', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('formats a valid ISO timestamp via toLocaleString', () => {
    const iso = '2024-05-01T12:00:00.000Z';
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});

describe('isReplaceRequiredError', () => {
  it('detects the "fresh instance" marker in an Error message', () => {
    expect(isReplaceRequiredError(new Error('This is a fresh instance, replace required'))).toBe(true);
  });

  it('is false for unrelated errors and non-Error values', () => {
    expect(isReplaceRequiredError(new Error('some other failure'))).toBe(false);
    expect(isReplaceRequiredError('fresh instance')).toBe(false);
    expect(isReplaceRequiredError(null)).toBe(false);
  });
});

describe('isZipCandidate', () => {
  it('accepts a non-directory .zip file (case-insensitive)', () => {
    expect(isZipCandidate(item({ name: 'backup.ZIP' }))).toBe(true);
  });

  it('rejects directories and non-zip files', () => {
    expect(isZipCandidate(item({ name: 'backup.zip', isDirectory: true }))).toBe(false);
    expect(isZipCandidate(item({ name: 'notes.txt' }))).toBe(false);
  });
});

describe('compareRemoteItems', () => {
  it('sorts the attachments directory first of all', () => {
    const attachments = item({ name: 'attachments', isDirectory: true });
    const other = item({ name: 'zzz', isDirectory: true });
    expect(compareRemoteItems(attachments, other)).toBeLessThan(0);
    expect(compareRemoteItems(other, attachments)).toBeGreaterThan(0);
  });

  it('sorts directories before files', () => {
    const dir = item({ name: 'folder', isDirectory: true });
    const file = item({ name: 'a.zip', isDirectory: false });
    expect(compareRemoteItems(dir, file)).toBeLessThan(0);
  });

  it('sorts newer files ahead of older ones', () => {
    const older = item({ name: 'old.zip', modifiedAt: '2020-01-01T00:00:00Z' });
    const newer = item({ name: 'new.zip', modifiedAt: '2024-01-01T00:00:00Z' });
    expect(compareRemoteItems(newer, older)).toBeLessThan(0);
    expect(compareRemoteItems(older, newer)).toBeGreaterThan(0);
  });

  it('falls back to a descending name compare when times are equal', () => {
    const a = item({ name: 'a.zip', modifiedAt: null });
    const b = item({ name: 'b.zip', modifiedAt: null });
    // b > a, so b sorts first (negative when comparing b to a).
    expect(compareRemoteItems(b, a)).toBeLessThan(0);
  });
});

describe('getRemoteBrowserCacheKey', () => {
  it('joins the destination id and path, defaulting path to empty', () => {
    expect(getRemoteBrowserCacheKey('dest')).toBe('dest:');
    expect(getRemoteBrowserCacheKey('dest', 'sub/dir')).toBe('dest:sub/dir');
  });
});

describe('destination helpers', () => {
  const settings = {
    destinations: [
      { id: 'd1', name: 'One' },
      { id: 'd2', name: 'Two' },
    ],
  } as unknown as BackupSettings;

  it('getDestinationById finds a destination or returns null', () => {
    expect(getDestinationById(settings, 'd2')?.name).toBe('Two');
    expect(getDestinationById(settings, 'missing')).toBeNull();
    expect(getDestinationById(null, 'd1')).toBeNull();
    expect(getDestinationById(settings, null)).toBeNull();
  });

  it('getVisibleDestinations returns the list or empty array', () => {
    expect(getVisibleDestinations(settings)).toHaveLength(2);
    expect(getVisibleDestinations(null)).toEqual([]);
    expect(getVisibleDestinations(undefined)).toEqual([]);
  });

  it('getFirstVisibleDestinationId returns the first id or null', () => {
    expect(getFirstVisibleDestinationId(settings)).toBe('d1');
    expect(getFirstVisibleDestinationId({ destinations: [] } as unknown as BackupSettings)).toBeNull();
    expect(getFirstVisibleDestinationId(null)).toBeNull();
  });

  it('getDestinationTypeLabel maps type to a protocol label', () => {
    expect(getDestinationTypeLabel('s3')).toBe('S3');
    expect(getDestinationTypeLabel('webdav')).toBe('WebDAV');
  });
});

describe('draft creators', () => {
  it('createDraftDestinationRecord fills a localized name and detected timezone', () => {
    const record = createDraftDestinationRecord('s3', 2);
    expect(record.type).toBe('s3');
    expect(record.name).toBe('S3 2');
    expect(record.schedule.timezone).toBe(detectBrowserTimeZone());
  });

  it('createDraftBackupSettings seeds a single webdav destination', () => {
    const settings = createDraftBackupSettings();
    expect(settings.destinations).toHaveLength(1);
    expect(settings.destinations[0].type).toBe('webdav');
    expect(settings.destinations[0].name).toBe('WebDAV 1');
  });
});

describe('persisted remote browser state', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('exposes the storage key and items-per-page constants', () => {
    expect(REMOTE_BROWSER_STORAGE_KEY).toBe('nodewarden.backup.remote-browser.v1');
    expect(REMOTE_BROWSER_ITEMS_PER_PAGE).toBe(10);
  });

  it('returns an empty default state when nothing is stored', () => {
    expect(loadPersistedRemoteBrowserState('user-1')).toEqual({
      cache: {},
      pathByDestination: {},
      pageByKey: {},
      selectedDestinationId: null,
    });
  });

  it('round-trips state through persist/load, scoped per user', () => {
    const state = {
      cache: { 'd1:': { items: [] } as never },
      pathByDestination: { d1: 'sub' },
      pageByKey: { 'd1:sub': 2 },
      selectedDestinationId: 'd1',
    };
    persistRemoteBrowserState('user-1', state);
    expect(loadPersistedRemoteBrowserState('user-1')).toEqual(state);
    // A different user id has its own (empty) namespace.
    expect(loadPersistedRemoteBrowserState('user-2').selectedDestinationId).toBeNull();
  });

  it('recovers gracefully from corrupt stored JSON', () => {
    localStorage.setItem(`${REMOTE_BROWSER_STORAGE_KEY}:user-1`, '{not json');
    expect(loadPersistedRemoteBrowserState('user-1').cache).toEqual({});
  });

  it('coerces non-object persisted fields back to defaults', () => {
    localStorage.setItem(
      `${REMOTE_BROWSER_STORAGE_KEY}:user-1`,
      JSON.stringify({ cache: 'nope', pathByDestination: 3, pageByKey: null, selectedDestinationId: 42 })
    );
    const loaded = loadPersistedRemoteBrowserState('user-1');
    expect(loaded.cache).toEqual({});
    expect(loaded.pathByDestination).toEqual({});
    expect(loaded.pageByKey).toEqual({});
    expect(loaded.selectedDestinationId).toBeNull();
  });
});

describe('invalidateRemoteBrowserCacheForDestination', () => {
  it('drops only the cache/page entries and path for the given destination', () => {
    const result = invalidateRemoteBrowserCacheForDestination(
      'd1',
      { 'd1:': {} as never, 'd1:sub': {} as never, 'd2:': {} as never },
      { d1: 'sub', d2: 'other' },
      { 'd1:sub': 1, 'd2:': 4 }
    );
    expect(Object.keys(result.cache)).toEqual(['d2:']);
    expect(result.pathByDestination).toEqual({ d2: 'other' });
    expect(result.pageByKey).toEqual({ 'd2:': 4 });
    expect(result.selectedDestinationId).toBe('d1');
  });
});
