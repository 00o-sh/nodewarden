import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';

// Mirrors useAccountSecurityActions.test.ts but targets the YubiKey OTP and
// two-factor (WebAuthn) passkey action handlers that the sibling test skipped
// (source lines 208-311): getYubiKeySettings, saveYubiKeySettings,
// saveYubiKeyApiCredentials, bootstrapYubiKeyApiCredentials, disableYubiKey,
// getTwoFactorPasskeySettings, createTwoFactorPasskey, deleteTwoFactorPasskey,
// and disableTwoFactorPasskeys.
vi.mock('@/lib/api/auth', () => ({
  bootstrapYubiKeyOtpApiCredentials: vi.fn(),
  changeMasterPassword: vi.fn(),
  deleteAllAuthorizedDevices: vi.fn(),
  deleteAuthorizedDevice: vi.fn(),
  deleteAuthorizedDevices: vi.fn(),
  deriveLoginHash: vi.fn(),
  deleteAccountPasskey: vi.fn(),
  deleteTwoFactorPasskey: vi.fn(),
  enableAccountPasskeyDirectUnlock: vi.fn(),
  disableTwoFactorPasskeys: vi.fn(),
  disableYubiKeyOtp: vi.fn(),
  getCurrentDeviceIdentifier: vi.fn(),
  getApiKey: vi.fn(),
  getAccountPasskeyAttestationOptions: vi.fn(),
  getAccountPasskeyUpdateAssertionOptions: vi.fn(),
  getTotpRecoveryCode: vi.fn(),
  getTwoFactorPasskeyChallenge: vi.fn(),
  getTwoFactorPasskeySettings: vi.fn(),
  getYubiKeyOtpSettings: vi.fn(),
  listAccountPasskeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeAuthorizedDeviceTrust: vi.fn(),
  revokeAllAuthorizedDeviceTrust: vi.fn(),
  saveAccountPasskey: vi.fn(),
  saveTwoFactorPasskey: vi.fn(),
  saveYubiKeyOtpApiCredentials: vi.fn(),
  saveYubiKeyOtpSettings: vi.fn(),
  setTotp: vi.fn(),
  trustAuthorizedDevicePermanently: vi.fn(),
  updateAuthorizedDeviceName: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('@/lib/account-passkeys', () => {
  class AccountPasskeyPrfUnavailableError extends Error {
    constructor() {
      super('prf-unavailable');
      this.name = 'AccountPasskeyPrfUnavailableError';
    }
  }
  return {
    AccountPasskeyPrfUnavailableError,
    assertAccountPasskey: vi.fn(),
    buildAccountPasskeyPrfKeySet: vi.fn(),
    buildAccountPasskeyPrfKeySetFromPrfKey: vi.fn(),
    createAccountPasskeyCredential: vi.fn(),
    createTwoFactorPasskeyCredential: vi.fn(),
  };
});

import * as auth from '@/lib/api/auth';
import * as passkeys from '@/lib/account-passkeys';
import { t } from '@/lib/i18n';
import useAccountSecurityActions from '@/hooks/useAccountSecurityActions';

const mockAuth = auth as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockPasskeys = passkeys as unknown as Record<string, any>;

type Deps = Parameters<typeof useAccountSecurityActions>[0];

const DERIVED = { hash: 'derived-hash' } as any;

function makeProfile(overrides: Partial<any> = {}) {
  return { email: 'user@example.com', key: 'profile-key', ...overrides } as any;
}

function makeSession(overrides: Partial<any> = {}) {
  return { symEncKey: 'enc-key', symMacKey: 'mac-key', ...overrides } as any;
}

function makeOptions(overrides: Partial<Deps> = {}): Deps {
  return {
    authedFetch: vi.fn() as any,
    profile: makeProfile(),
    session: makeSession(),
    defaultKdfIterations: 600000,
    disableTotpPassword: 'master-pass',
    clearDisableTotpDialog: vi.fn(),
    onLogoutNow: vi.fn(),
    onNotify: vi.fn(),
    onProfileUpdated: vi.fn(),
    onSetConfirm: vi.fn(),
    refetchTwoFactorStatus: vi.fn().mockResolvedValue(undefined),
    refetchAuthorizedDevices: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function render(overrides: Partial<Deps> = {}) {
  const options = makeOptions(overrides);
  const { result } = renderHook(() => useAccountSecurityActions(options));
  return { actions: result.current, options };
}

beforeEach(() => {
  mockAuth.deriveLoginHash.mockResolvedValue(DERIVED);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAccountSecurityActions - yubikey + two-factor passkey', () => {
  describe('getYubiKeySettings', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.getYubiKeySettings('pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.getYubiKeySettings('')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('derives the hash and returns the settings', async () => {
      const settings = { keys: ['k1'], nfc: true } as any;
      mockAuth.getYubiKeyOtpSettings.mockResolvedValue(settings);
      const { actions, options } = render();
      await expect(actions.getYubiKeySettings('pw')).resolves.toBe(settings);
      expect(mockAuth.deriveLoginHash).toHaveBeenCalledWith('user@example.com', 'pw', 600000);
      expect(mockAuth.getYubiKeyOtpSettings).toHaveBeenCalledWith(options.authedFetch, 'derived-hash');
    });
  });

  describe('saveYubiKeySettings', () => {
    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.saveYubiKeySettings(['k'], false, '')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('saves keys, refetches status, notifies and returns settings', async () => {
      const settings = { keys: ['k1', 'k2'], nfc: true } as any;
      mockAuth.saveYubiKeyOtpSettings.mockResolvedValue(settings);
      const { actions, options } = render();
      await expect(actions.saveYubiKeySettings(['k1', 'k2'], true, 'pw')).resolves.toBe(settings);
      expect(mockAuth.saveYubiKeyOtpSettings).toHaveBeenCalledWith(options.authedFetch, {
        keys: ['k1', 'k2'],
        nfc: true,
        masterPasswordHash: 'derived-hash',
      });
      expect(options.refetchTwoFactorStatus).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_yubikeys_updated'));
    });
  });

  describe('saveYubiKeyApiCredentials', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.saveYubiKeyApiCredentials('cid', 'sk', 'pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('saves credentials, refetches, notifies and returns settings', async () => {
      const settings = { configured: true } as any;
      mockAuth.saveYubiKeyOtpApiCredentials.mockResolvedValue(settings);
      const { actions, options } = render();
      await expect(actions.saveYubiKeyApiCredentials('client-1', 'secret-1', 'pw')).resolves.toBe(settings);
      expect(mockAuth.saveYubiKeyOtpApiCredentials).toHaveBeenCalledWith(options.authedFetch, {
        masterPasswordHash: 'derived-hash',
        yubicoClientId: 'client-1',
        yubicoSecretKey: 'secret-1',
      });
      expect(options.refetchTwoFactorStatus).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_yubikey_config_updated'));
    });
  });

  describe('bootstrapYubiKeyApiCredentials', () => {
    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.bootstrapYubiKeyApiCredentials('otp', '')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('bootstraps from an OTP, refetches, notifies and returns settings', async () => {
      const settings = { configured: true } as any;
      mockAuth.bootstrapYubiKeyOtpApiCredentials.mockResolvedValue(settings);
      const { actions, options } = render();
      await expect(actions.bootstrapYubiKeyApiCredentials('otp-token', 'pw')).resolves.toBe(settings);
      expect(mockAuth.bootstrapYubiKeyOtpApiCredentials).toHaveBeenCalledWith(options.authedFetch, {
        masterPasswordHash: 'derived-hash',
        otp: 'otp-token',
      });
      expect(options.refetchTwoFactorStatus).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_yubikey_config_updated'));
    });
  });

  describe('disableYubiKey', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.disableYubiKey('pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.disableYubiKey('')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('disables yubikey, refetches and notifies', async () => {
      mockAuth.disableYubiKeyOtp.mockResolvedValue(undefined);
      const { actions, options } = render();
      await actions.disableYubiKey('pw');
      expect(mockAuth.disableYubiKeyOtp).toHaveBeenCalledWith(options.authedFetch, 'derived-hash');
      expect(options.refetchTwoFactorStatus).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_yubikey_disabled'));
    });
  });

  describe('getTwoFactorPasskeySettings', () => {
    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.getTwoFactorPasskeySettings('')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('returns settings on success', async () => {
      const settings = { passkeys: [] } as any;
      mockAuth.getTwoFactorPasskeySettings.mockResolvedValue(settings);
      const { actions, options } = render();
      await expect(actions.getTwoFactorPasskeySettings('pw')).resolves.toBe(settings);
      expect(mockAuth.getTwoFactorPasskeySettings).toHaveBeenCalledWith(options.authedFetch, 'derived-hash');
    });
  });

  describe('createTwoFactorPasskey', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.createTwoFactorPasskey('n', 'pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.createTwoFactorPasskey('n', '')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('gets a challenge, builds a credential, saves it, refetches and notifies', async () => {
      const challenge = { challenge: 'c' } as any;
      const deviceResponse = { device: 'resp' } as any;
      const settings = { passkeys: [{ id: 1 }] } as any;
      mockAuth.getTwoFactorPasskeyChallenge.mockResolvedValue(challenge);
      mockPasskeys.createTwoFactorPasskeyCredential.mockResolvedValue(deviceResponse);
      mockAuth.saveTwoFactorPasskey.mockResolvedValue(settings);
      const { actions, options } = render();
      await expect(actions.createTwoFactorPasskey('My Passkey', 'pw')).resolves.toBe(settings);
      expect(mockAuth.getTwoFactorPasskeyChallenge).toHaveBeenCalledWith(options.authedFetch, 'derived-hash');
      expect(mockPasskeys.createTwoFactorPasskeyCredential).toHaveBeenCalledWith(challenge);
      expect(mockAuth.saveTwoFactorPasskey).toHaveBeenCalledWith(options.authedFetch, {
        name: 'My Passkey',
        masterPasswordHash: 'derived-hash',
        deviceResponse,
      });
      expect(options.refetchTwoFactorStatus).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_two_step_passkey_added'));
    });

    it('falls back to a default name when blank', async () => {
      mockAuth.getTwoFactorPasskeyChallenge.mockResolvedValue({} as any);
      mockPasskeys.createTwoFactorPasskeyCredential.mockResolvedValue({} as any);
      mockAuth.saveTwoFactorPasskey.mockResolvedValue({} as any);
      const { actions } = render();
      await actions.createTwoFactorPasskey('   ', 'pw');
      expect(mockAuth.saveTwoFactorPasskey).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: t('txt_passkey') })
      );
    });
  });

  describe('deleteTwoFactorPasskey', () => {
    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.deleteTwoFactorPasskey(1, '')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('deletes the passkey, refetches and notifies', async () => {
      const settings = { passkeys: [] } as any;
      mockAuth.deleteTwoFactorPasskey.mockResolvedValue(settings);
      const { actions, options } = render();
      await expect(actions.deleteTwoFactorPasskey(7, 'pw')).resolves.toBe(settings);
      expect(mockAuth.deleteTwoFactorPasskey).toHaveBeenCalledWith(options.authedFetch, {
        id: 7,
        masterPasswordHash: 'derived-hash',
      });
      expect(options.refetchTwoFactorStatus).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_two_step_passkey_removed'));
    });
  });

  // The sibling cases above each cover one guard per action; these fill in the
  // complementary guard (the profile-null OR empty-password branch the earlier
  // test for that action did not exercise), plus the passkey default-name path.
  describe('remaining guard branches', () => {
    it('saveYubiKeySettings throws when profile is null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.saveYubiKeySettings(['k'], false, 'pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('saveYubiKeyApiCredentials throws when the password is empty', async () => {
      const { actions } = render();
      await expect(actions.saveYubiKeyApiCredentials('cid', 'sk', '')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('bootstrapYubiKeyApiCredentials throws when profile is null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.bootstrapYubiKeyApiCredentials('otp', 'pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('getTwoFactorPasskeySettings throws when profile is null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.getTwoFactorPasskeySettings('pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('deleteTwoFactorPasskey throws when profile is null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.deleteTwoFactorPasskey(1, 'pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('disableTwoFactorPasskeys throws when the password is empty', async () => {
      const { actions } = render();
      await expect(actions.disableTwoFactorPasskeys('')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('createTwoFactorPasskey uses the default name for an empty name', async () => {
      mockAuth.getTwoFactorPasskeyChallenge.mockResolvedValue({} as any);
      mockPasskeys.createTwoFactorPasskeyCredential.mockResolvedValue({} as any);
      mockAuth.saveTwoFactorPasskey.mockResolvedValue({} as any);
      const { actions } = render();
      await actions.createTwoFactorPasskey('', 'pw');
      expect(mockAuth.saveTwoFactorPasskey).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: t('txt_passkey') })
      );
    });
  });

  describe('disableTwoFactorPasskeys', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.disableTwoFactorPasskeys('pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('disables all passkeys, refetches and notifies', async () => {
      mockAuth.disableTwoFactorPasskeys.mockResolvedValue(undefined);
      const { actions, options } = render();
      await actions.disableTwoFactorPasskeys('pw');
      expect(mockAuth.disableTwoFactorPasskeys).toHaveBeenCalledWith(options.authedFetch, 'derived-hash');
      expect(options.refetchTwoFactorStatus).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_two_step_passkeys_disabled'));
    });
  });
});
