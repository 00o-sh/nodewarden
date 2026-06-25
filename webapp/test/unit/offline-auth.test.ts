import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOfflineUnlockRecord,
  getOfflineUnlockKdfIterations,
  hasOfflineUnlockRecord,
  kdfIterationsFromLogin,
  loadOfflineProfileSnapshot,
  saveOfflineUnlockRecord,
  unlockOfflineVault,
  unlockOfflineVaultWithMasterKey,
} from '@/lib/offline-auth';
import { bytesToBase64, encryptBw, hkdfExpand, pbkdf2 } from '@/lib/crypto';
import type { Profile, SessionState, TokenSuccess } from '@/lib/types';

const OFFLINE_UNLOCK_KEY = 'nodewarden.web.offline-unlock.v1';
const EMAIL = 'User@Example.com';
const NORMALIZED_EMAIL = 'user@example.com';
const PASSWORD = 'correct horse battery staple';
const ITERATIONS = 1000; // low for fast PBKDF2 in tests

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-id',
    email: EMAIL,
    name: 'Test User',
    key: 'should-be-stripped',
    privateKey: 'should-be-stripped',
    publicKey: 'pubkey',
    role: 'user',
    ...overrides,
  };
}

// Derive the master key the same way deriveLoginHashLocally does, then wrap a
// random 64-byte symmetric key with the HKDF-expanded enc/mac keys to build a
// valid profileKey cipher string that unlockVaultKey can decrypt.
async function buildValidProfileKey(
  email: string,
  password: string,
  iterations: number
): Promise<{ profileKey: string; sym: Uint8Array; masterKey: Uint8Array }> {
  const normalizedEmail = email.trim().toLowerCase();
  const masterKey = await pbkdf2(password, normalizedEmail, iterations, 32);
  const encKey = await hkdfExpand(masterKey, 'enc', 32);
  const macKey = await hkdfExpand(masterKey, 'mac', 32);
  const sym = new Uint8Array(64);
  for (let i = 0; i < sym.length; i += 1) sym[i] = (i * 7 + 3) & 0xff;
  const profileKey = await encryptBw(sym, encKey, macKey);
  return { profileKey, sym, masterKey };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    email: NORMALIZED_EMAIL,
    authMode: 'token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    ...overrides,
  };
}

