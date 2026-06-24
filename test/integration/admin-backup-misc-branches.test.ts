import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/types';
import { Session, api, authenticate } from './helpers';
import { StorageService } from '../../src/services/storage';
import {
  handleRepairAdminBackupSettings,
  handleAdminExportBackup,
  seedDefaultBackupSettings,
} from '../../src/handlers/backup';
import {
  BACKUP_SETTINGS_CONFIG_KEY,
  getDefaultBackupSettings,
  loadBackupSettings,
  saveBackupSettings,
} from '../../src/services/backup-config';

// Exercises three real backup.ts branches that only surface under genuine error
// conditions, by calling the exported handlers directly with a real admin User
// and crafted-but-real env states. No fabricated behaviour: the decrypt failure
// is real AES-GCM with a mismatched key, the export failure is a real missing
// DB binding, and the seed paths are driven by the real config row's presence.
let session: Session;
let admin: User;

const jsonReq = (body: unknown) =>
  new Request('https://vault.test/api/admin/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  session = await authenticate('adminbackupmisc');
  const adminId = ((await (await api('GET', '/api/accounts/profile', session.accessToken)).json()) as any).id;
  const storage = new StorageService((env as any).DB);
  admin = (await storage.getUserById(adminId)) as User;
});

describe('admin backup settings repair when persisted settings cannot be decrypted', () => {
  it('falls back to defaults and repairs from the request body', async () => {
    const storage = new StorageService((env as any).DB);
    // Persist an envelope encrypted under a DIFFERENT runtime secret, mimicking
    // a restore onto an instance whose JWT_SECRET has changed. loadBackupSettings
    // then fails to decrypt and the repair handler must fall back to defaults.
    const otherSecretEnv = { ...(env as any), JWT_SECRET: `${(env as any).JWT_SECRET || ''}_rotated` };
    await saveBackupSettings(storage, otherSecretEnv as any, getDefaultBackupSettings('UTC'));
    await expect(loadBackupSettings(storage, env as any, 'UTC')).rejects.toThrow();

    const res = await handleRepairAdminBackupSettings(jsonReq({ destinations: [] }), env as any, admin);
    expect(res.status).toBe(200);
    const repaired = (await res.json()) as any;
    expect(Array.isArray(repaired.destinations)).toBe(true);
    // The repair re-encrypted under the live secret, so it now decrypts cleanly.
    await expect(loadBackupSettings(storage, env as any, 'UTC')).resolves.toBeTruthy();
  });
});

describe('admin backup export when the database binding is unavailable', () => {
  it('reports the failure as a 500', async () => {
    const brokenEnv = { ...(env as any), DB: undefined };
    const res = await handleAdminExportBackup(jsonReq({ includeAttachments: false }), brokenEnv as any, admin);
    expect(res.status).toBe(500);
  });
});

describe('seedDefaultBackupSettings', () => {
  it('seeds defaults when no settings row exists, then normalizes an existing row', async () => {
    const storage = new StorageService((env as any).DB);
    // Remove any seeded row so the "no current value" path runs and writes defaults.
    await (env as any).DB.prepare('DELETE FROM config WHERE key = ?').bind(BACKUP_SETTINGS_CONFIG_KEY).run();
    expect(await storage.getConfigValue(BACKUP_SETTINGS_CONFIG_KEY)).toBeNull();

    await seedDefaultBackupSettings(env as any);
    expect(await storage.getConfigValue(BACKUP_SETTINGS_CONFIG_KEY)).toBeTruthy();

    // A second call takes the "row already present" branch (normalize + return).
    await seedDefaultBackupSettings(env as any);
    expect(await storage.getConfigValue(BACKUP_SETTINGS_CONFIG_KEY)).toBeTruthy();
  });
});
