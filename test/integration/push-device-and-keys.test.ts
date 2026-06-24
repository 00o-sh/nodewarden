import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/services/storage';
import { normalizeImportedBackupSettings } from '../../src/services/backup-config';
import { api, authenticate, type Session } from './helpers';

// Coverage for storage/account helpers introduced by the upstream sync: the
// device push-token lifecycle (set / read / clear), the account-keys endpoint,
// and a few standalone repo/settings helpers. Real D1, no mocks — the push
// relay stays disabled so nothing leaves the worker.
let session: Session;
let token: string;
let userId: string;

const db = (): D1Database => (env as { DB: D1Database }).DB;
const storage = (): StorageService => new StorageService(db());

beforeAll(async () => {
  session = await authenticate('pushdevkeys');
  token = session.accessToken;
  userId = JSON.parse(atob(token.split('.')[1])).sub as string;
});

describe('account keys endpoint', () => {
  it('returns the caller’s own wrapped key material', async () => {
    const res = await api('GET', '/api/accounts/keys', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.Key).toBe('string');
    expect(body.Object).toBe('keys');
  });
});

describe('device push-token storage lifecycle', () => {
  it('sets, reads, and clears a device push token', async () => {
    const deviceIdentifier = session.account.deviceIdentifier;

    expect(await storage().updateDevicePushToken(userId, deviceIdentifier, 'push-uuid-1', 'push-token-1')).toBe(true);
    expect(await storage().getDevicePushUuid(userId, deviceIdentifier)).toBe('push-uuid-1');
    expect(await storage().userHasPushDevice(userId)).toBe(true);

    const cleared = await storage().clearDevicePushToken(userId, deviceIdentifier);
    expect(cleared).toEqual({ pushUuid: 'push-uuid-1' });
    expect(await storage().userHasPushDevice(userId)).toBe(false);

    // Clearing a device that does not exist resolves to null.
    expect(await storage().clearDevicePushToken(userId, crypto.randomUUID())).toBeNull();
  });

  it('upserts, re-keys, renames, touches and deletes a device', async () => {
    const s = storage();
    const deviceId = crypto.randomUUID();

    // Insert with session stamp + encrypted keys (exercises the keyed-insert branch).
    await s.upsertDevice(userId, deviceId, 'Laptop', 9, 'stamp-1', {
      encryptedUserKey: 'euk',
      encryptedPublicKey: 'epk',
      encryptedPrivateKey: 'eprk',
    });
    let device = await s.getDevice(userId, deviceId);
    expect(device?.name).toBe('Laptop');

    // Upsert again (update path) without keys, then patch keys separately.
    await s.upsertDevice(userId, deviceId, 'Laptop Renamed', 9, 'stamp-2');
    expect(await s.updateDeviceKeys(userId, deviceId, { encryptedUserKey: 'euk2' })).toBe(true);
    expect(await s.updateDeviceName(userId, deviceId, 'Final Name')).toBe(true);
    expect(await s.touchDeviceLastSeen(userId, deviceId)).toBe(true);

    const devices = await s.getDevicesByUserId(userId);
    expect(devices.some((d) => d.deviceIdentifier === deviceId)).toBe(true);

    // Updates against a non-existent device return false.
    expect(await s.updateDeviceName(userId, crypto.randomUUID(), 'x')).toBe(false);
    expect(await s.updateDeviceKeys(userId, crypto.randomUUID(), { encryptedUserKey: 'x' })).toBe(false);

    expect(await s.deleteDevice(userId, deviceId)).toBe(true);
    expect(await s.deleteDevice(userId, deviceId)).toBe(false);
  });
});

describe('standalone storage / settings helpers', () => {
  it('returns null for an unknown account passkey credential id', async () => {
    expect(await storage().getAccountPasskeyCredentialById(userId, crypto.randomUUID())).toBeNull();
  });

  it('returns null for an unknown auth request id', async () => {
    expect(await storage().getAuthRequestById(crypto.randomUUID())).toBeNull();
  });

  it('deleting all attachments for a cipher with none is a no-op', async () => {
    await expect(storage().deleteAllAttachmentsByCipher(crypto.randomUUID())).resolves.toBeUndefined();
  });

  it('normalizes imported backup settings without error when none are configured', async () => {
    await expect(normalizeImportedBackupSettings(storage(), env as any, 'UTC')).resolves.toBeUndefined();
  });
});