describe('offline-auth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('saveOfflineUnlockRecord + read helpers', () => {
    it('persists a normalized record readable by the helpers', () => {
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey: 'profile-key-cipher',
        kdfIterations: ITERATIONS,
      });
      expect(hasOfflineUnlockRecord()).toBe(true);
      expect(hasOfflineUnlockRecord(EMAIL)).toBe(true);
      expect(hasOfflineUnlockRecord(NORMALIZED_EMAIL)).toBe(true);
      expect(getOfflineUnlockKdfIterations()).toBe(ITERATIONS);
      expect(getOfflineUnlockKdfIterations(EMAIL)).toBe(ITERATIONS);
    });

    it('strips secrets from the persisted profile and snapshot', () => {
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey: 'profile-key-cipher',
        kdfIterations: ITERATIONS,
      });
      const raw = JSON.parse(localStorage.getItem(OFFLINE_UNLOCK_KEY) as string);
      expect(raw.profile.key).toBe('');
      expect(raw.profile.privateKey).toBeNull();
      expect(raw.profile.email).toBe(NORMALIZED_EMAIL);
      expect(raw.version).toBe(1);
      expect(typeof raw.savedAt).toBe('number');

      const snapshot = loadOfflineProfileSnapshot();
      expect(snapshot?.key).toBe('');
      expect(snapshot?.privateKey).toBeNull();
      expect(snapshot?.email).toBe(NORMALIZED_EMAIL);
    });

    it('falls back to the profile email when args.email is empty', () => {
      saveOfflineUnlockRecord({
        email: '',
        profile: makeProfile({ email: EMAIL }),
        profileKey: 'profile-key-cipher',
        kdfIterations: ITERATIONS,
      });
      expect(hasOfflineUnlockRecord(NORMALIZED_EMAIL)).toBe(true);
    });

    it('does not save when the profile key is missing', () => {
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey: '   ',
        kdfIterations: ITERATIONS,
      });
      expect(localStorage.getItem(OFFLINE_UNLOCK_KEY)).toBeNull();
      expect(hasOfflineUnlockRecord()).toBe(false);
    });

    it('does not save when iterations are invalid', () => {
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey: 'profile-key-cipher',
        kdfIterations: 0,
      });
      expect(localStorage.getItem(OFFLINE_UNLOCK_KEY)).toBeNull();
    });

    it('does not save when the email resolves to empty', () => {
      saveOfflineUnlockRecord({
        email: '',
        profile: makeProfile({ email: '' }),
        profileKey: 'profile-key-cipher',
        kdfIterations: ITERATIONS,
      });
      expect(localStorage.getItem(OFFLINE_UNLOCK_KEY)).toBeNull();
    });
  });

  describe('email scoping', () => {
    beforeEach(() => {
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey: 'profile-key-cipher',
        kdfIterations: ITERATIONS,
      });
    });

    it('hasOfflineUnlockRecord returns false for a different email', () => {
      expect(hasOfflineUnlockRecord('other@example.com')).toBe(false);
    });

    it('getOfflineUnlockKdfIterations returns null for a different email', () => {
      expect(getOfflineUnlockKdfIterations('other@example.com')).toBeNull();
    });

    it('loadOfflineProfileSnapshot returns null for a different email', () => {
      expect(loadOfflineProfileSnapshot('other@example.com')).toBeNull();
    });
  });

  describe('with no record present', () => {
    it('hasOfflineUnlockRecord is false', () => {
      expect(hasOfflineUnlockRecord()).toBe(false);
    });

    it('getOfflineUnlockKdfIterations is null', () => {
      expect(getOfflineUnlockKdfIterations()).toBeNull();
    });

    it('loadOfflineProfileSnapshot is null', () => {
      expect(loadOfflineProfileSnapshot()).toBeNull();
    });
  });

  describe('parseRecord robustness (via read helpers)', () => {
    it('rejects records with the wrong version', () => {
      localStorage.setItem(OFFLINE_UNLOCK_KEY, JSON.stringify({
        version: 2,
        email: NORMALIZED_EMAIL,
        profileKey: 'k',
        kdfIterations: ITERATIONS,
      }));
      expect(hasOfflineUnlockRecord()).toBe(false);
    });

    it('rejects malformed JSON', () => {
      localStorage.setItem(OFFLINE_UNLOCK_KEY, '{not valid json');
      expect(hasOfflineUnlockRecord()).toBe(false);
    });

    it('rejects records missing the profile key', () => {
      localStorage.setItem(OFFLINE_UNLOCK_KEY, JSON.stringify({
        version: 1,
        email: NORMALIZED_EMAIL,
        kdfIterations: ITERATIONS,
      }));
      expect(hasOfflineUnlockRecord()).toBe(false);
    });

    it('synthesizes a default profile when none is stored', () => {
      localStorage.setItem(OFFLINE_UNLOCK_KEY, JSON.stringify({
        version: 1,
        email: NORMALIZED_EMAIL,
        profileKey: 'profile-key-cipher',
        kdfIterations: ITERATIONS,
      }));
      const snapshot = loadOfflineProfileSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot?.email).toBe(NORMALIZED_EMAIL);
      expect(snapshot?.name).toBe(NORMALIZED_EMAIL);
      expect(snapshot?.role).toBe('user');
    });
  });

  describe('clearOfflineUnlockRecord', () => {
    it('removes a persisted record', () => {
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey: 'profile-key-cipher',
        kdfIterations: ITERATIONS,
      });
      expect(hasOfflineUnlockRecord()).toBe(true);
      clearOfflineUnlockRecord();
      expect(hasOfflineUnlockRecord()).toBe(false);
      expect(localStorage.getItem(OFFLINE_UNLOCK_KEY)).toBeNull();
    });
  });

  describe('kdfIterationsFromLogin', () => {
    it('uses the token KdfIterations when present', () => {
      const token = { KdfIterations: 12345 } as TokenSuccess;
      expect(kdfIterationsFromLogin(token, 600000)).toBe(12345);
    });

    it('falls back to the provided fallback when token has none', () => {
      const token = {} as TokenSuccess;
      expect(kdfIterationsFromLogin(token, 777)).toBe(777);
    });

    it('defaults to 600000 when both are missing/zero', () => {
      const token = { KdfIterations: 0 } as TokenSuccess;
      expect(kdfIterationsFromLogin(token, 0)).toBe(600000);
    });

    it('defaults to 600000 for a non-positive computed value', () => {
      const token = { KdfIterations: -5 } as TokenSuccess;
      expect(kdfIterationsFromLogin(token, 0)).toBe(600000);
    });
  });

  describe('unlockOfflineVaultWithMasterKey', () => {
    it('rejects when no record exists', async () => {
      const { masterKey } = await buildValidProfileKey(EMAIL, PASSWORD, ITERATIONS);
      await expect(
        unlockOfflineVaultWithMasterKey(makeSession(), makeProfile(), masterKey)
      ).rejects.toThrow('Offline unlock is not available on this device.');
    });

    it('rejects when the record email does not match', async () => {
      const { profileKey, masterKey } = await buildValidProfileKey(EMAIL, PASSWORD, ITERATIONS);
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey,
        kdfIterations: ITERATIONS,
      });
      const session = makeSession({ email: 'someone-else@example.com' });
      await expect(
        unlockOfflineVaultWithMasterKey(session, null, masterKey)
      ).rejects.toThrow('Offline unlock is not available on this device.');
    });

    it('decrypts the vault key and strips access/refresh tokens', async () => {
      const { profileKey, sym, masterKey } = await buildValidProfileKey(EMAIL, PASSWORD, ITERATIONS);
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey,
        kdfIterations: ITERATIONS,
      });
      const result = await unlockOfflineVaultWithMasterKey(makeSession(), makeProfile(), masterKey);
      expect(result.session.email).toBe(NORMALIZED_EMAIL);
      expect(result.session.accessToken).toBeUndefined();
      expect(result.session.refreshToken).toBeUndefined();
      expect(result.session.symEncKey).toBe(bytesToBase64(sym.slice(0, 32)));
      expect(result.session.symMacKey).toBe(bytesToBase64(sym.slice(32, 64)));
      expect(result.profile.key).toBe(profileKey);
      expect(result.profile.email).toBe(NORMALIZED_EMAIL);
      expect(result.profile.privateKey).toBeNull();
    });

    it('matches the record email via the session when profile is null', async () => {
      const { profileKey, masterKey } = await buildValidProfileKey(EMAIL, PASSWORD, ITERATIONS);
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey,
        kdfIterations: ITERATIONS,
      });
      const result = await unlockOfflineVaultWithMasterKey(makeSession(), null, masterKey);
      expect(result.session.email).toBe(NORMALIZED_EMAIL);
    });

    it('throws when the master key cannot decrypt the profile key', async () => {
      const { profileKey } = await buildValidProfileKey(EMAIL, PASSWORD, ITERATIONS);
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey,
        kdfIterations: ITERATIONS,
      });
      const wrongKey = new Uint8Array(32).fill(9);
      await expect(
        unlockOfflineVaultWithMasterKey(makeSession(), makeProfile(), wrongKey)
      ).rejects.toThrow();
    });
  });

  describe('unlockOfflineVault', () => {
    it('derives the master key from the password and unlocks', async () => {
      const { profileKey, sym } = await buildValidProfileKey(EMAIL, PASSWORD, ITERATIONS);
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey,
        kdfIterations: ITERATIONS,
      });
      const result = await unlockOfflineVault(makeSession(), makeProfile(), PASSWORD);
      expect(result.session.symEncKey).toBe(bytesToBase64(sym.slice(0, 32)));
      expect(result.session.symMacKey).toBe(bytesToBase64(sym.slice(32, 64)));
      expect(result.profile.key).toBe(profileKey);
    });

    it('rejects when no record exists', async () => {
      await expect(
        unlockOfflineVault(makeSession(), makeProfile(), PASSWORD)
      ).rejects.toThrow('Offline unlock is not available on this device.');
    });

    it('rejects with the wrong password (MAC mismatch on decrypt)', async () => {
      const { profileKey } = await buildValidProfileKey(EMAIL, PASSWORD, ITERATIONS);
      saveOfflineUnlockRecord({
        email: EMAIL,
        profile: makeProfile(),
        profileKey,
        kdfIterations: ITERATIONS,
      });
      await expect(
        unlockOfflineVault(makeSession(), makeProfile(), 'wrong-password')
      ).rejects.toThrow();
    });
  });
});
