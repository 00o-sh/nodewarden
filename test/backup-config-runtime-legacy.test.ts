import { describe, expect, it } from 'vitest';
import {
  normalizeBackupSettingsInput,
  parseBackupSettings,
  redactBackupSettingsSecrets,
} from '../src/services/backup-config';
import type { BackupSettings, S3BackupDestination, WebDavBackupDestination } from '../../shared/backup-schema';

// Runtime-state sanitization and legacy single-destination upgrade branches of
// the backup config. Pure normalization — no bindings.

const empty: BackupSettings = { destinations: [] };

const webdav = (overrides: Record<string, unknown> = {}) => ({
  type: 'webdav',
  destination: { baseUrl: 'https://dav.example', username: 'u', password: 'p', remotePath: 'nw' },
  schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
  ...overrides,
});

describe('normalizeRuntime (via normalizeBackupSettingsInput)', () => {
  it('coerces valid timestamps to ISO and drops invalid ones', () => {
    const out = normalizeBackupSettingsInput({
      destinations: [webdav({
        runtime: {
          lastAttemptAt: '2026-01-02T03:04:05Z',
          lastSuccessAt: 'not-a-date',
          lastErrorAt: '',
          lastAttemptLocalDate: '  2026-01-02  ',
          lastErrorMessage: '  boom  ',
          lastUploadedFileName: 'x.zip',
          lastUploadedSizeBytes: '12.9',
          lastUploadedDestination: 'dav',
        },
      })],
    } as any, empty);
    const rt = out.destinations[0].runtime;
    expect(rt.lastAttemptAt).toBe('2026-01-02T03:04:05.000Z');
    expect(rt.lastSuccessAt).toBeNull();
    expect(rt.lastErrorAt).toBeNull();
    expect(rt.lastAttemptLocalDate).toBe('2026-01-02');
    expect(rt.lastErrorMessage).toBe('boom');
    expect(rt.lastUploadedFileName).toBe('x.zip');
    // Non-integer numbers are floored; the field is a byte count.
    expect(rt.lastUploadedSizeBytes).toBe(12);
    expect(rt.lastUploadedDestination).toBe('dav');
  });

  it('treats negative / non-finite / empty numeric sizes as null', () => {
    const mk = (size: unknown) => normalizeBackupSettingsInput(
      { destinations: [webdav({ runtime: { lastUploadedSizeBytes: size } })] } as any,
      empty
    ).destinations[0].runtime.lastUploadedSizeBytes;
    expect(mk(-5)).toBeNull();
    expect(mk('abc')).toBeNull();
    expect(mk('')).toBeNull();
    expect(mk(0)).toBe(0);
  });

  it('defaults an absent runtime to an all-null state', () => {
    const rt = normalizeBackupSettingsInput({ destinations: [webdav()] } as any, empty).destinations[0].runtime;
    expect(rt).toEqual({
      lastAttemptAt: null,
      lastAttemptLocalDate: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      lastUploadedFileName: null,
      lastUploadedSizeBytes: null,
      lastUploadedDestination: null,
    });
  });
});

describe('parseBackupSettings — legacy single-destination shapes', () => {
  it('maps the legacy "e3" alias to an s3 destination', () => {
    const parsed = parseBackupSettings(JSON.stringify({
      destinationType: 'e3',
      destination: { endpoint: 'https://s3.example', bucket: 'b', accessKeyId: 'ak', secretAccessKey: 'sk' },
      enabled: false,
      frequency: 'monthly',
    }));
    expect(parsed.destinations).toHaveLength(1);
    expect(parsed.destinations[0].type).toBe('s3');
    expect(parsed.destinations[0].schedule.intervalHours).toBe(24 * 30);
  });

  it('defaults an unknown legacy destination type to webdav', () => {
    const parsed = parseBackupSettings(JSON.stringify({
      destinationType: 'dropbox',
      destination: { baseUrl: 'https://dav.example', username: 'u', password: 'p' },
      enabled: false,
    }));
    expect(parsed.destinations[0].type).toBe('webdav');
    // Unknown frequency falls back to the default interval.
    expect(parsed.destinations[0].schedule.intervalHours).toBe(24);
  });
});

describe('redactBackupSettingsSecrets', () => {
  it('masks a populated secret and blanks an empty one, for both providers', () => {
    const settings = normalizeBackupSettingsInput({
      destinations: [
        webdav(),
        {
          type: 's3',
          destination: { endpoint: 'https://s3.example', bucket: 'b', accessKeyId: 'ak', secretAccessKey: 'sk', region: 'auto' },
          schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
        },
      ],
    } as any, empty);

    const redacted = redactBackupSettingsSecrets(settings);
    const dav = redacted.destinations[0].destination as WebDavBackupDestination;
    const s3 = redacted.destinations[1].destination as S3BackupDestination;
    expect(dav.password).toBe('********');
    expect(s3.secretAccessKey).toBe('********');

    // A destination with a blank secret redacts to an empty string, not the mask.
    const blank = redactBackupSettingsSecrets({
      destinations: [{ ...settings.destinations[1], destination: { ...s3, secretAccessKey: '' } }],
    });
    expect((blank.destinations[0].destination as S3BackupDestination).secretAccessKey).toBe('');
  });
});
