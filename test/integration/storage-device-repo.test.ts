import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/services/storage';
import type { User } from '../../src/types';
import { enc } from './helpers';

// Direct device + trusted-token repo coverage against D1.
const storage = new StorageService(env.DB);

beforeAll(async () => {
  await storage.initializeDatabase();
});

async function makeUser(): Promise<User> {
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email: `dev-${crypto.randomUUID()}@vault.test`,
    name: 'Dev',
    masterPasswordHint: null,
    masterPasswordHash: enc('mph'),
    key: enc('key'),
    privateKey: enc('priv'),
    publicKey: 'pub',
    kdfType: 0,
    kdfIterations: 600000,
    kdfMemory: undefined,
    kdfParallelism: undefined,
    securityStamp: crypto.randomUUID(),
    role: 'user',
    status: 'active',
    verifyDevices: true,
    totpSecret: null,
    totpRecoveryCode: null,
    apiKey: null,
    createdAt: now,
    updatedAt: now,
  } as User;
  await storage.createUser(user);
  return user;
}

describe('device repo', () => {
  it('upserts, reads, renames, and deletes a device scoped to its owner', async () => {
    const user = await makeUser();
    const deviceId = crypto.randomUUID();

    await storage.upsertDevice(user.id, deviceId, 'Phone', 1, 'stamp-1');
    expect(await storage.isKnownDevice(user.id, deviceId)).toBe(true);
    expect((await storage.getDevice(user.id, deviceId))?.name).toBe('Phone');
    expect((await storage.getDevicesByUserId(user.id)).map((d) => d.deviceIdentifier)).toContain(deviceId);

    // updateDeviceName sets the display note (the system name stays put).
    expect(await storage.updateDeviceName(user.id, deviceId, 'Tablet')).toBe(true);
    expect((await storage.getDevice(user.id, deviceId))?.deviceNote).toBe('Tablet');

    // Owner scoping: a different user does not see the device.
    const other = await makeUser();
    expect(await storage.isKnownDevice(other.id, deviceId)).toBe(false);

    expect(await storage.deleteDevice(user.id, deviceId)).toBe(true);
    expect(await storage.getDevice(user.id, deviceId)).toBeNull();
  });

  it('resolves a known device by email', async () => {
    const user = await makeUser();
    const deviceId = crypto.randomUUID();
    await storage.upsertDevice(user.id, deviceId, 'Phone', 1, 'stamp');
    expect(await storage.isKnownDeviceByEmail(user.email, deviceId)).toBe(true);
    expect(await storage.isKnownDeviceByEmail(user.email, crypto.randomUUID())).toBe(false);
  });
});

describe('trusted two-factor device tokens', () => {
  it('stores and resolves a device-bound remember token', async () => {
    const user = await makeUser();
    const deviceId = crypto.randomUUID();
    const rememberToken = `remember-${crypto.randomUUID()}`;

    await storage.saveTrustedTwoFactorDeviceToken(rememberToken, user.id, deviceId);
    expect(await storage.getTrustedTwoFactorDeviceTokenUserId(rememberToken, deviceId)).toBe(user.id);
    // Wrong device id does not resolve.
    expect(await storage.getTrustedTwoFactorDeviceTokenUserId(rememberToken, crypto.randomUUID())).toBeNull();

    const summaries = await storage.getTrustedDeviceTokenSummariesByUserId(user.id);
    expect(Array.isArray(summaries)).toBe(true);

    expect(await storage.deleteTrustedTwoFactorTokensByDevice(user.id, deviceId)).toBeGreaterThanOrEqual(1);
    expect(await storage.getTrustedTwoFactorDeviceTokenUserId(rememberToken, deviceId)).toBeNull();
  });
});
