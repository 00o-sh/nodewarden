import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { authenticate } from './helpers';
import { StorageService } from '../../src/services/storage';
import {
  BACKUP_SETTINGS_CONFIG_KEY,
  getBackupSettingsRepairState,
  getDefaultBackupSettings,
  normalizeImportedBackupSettingsValue,
  serializeBackupSettings,
} from '../../src/services/backup-config';
import { encryptBackupSettingsEnvelope, parseBackupSettingsEnvelope } from '../../src/services/backup-settings-crypto';

// Settings-envelope normalization and repair-state detection. The runtime
// encryption layer is keyed from JWT_SECRET (independent of user keys), so the
// envelope round-trips and the decrypt-failure branches are exercised with real
// crypto against the live env. No mocks.
let storage: StorageService;
let users: any[];
const plain = () => serializeBackupSettings(getDefaultBackupSettings('UTC'));

async function corruptEnvelope(): Promise<string> {
  const real = await encryptBackupSettingsEnvelope(plain(), env as any, users);
  const obj = JSON.parse(real);
  obj.runtime.ciphertext = btoa('not-a-valid-ciphertext-payload-xxxxxxxxxx');
  return JSON.stringify(obj);
}

beforeAll(async () => {
  await authenticate('settingsnorm');
  storage = new StorageService((env as any).DB);
  users = await storage.getAllUsers();
});

describe('normalizeImportedBackupSettingsValue', () => {
  it('returns null for empty input', async () => {
    expect(await normalizeImportedBackupSettingsValue(null, env as any, users, 'UTC')).toBeNull();
  });

  it('wraps a plain (non-envelope) settings value into an envelope', async () => {
    const result = await normalizeImportedBackupSettingsValue(plain(), env as any, users, 'UTC');
    expect(result).toBeTruthy();
    expect(parseBackupSettingsEnvelope(result)).not.toBeNull();
  });

  it('re-normalizes an existing decryptable envelope', async () => {
    const envelope = await encryptBackupSettingsEnvelope(plain(), env as any, users);
    const result = await normalizeImportedBackupSettingsValue(envelope, env as any, users, 'UTC');
    expect(result).toBeTruthy();
    expect(parseBackupSettingsEnvelope(result)).not.toBeNull();
  });

  it('keeps an undecryptable envelope intact', async () => {
    const corrupt = await corruptEnvelope();
    const result = await normalizeImportedBackupSettingsValue(corrupt, env as any, users, 'UTC');
    expect(result).toBe(corrupt);
  });
});

describe('getBackupSettingsRepairState', () => {
  it('reports no repair needed and re-wraps a plain stored value', async () => {
    await storage.setConfigValue(BACKUP_SETTINGS_CONFIG_KEY, plain());
    const state = await getBackupSettingsRepairState(storage, env as any, 'UTC');
    expect(state.needsRepair).toBe(false);
    // The plain value was re-wrapped into an envelope on read.
    expect(parseBackupSettingsEnvelope(await storage.getConfigValue(BACKUP_SETTINGS_CONFIG_KEY))).not.toBeNull();
  });

  it('reports no repair needed for a decryptable envelope', async () => {
    await storage.setConfigValue(BACKUP_SETTINGS_CONFIG_KEY, await encryptBackupSettingsEnvelope(plain(), env as any, users));
    const state = await getBackupSettingsRepairState(storage, env as any, 'UTC');
    expect(state.needsRepair).toBe(false);
  });

  it('flags an undecryptable envelope as needing repair', async () => {
    await storage.setConfigValue(BACKUP_SETTINGS_CONFIG_KEY, await corruptEnvelope());
    const state = await getBackupSettingsRepairState(storage, env as any, 'UTC');
    expect(state.needsRepair).toBe(true);
  });
});
