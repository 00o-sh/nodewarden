import { describe, expect, it } from 'vitest';
import {
  findBackupDestination,
  getBackupLocalDateKey,
  getBackupLocalTime,
  getDefaultBackupSettings,
  hasBackupSlotBetween,
  isBackupDueNow,
  normalizeBackupSettingsInput,
  parseBackupSettings,
  requireBackupDestination,
  serializeBackupSettings,
} from '../src/services/backup-config';
import type { BackupDestinationRecord, BackupSettings } from '../../shared/backup-schema';

// Pure validation/normalization and scheduling logic for the backup config.
// No bindings required — exercises the input-sanitizing contract that the admin
// settings handler relies on, and the deterministic scheduler slot math.

const webdav = (overrides: Record<string, unknown> = {}) => ({
  type: 'webdav',
  destination: { baseUrl: 'https://dav.example', username: 'u', password: 'p', remotePath: 'nodewarden', ...((overrides.destination as object) || {}) },
  schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30, ...((overrides.schedule as object) || {}) },
  ...overrides,
});

const empty: BackupSettings = { destinations: [] };

function normalize(input: unknown, previous: BackupSettings = empty): BackupSettings {
  return normalizeBackupSettingsInput(input as any, previous);
}

describe('normalizeBackupSettingsInput — destinations', () => {
  it('normalizes a complete WebDAV destination', () => {
    const out = normalize({ destinations: [webdav()] });
    expect(out.destinations).toHaveLength(1);
    expect(out.destinations[0].type).toBe('webdav');
    expect(out.destinations[0].destination).toMatchObject({ baseUrl: 'https://dav.example', username: 'u', remotePath: 'nodewarden' });
    expect(typeof out.destinations[0].id).toBe('string');
  });

  it('normalizes a complete S3 destination and accepts the legacy "e3" alias', () => {
    const out = normalize({
      destinations: [{
        type: 'e3',
        destination: { endpoint: 'https://s3.example/', bucket: 'b', accessKeyId: 'ak', secretAccessKey: 'sk', region: 'us-east-1' },
        schedule: { enabled: true, intervalHours: 12, startTime: '6:5', timezone: 'UTC', retentionCount: 7 },
      }],
    });
    expect(out.destinations[0].type).toBe('s3');
    // endpoint trailing slash trimmed, start time zero-padded.
    expect(out.destinations[0].destination).toMatchObject({ endpoint: 'https://s3.example', bucket: 'b' });
    expect(out.destinations[0].schedule.startTime).toBe('06:05');
    expect(out.destinations[0].schedule.intervalHours).toBe(12);
  });

  it('preserves runtime state and includeAttachments across an update by id', () => {
    const first = normalize({ destinations: [webdav({ includeAttachments: true })] });
    const id = first.destinations[0].id;
    first.destinations[0].runtime.lastSuccessAt = '2026-01-01T00:00:00.000Z';

    const updated = normalizeBackupSettingsInput(
      { destinations: [{ ...webdav(), id }] } as any,
      first
    );
    expect(updated.destinations[0].id).toBe(id);
    expect(updated.destinations[0].runtime.lastSuccessAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated.destinations[0].includeAttachments).toBe(true);
  });

  it('rejects an invalid destination type', () => {
    expect(() => normalize({ destinations: [{ type: 'ftp', destination: {} }] })).toThrow(/destination type is invalid/i);
  });

  it('rejects a non-object payload and non-array destinations', () => {
    expect(() => normalize(null)).toThrow(/payload is invalid/i);
    expect(() => normalize({ destinations: 'nope' })).toThrow(/destinations are invalid/i);
  });

  it('rejects duplicate destination ids', () => {
    expect(() => normalize({ destinations: [{ ...webdav(), id: 'dup' }, { ...webdav(), id: 'dup' }] }))
      .toThrow(/ids must be unique/i);
  });

  it('enforces required WebDAV fields and URL scheme when scheduled', () => {
    expect(() => normalize({ destinations: [webdav({ destination: { baseUrl: '' }, schedule: { enabled: true } })] }))
      .toThrow(/server URL is required/i);
    expect(() => normalize({ destinations: [webdav({ destination: { baseUrl: 'ftp://x', username: 'u', password: 'p' }, schedule: { enabled: true } })] }))
      .toThrow(/must start with http/i);
  });

  it('enforces required S3 fields when scheduled', () => {
    const base = { type: 's3', schedule: { enabled: true, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 } };
    expect(() => normalize({ destinations: [{ ...base, destination: { bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' } }] }))
      .toThrow(/endpoint is required/i);
    expect(() => normalize({ destinations: [{ ...base, destination: { endpoint: 'https://s3', accessKeyId: 'a', secretAccessKey: 's' } }] }))
      .toThrow(/bucket is required/i);
    expect(() => normalize({ destinations: [{ ...base, destination: { endpoint: 'https://s3', bucket: 'b', secretAccessKey: 's' } }] }))
      .toThrow(/access key is required/i);
    expect(() => normalize({ destinations: [{ ...base, destination: { endpoint: 'https://s3', bucket: 'b', accessKeyId: 'a' } }] }))
      .toThrow(/secret key is required/i);
  });

  it('allows an incomplete destination when the schedule is disabled', () => {
    const out = normalize({ destinations: [{ type: 'webdav', destination: {}, schedule: { enabled: false } }] });
    expect(out.destinations[0].destination).toMatchObject({ baseUrl: '', username: '', password: '' });
  });

  it('validates retention, interval, start-time, and timezone ranges', () => {
    const sched = (s: Record<string, unknown>) => ({ destinations: [webdav({ schedule: { enabled: false, ...s } })] });
    expect(() => normalize(sched({ retentionCount: 0 }))).toThrow(/retention count/i);
    expect(() => normalize(sched({ retentionCount: 1001 }))).toThrow(/retention count/i);
    expect(() => normalize(sched({ intervalHours: 0 }))).toThrow(/interval hours/i);
    expect(() => normalize(sched({ intervalHours: 100 }))).toThrow(/interval hours/i);
    expect(() => normalize(sched({ startTime: '25:00' }))).toThrow(/start time/i);
    expect(() => normalize(sched({ startTime: 'noon' }))).toThrow(/start time/i);
    expect(() => normalize(sched({ timezone: 'Mars/Phobos' }))).toThrow(/timezone/i);
  });

  it('treats a null/empty retention as unlimited (null)', () => {
    const out = normalize({ destinations: [webdav({ schedule: { enabled: false, retentionCount: null } })] });
    expect(out.destinations[0].schedule.retentionCount).toBeNull();
  });
});

describe('parseBackupSettings', () => {
  it('returns defaults (one incomplete, disabled destination) for null or malformed JSON', () => {
    for (const parsed of [parseBackupSettings(null), parseBackupSettings('{not json')]) {
      expect(parsed.destinations).toHaveLength(1);
      expect(parsed.destinations[0].type).toBe('webdav');
      expect(parsed.destinations[0].schedule.enabled).toBe(false);
      expect(parsed.destinations[0].destination).toMatchObject({ baseUrl: '' });
    }
  });

  it('round-trips a serialized settings object', () => {
    const settings = normalize({ destinations: [webdav()] });
    const reparsed = parseBackupSettings(serializeBackupSettings(settings));
    expect(reparsed.destinations[0].destination).toMatchObject({ baseUrl: 'https://dav.example' });
  });

  it('upgrades a legacy single-destination shape', () => {
    const legacy = JSON.stringify({
      destinationType: 'webdav',
      destination: { baseUrl: 'https://legacy.example', username: 'u', password: 'p' },
      enabled: true,
      frequency: 'weekly',
      timezone: 'UTC',
    });
    const parsed = parseBackupSettings(legacy);
    expect(parsed.destinations).toHaveLength(1);
    expect(parsed.destinations[0].schedule.intervalHours).toBe(24 * 7);
  });

  it('applies global schedule fields to destinations that lack their own schedule', () => {
    const raw = JSON.stringify({
      enabled: true,
      // Daily frequency (omitted) keeps the interval within the 1-99h cap; the
      // global enable flag only activates the active destination.
      timezone: 'America/New_York',
      activeDestinationId: 'a',
      destinations: [
        { id: 'a', type: 'webdav', destination: { baseUrl: 'https://a.example', username: 'u', password: 'p' } },
        { id: 'b', type: 'webdav', destination: { baseUrl: 'https://b.example', username: 'u', password: 'p' } },
      ],
    });
    const parsed = parseBackupSettings(raw);
    const a = parsed.destinations.find((d) => d.id === 'a')!;
    const b = parsed.destinations.find((d) => d.id === 'b')!;
    expect(a.schedule.enabled).toBe(true);
    expect(a.schedule.intervalHours).toBe(24);
    expect(a.schedule.timezone).toBe('America/New_York');
    expect(b.schedule.enabled).toBe(false);
  });
});

describe('findBackupDestination / requireBackupDestination', () => {
  const settings = normalize({ destinations: [webdav(), { ...webdav(), destination: { baseUrl: 'https://second.example', username: 'u', password: 'p' } }] });

  it('finds by id and returns null for an unknown or empty id', () => {
    expect(findBackupDestination(settings, settings.destinations[1].id)?.id).toBe(settings.destinations[1].id);
    expect(findBackupDestination(settings, 'missing')).toBeNull();
    expect(findBackupDestination(settings, '')).toBeNull();
  });

  it('requires a destination — defaults to the first, throws when none', () => {
    expect(requireBackupDestination(settings).id).toBe(settings.destinations[0].id);
    expect(requireBackupDestination(settings, settings.destinations[1].id).id).toBe(settings.destinations[1].id);
    expect(() => requireBackupDestination(empty)).toThrow(/destination not found/i);
    expect(() => requireBackupDestination(settings, 'missing')).toThrow(/destination not found/i);
  });
});

describe('local-time helpers', () => {
  it('formats a UTC instant into a timezone-local date key and time', () => {
    // 2026-01-01T02:30:00Z is 2025-12-31 21:30 in America/New_York (UTC-5).
    const date = new Date('2026-01-01T02:30:00.000Z');
    expect(getBackupLocalDateKey(date, 'UTC')).toBe('2026-01-01');
    expect(getBackupLocalTime(date, 'UTC')).toBe('02:30');
    expect(getBackupLocalDateKey(date, 'America/New_York')).toBe('2025-12-31');
    expect(getBackupLocalTime(date, 'America/New_York')).toBe('21:30');
  });
});

describe('scheduler — isBackupDueNow / hasBackupSlotBetween', () => {
  const dest = (overrides: Partial<BackupDestinationRecord['schedule']> = {}, lastSuccessAt: string | null = null): BackupDestinationRecord => {
    const settings = normalize({ destinations: [webdav({ schedule: { enabled: true, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30, ...overrides } })] });
    const d = settings.destinations[0];
    d.runtime.lastSuccessAt = lastSuccessAt;
    return d;
  };

  it('is due within the window at the slot start and not before it', () => {
    const d = dest();
    expect(isBackupDueNow(d, new Date('2026-03-10T03:02:00.000Z'), 5)).toBe(true);
    expect(isBackupDueNow(d, new Date('2026-03-10T02:50:00.000Z'), 5)).toBe(false);
    expect(isBackupDueNow(d, new Date('2026-03-10T03:10:00.000Z'), 5)).toBe(false);
  });

  it('is not due when already succeeded at/after the slot, or when disabled', () => {
    const succeeded = dest({}, '2026-03-10T03:01:00.000Z');
    expect(isBackupDueNow(succeeded, new Date('2026-03-10T03:02:00.000Z'), 5)).toBe(false);
    const disabled = dest({ enabled: false });
    expect(isBackupDueNow(disabled, new Date('2026-03-10T03:02:00.000Z'), 5)).toBe(false);
  });

  it('detects a covered slot in a time range and respects lastSuccess', () => {
    const d = dest();
    const start = new Date('2026-03-10T00:00:00.000Z');
    const end = new Date('2026-03-11T00:00:00.000Z');
    expect(hasBackupSlotBetween(d, start, end)).toBe(true);

    const succeeded = dest({}, '2026-03-10T03:00:00.000Z');
    expect(hasBackupSlotBetween(succeeded, start, end)).toBe(false);
  });

  it('returns false for an empty/invalid range or a disabled schedule', () => {
    const d = dest();
    const t = new Date('2026-03-10T00:00:00.000Z');
    expect(hasBackupSlotBetween(d, t, t)).toBe(false);
    expect(hasBackupSlotBetween(d, new Date('2026-03-11T00:00:00.000Z'), t)).toBe(false);
    expect(hasBackupSlotBetween(dest({ enabled: false }), t, new Date('2026-03-11T00:00:00.000Z'))).toBe(false);
  });

  it('produces multiple intra-day slots for a short interval', () => {
    const d = dest({ intervalHours: 6, startTime: '00:00' });
    // Slots at 00,06,12,18 UTC. 12:01 is within the 5-min window of the 12:00 slot.
    expect(isBackupDueNow(d, new Date('2026-03-10T12:01:00.000Z'), 5)).toBe(true);
    expect(isBackupDueNow(d, new Date('2026-03-10T09:00:00.000Z'), 5)).toBe(false);
  });
});

describe('getDefaultBackupSettings', () => {
  it('seeds one disabled WebDAV destination and validates the timezone', () => {
    const out = getDefaultBackupSettings('UTC');
    expect(out.destinations).toHaveLength(1);
    expect(out.destinations[0].type).toBe('webdav');
    expect(out.destinations[0].schedule.enabled).toBe(false);
    expect(() => getDefaultBackupSettings('Not/AZone')).toThrow(/timezone/i);
  });
});
