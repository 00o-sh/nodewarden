import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeMasterPassword } from '@/lib/api/auth';
import { encryptBw, hkdfExpand, pbkdf2 } from '@/lib/crypto';

// changeMasterPassword re-derives the old enc/mac keys, decrypts the stored
// profile key, and refuses to proceed unless it yields a 64-byte user symmetric
// key. Exercise that guard with a profile key that decrypts to the wrong length.
describe('changeMasterPassword profile-key validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a profile key that does not decrypt to a 64-byte user symmetric key', async () => {
    const email = 'user@example.com';
    const currentPassword = 'current-password';
    const iterations = 600000;

    // deriveLoginHash performs a prelogin fetch; stub it to return the KDF config.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kdfIterations: iterations }), { status: 200 })
    ));

    // Reproduce the enc/mac keys the handler derives, then encrypt a 32-byte
    // value (not the required 64) so decryption yields the wrong length.
    const masterKey = await pbkdf2(currentPassword, email.toLowerCase(), iterations, 32);
    const enc = await hkdfExpand(masterKey, 'enc', 32);
    const mac = await hkdfExpand(masterKey, 'mac', 32);
    const badProfileKey = await encryptBw(new Uint8Array(32), enc, mac);

    await expect(changeMasterPassword(vi.fn() as any, {
      email,
      currentPassword,
      newPassword: 'new-password-12',
      currentIterations: iterations,
      profileKey: badProfileKey,
    })).rejects.toThrow('Invalid profile key');
  });
});
