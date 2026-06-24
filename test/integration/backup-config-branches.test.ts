import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';
import { StorageService } from '../../src/services/storage';
import {
  BACKUP_SETTINGS_CONFIG_KEY,
  getBackupSettingsRepairState,
  loadBackupSettings,
} from '../../src/services/backup-config';

// Backup settings persistence branches: a legacy (non-envelope) plaintext value
// is parsed and re-saved on load, and the admin settings endpoint rejects a
// non-object destination and more than the maximum number of destinations.
// Real D1 + env, no mocks.
let session: Session;
let token: string;

const legacy = () => JSON.stringify({ destinations: [] });

beforeAll(async () => {
  session = await authenticate('backupconfigbranches');
  token = session.accessToken;
});

describe('legacy non-envelope settings are upgraded on read', () => {
  it('parses and re-saves a plaintext settings value on load', async () => {
    const storage = new StorageService((env as any).DB);
    await storage.setConfigValue(BACKUP_SETTINGS_CONFIG_KEY, legacy());
    const settings = await loadBackupSettings(storage, env as any, 'UTC');
    expect(Array.isArray(settings.destinations)).toBe(true);
  });

  it('treats a plaintext settings value as not needing repair', async () => {
    const storage = new StorageService((env as any).DB);
    await storage.setConfigValue(BACKUP_SETTINGS_CONFIG_KEY, legacy());
    const state = await getBackupSettingsRepairState(storage, env as any, 'UTC');
    expect(state.needsRepair).toBe(false);
  });
});

describe('admin settings destination validation', () => {
  it('400s a destination that is not an object', async () => {
    const res = await api('PUT', '/api/admin/backup/settings', token, { destinations: [42] });
    expect(res.status).toBe(400);
  });

  it('400s more than the maximum number of destinations', async () => {
    const destinations = Array.from({ length: 25 }, () => ({
      type: 'webdav', includeAttachments: false,
      destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
      schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
    }));
    const res = await api('PUT', '/api/admin/backup/settings', token, { destinations });
    expect(res.status).toBe(400);
  });
});
