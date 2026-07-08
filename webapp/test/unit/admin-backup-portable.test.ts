import { describe, expect, it } from 'vitest';
import { decryptPortableBackupSettings } from '@/lib/admin-backup-portable';
import { bytesToBase64, encryptBw } from '@/lib/crypto';
import type { BackupSettingsPortablePayload } from '@/lib/api/backup';
import type { Profile, SessionState } from '@/lib/types';

// The user (admin) session key material used to wrap the RSA private key.
const symEnc = new Uint8Array(32).map((_, i) => (i + 1) & 0xff);
const symMac = new Uint8Array(32).map((_, i) => (i + 200) & 0xff);
const symEncKey = bytesToBase64(symEnc);
const symMacKey = bytesToBase64(symMac);

function toBuf(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

async function buildFixture(settings: Record<string, unknown>, userId = 'admin-1') {
  // 1. Generate the portable RSA-OAEP (SHA-1) key pair the server would hold.
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
    true,
    ['encrypt', 'decrypt']
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  // The admin's profile stores the RSA private key wrapped under the vault key.
  const wrappedPrivateKey = await encryptBw(pkcs8, symEnc, symMac);

  // 2. A random AES-GCM data encryption key, wrapped for the admin via RSA-OAEP.
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const wrappedKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pair.publicKey, toBuf(dek))
  );

  // 3. Encrypt the settings JSON with AES-GCM under the DEK.
  const aesKey = await crypto.subtle.importKey('raw', toBuf(dek), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toBuf(iv) },
      aesKey,
      new TextEncoder().encode(JSON.stringify(settings))
    )
  );

  const portable: BackupSettingsPortablePayload = {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    wraps: [{ userId, wrappedKey: bytesToBase64(wrappedKey) }],
  };
  const profile = { id: userId, privateKey: wrappedPrivateKey } as unknown as Profile;
  const session = { symEncKey, symMacKey } as unknown as SessionState;
  return { portable, profile, session };
}

describe('decryptPortableBackupSettings', () => {
  it('round-trips the encrypted settings for the current administrator', async () => {
    const settings = { schedule: { intervalHours: 24 }, destinations: [{ id: 'd1', type: 'webdav' }] };
    const { portable, profile, session } = await buildFixture(settings);
    const result = await decryptPortableBackupSettings(portable, profile, session);
    expect(result).toEqual(settings);
  });

  it('selects the wrap that matches the administrator id among several', async () => {
    const settings = { marker: 'mine' };
    const { portable, profile, session } = await buildFixture(settings, 'admin-1');
    // Prepend an unrelated wrap that must be ignored.
    portable.wraps.unshift({ userId: 'someone-else', wrappedKey: 'AAAA' });
    const result = await decryptPortableBackupSettings(portable, profile, session);
    expect((result as Record<string, unknown>).marker).toBe('mine');
  });

  it('throws when the profile is missing an id', async () => {
    const { portable, session } = await buildFixture({});
    const profile = { id: '', privateKey: 'x' } as unknown as Profile;
    await expect(decryptPortableBackupSettings(portable, profile, session)).rejects.toThrow(/missing an id/i);
  });

  it('throws when the profile is missing a private key', async () => {
    const { portable, session } = await buildFixture({});
    const profile = { id: 'admin-1', privateKey: null } as unknown as Profile;
    await expect(decryptPortableBackupSettings(portable, profile, session)).rejects.toThrow(/missing a private key/i);
  });

  it('throws when the session has no unlocked vault keys', async () => {
    const { portable, profile } = await buildFixture({});
    const session = { symEncKey: '', symMacKey: '' } as unknown as SessionState;
    await expect(decryptPortableBackupSettings(portable, profile, session)).rejects.toThrow(/unlocked vault keys/i);
  });

  it('throws when no wrap is available for the administrator', async () => {
    const { portable, profile, session } = await buildFixture({}, 'admin-1');
    portable.wraps = [{ userId: 'another-admin', wrappedKey: 'AAAA' }];
    await expect(decryptPortableBackupSettings(portable, profile, session)).rejects.toThrow(/no portable backup settings wrap/i);
  });
});
