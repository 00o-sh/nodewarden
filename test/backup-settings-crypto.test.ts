import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import {
  decryptBackupSettingsRuntime,
  encryptBackupSettingsEnvelope,
  exportPortableBackupSettingsEnvelope,
  parseBackupSettingsEnvelope,
} from '../src/services/backup-settings-crypto';

const env = (secret: string): Env => ({ JWT_SECRET: secret }) as Env;
const SECRET = `backup-test-${'x'.repeat(40)}`;
const SECRET2 = `backup-other-${'y'.repeat(40)}`;

// Backup provider credentials are stored encrypted; this is the contract that
// keeps them confidential at rest, so guard the round-trip and the envelope shape.
describe('backup settings runtime crypto', () => {
  it('round-trips plaintext through encrypt -> decrypt with the same secret', async () => {
    const plaintext = JSON.stringify({ provider: 's3', bucket: 'vault', secretKey: 'shhh' });
    const envelope = await encryptBackupSettingsEnvelope(plaintext, env(SECRET), []);

    // The ciphertext must not leak the plaintext.
    expect(envelope).not.toContain('shhh');

    expect(await decryptBackupSettingsRuntime(envelope, env(SECRET))).toBe(plaintext);
  });

  it('produces a valid v2 envelope (runtime + portable, no wraps without admins)', async () => {
    const envelope = await encryptBackupSettingsEnvelope('{"a":1}', env(SECRET), []);
    const parsed = parseBackupSettingsEnvelope(envelope);
    expect(parsed?.version).toBe(2);
    expect(parsed?.runtime.iv).toBeTruthy();
    expect(parsed?.runtime.ciphertext).toBeTruthy();
    expect(parsed?.portable.wraps).toEqual([]);
  });

  it('fails to decrypt with the wrong secret', async () => {
    const envelope = await encryptBackupSettingsEnvelope('{"a":1}', env(SECRET), []);
    await expect(decryptBackupSettingsRuntime(envelope, env(SECRET2))).rejects.toBeTruthy();
  });
});

describe('parseBackupSettingsEnvelope', () => {
  it('rejects null, non-JSON, wrong version, and missing fields', () => {
    expect(parseBackupSettingsEnvelope(null)).toBeNull();
    expect(parseBackupSettingsEnvelope('not json')).toBeNull();
    expect(parseBackupSettingsEnvelope(JSON.stringify({ version: 1 }))).toBeNull();
    expect(
      parseBackupSettingsEnvelope(JSON.stringify({ version: 2, runtime: {}, portable: {} }))
    ).toBeNull();
  });

  it('drops malformed wrap entries', () => {
    const parsed = parseBackupSettingsEnvelope(
      JSON.stringify({
        version: 2,
        runtime: { iv: 'a', ciphertext: 'b' },
        portable: {
          iv: 'c',
          ciphertext: 'd',
          wraps: [{ userId: 'u1', wrappedKey: 'k1' }, { userId: '', wrappedKey: 'k2' }, { junk: true }],
        },
      })
    );
    expect(parsed?.portable.wraps).toEqual([{ userId: 'u1', wrappedKey: 'k1' }]);
  });
});

describe('exportPortableBackupSettingsEnvelope', () => {
  it('strips the runtime ciphertext but keeps the portable section', async () => {
    const envelope = await encryptBackupSettingsEnvelope('{"secret":"value"}', env(SECRET), []);
    const portable = exportPortableBackupSettingsEnvelope(envelope);
    const parsedExport = JSON.parse(portable!);
    expect(parsedExport.portableOnly).toBe(true);
    expect(parsedExport.runtime.ciphertext).toBe('');
    // Portable ciphertext is retained for cross-instance restore.
    expect(parsedExport.portable.ciphertext).toBeTruthy();
  });

  it('returns null for an invalid envelope', () => {
    expect(exportPortableBackupSettingsEnvelope('garbage')).toBeNull();
  });
});
