import { describe, expect, it } from 'vitest';
import { parseBackupSettings } from '../../src/services/backup-config';

// parseBackupSettings reads previously-stored (plaintext) backup config and
// upgrades two legacy shapes: a destinations array with a global frequency/enabled
// flag (per-destination schedules are synthesized, then re-normalized), and the
// oldest single-destination format with no destinations array at all. These
// upgrade branches are pure and were unexercised. No mocks.
const webdav = { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nw' };

describe('legacy backup settings parsing', () => {
  it('synthesizes a per-destination schedule for a destinations-array + global-frequency config', () => {
    // No per-destination schedule is present, so the global frequency/enabled flag
    // drives a synthesized (then normalized) schedule for the upgraded destination.
    const settings = parseBackupSettings(JSON.stringify({
      enabled: true,
      frequency: 'weekly',
      activeDestinationId: 'd1',
      timezone: 'UTC',
      destinations: [{ id: 'd1', type: 'webdav', destination: webdav }],
    }));
    expect(settings.destinations).toHaveLength(1);
    expect(settings.destinations[0].type).toBe('webdav');
    expect(settings.destinations[0].schedule).toBeDefined();
    expect(settings.destinations[0].schedule.intervalHours).toBeGreaterThan(0);
  });

  it('handles the monthly global-frequency branch of the same shape', () => {
    const settings = parseBackupSettings(JSON.stringify({
      enabled: false,
      frequency: 'monthly',
      destinations: [{ id: 'd1', type: 'webdav', destination: webdav }],
    }));
    expect(settings.destinations).toHaveLength(1);
    expect(settings.destinations[0].schedule.intervalHours).toBeGreaterThan(0);
  });

  it('upgrades the oldest single-destination format (no destinations array) preserving the weekly interval', () => {
    // parseLegacyBackupSettings builds the destination directly (no re-normalization),
    // so the legacy weekly frequency maps straight to a 168h interval.
    const settings = parseBackupSettings(JSON.stringify({
      enabled: true,
      frequency: 'weekly',
      destinationType: 's3',
      timezone: 'UTC',
      destination: { endpoint: 'https://s3.test', bucket: 'b', accessKeyId: 'ak', secretAccessKey: 'sk', region: 'auto' },
    }));
    expect(settings.destinations).toHaveLength(1);
    expect(settings.destinations[0].type).toBe('s3');
    expect(settings.destinations[0].schedule.intervalHours).toBe(24 * 7);
  });

  it('falls back to default settings when the stored value is not valid JSON', () => {
    const settings = parseBackupSettings('{not json');
    expect(Array.isArray(settings.destinations)).toBe(true);
  });
});
