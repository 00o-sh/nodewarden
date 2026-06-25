import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';

// Mock the api/auth module so we control every network-facing call.
vi.mock('@/lib/api/auth', () => ({
  changeMasterPassword: vi.fn(),
  deleteAllAuthorizedDevices: vi.fn(),
  deleteAuthorizedDevice: vi.fn(),
  deriveLoginHash: vi.fn(),
  deleteAccountPasskey: vi.fn(),
  enableAccountPasskeyDirectUnlock: vi.fn(),
  getCurrentDeviceIdentifier: vi.fn(),
  getApiKey: vi.fn(),
  getAccountPasskeyAttestationOptions: vi.fn(),
  getAccountPasskeyUpdateAssertionOptions: vi.fn(),
  getTotpRecoveryCode: vi.fn(),
  listAccountPasskeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeAuthorizedDeviceTrust: vi.fn(),
  revokeAllAuthorizedDeviceTrust: vi.fn(),
  saveAccountPasskey: vi.fn(),
  setTotp: vi.fn(),
  trustAuthorizedDevicePermanently: vi.fn(),
  updateAuthorizedDeviceName: vi.fn(),
  updateProfile: vi.fn(),
}));

// Mock the account-passkeys helpers (these wrap real WebAuthn, unavailable in jsdom).
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
  return {
    email: 'user@example.com',
    key: 'profile-key',
    ...overrides,
  } as any;
}

function makeSession(overrides: Partial<any> = {}) {
  return {
    symEncKey: 'enc-key',
    symMacKey: 'mac-key',
    ...overrides,
  } as any;
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
    refetchTotpStatus: vi.fn().mockResolvedValue(undefined),
    refetchAuthorizedDevices: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function render(overrides: Partial<Deps> = {}) {
  const options = makeOptions(overrides);
  const { result } = renderHook(() => useAccountSecurityActions(options));
  return { actions: result.current, options };
}

// Runs the confirm dialog by invoking the onConfirm callback the hook passed to
// onSetConfirm, then awaits the async work scheduled inside it.
async function fireConfirm(onSetConfirm: ReturnType<typeof vi.fn>) {
  const state = onSetConfirm.mock.calls.at(-1)?.[0];
  expect(state).toBeTruthy();
  state.onConfirm();
  // Allow the inner void async IIFE to settle.
  await new Promise((r) => setTimeout(r, 0));
  return state;
}

beforeEach(() => {
  mockAuth.deriveLoginHash.mockResolvedValue(DERIVED);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAccountSecurityActions', () => {
  describe('changePassword', () => {
    it('does nothing when profile is null', async () => {
      const { actions, options } = render({ profile: null });
      await actions.changePassword('a', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb');
      expect(options.onSetConfirm).not.toHaveBeenCalled();
      expect(options.onNotify).not.toHaveBeenCalled();
    });

    it('errors when required fields missing', async () => {
      const { actions, options } = render();
      await actions.changePassword('', 'newpassword12', 'newpassword12');
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_current_new_password_is_required'));
      expect(options.onSetConfirm).not.toHaveBeenCalled();
    });

    it('errors when new password too short', async () => {
      const { actions, options } = render();
      await actions.changePassword('cur', 'short', 'short');
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_new_password_must_be_at_least_12_chars'));
    });

    it('errors when passwords do not match', async () => {
      const { actions, options } = render();
      await actions.changePassword('cur', 'newpassword12', 'different1234');
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_new_passwords_do_not_match'));
    });

    it('opens confirm and on success changes password and logs out', async () => {
      mockAuth.changeMasterPassword.mockResolvedValue(undefined);
      const { actions, options } = render();
      await actions.changePassword('cur', 'newpassword12', 'newpassword12');
      expect(options.onSetConfirm).toHaveBeenCalledTimes(1);
      await fireConfirm(options.onSetConfirm as any);
      expect(mockAuth.changeMasterPassword).toHaveBeenCalledWith(options.authedFetch, {
        email: 'user@example.com',
        currentPassword: 'cur',
        newPassword: 'newpassword12',
        currentIterations: 600000,
        profileKey: 'profile-key',
      });
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_master_password_changed_signing_out_everywhere'));
      expect(options.onLogoutNow).toHaveBeenCalled();
    });

    it('notifies error when changeMasterPassword rejects', async () => {
      mockAuth.changeMasterPassword.mockRejectedValue(new Error('boom'));
      const { actions, options } = render();
      await actions.changePassword('cur', 'newpassword12', 'newpassword12');
      await fireConfirm(options.onSetConfirm as any);
      expect(options.onNotify).toHaveBeenCalledWith('error', 'boom');
      expect(options.onLogoutNow).not.toHaveBeenCalled();
    });
  });

  describe('savePasswordHint', () => {
    it('errors when hint too long', async () => {
      const { actions, options } = render();
      await actions.savePasswordHint('x'.repeat(121));
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_password_hint_too_long'));
      expect(mockAuth.updateProfile).not.toHaveBeenCalled();
    });

    it('updates profile and notifies on success', async () => {
      const next = makeProfile({ masterPasswordHint: 'hi' });
      mockAuth.updateProfile.mockResolvedValue(next);
      const { actions, options } = render();
      await actions.savePasswordHint('  hi  ');
      expect(mockAuth.updateProfile).toHaveBeenCalledWith(options.authedFetch, { masterPasswordHint: 'hi' });
      expect(options.onProfileUpdated).toHaveBeenCalledWith(next);
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_profile_updated'));
    });

    it('notifies error when updateProfile rejects', async () => {
      mockAuth.updateProfile.mockRejectedValue(new Error('nope'));
      const { actions, options } = render();
      await actions.savePasswordHint('hint');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'nope');
    });
  });

  describe('enableTotp', () => {
    it('throws and notifies when profile null', async () => {
      const { actions, options } = render({ profile: null });
      await expect(actions.enableTotp('secret', '123', 'pw')).rejects.toThrow();
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_profile_unavailable'));
    });

    it('throws when secret/token missing', async () => {
      const { actions, options } = render();
      await expect(actions.enableTotp('  ', '  ', 'pw')).rejects.toThrow();
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_secret_and_code_are_required'));
    });

    it('throws when master password missing', async () => {
      const { actions, options } = render();
      await expect(actions.enableTotp('secret', '123', '')).rejects.toThrow();
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_master_password_is_required'));
    });

    it('derives hash, calls setTotp, notifies success', async () => {
      mockAuth.setTotp.mockResolvedValue(undefined);
      const { actions, options } = render();
      await actions.enableTotp(' secret ', ' 123 ', 'pw');
      expect(mockAuth.deriveLoginHash).toHaveBeenCalledWith('user@example.com', 'pw', 600000);
      expect(mockAuth.setTotp).toHaveBeenCalledWith(options.authedFetch, {
        enabled: true,
        secret: 'secret',
        token: '123',
        masterPasswordHash: 'derived-hash',
      });
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_totp_enabled'));
    });

    it('rethrows and notifies when setTotp rejects', async () => {
      mockAuth.setTotp.mockRejectedValue(new Error('totp-fail'));
      const { actions, options } = render();
      await expect(actions.enableTotp('secret', '123', 'pw')).rejects.toThrow('totp-fail');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'totp-fail');
    });
  });

  describe('disableTotp', () => {
    it('does nothing when profile null', async () => {
      const { actions } = render({ profile: null });
      await actions.disableTotp();
      expect(mockAuth.setTotp).not.toHaveBeenCalled();
    });

    it('errors when no disableTotpPassword', async () => {
      const { actions, options } = render({ disableTotpPassword: '' });
      await actions.disableTotp();
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_please_input_master_password'));
    });

    it('disables totp, clears dialog, refetches, notifies success', async () => {
      mockAuth.setTotp.mockResolvedValue(undefined);
      const { actions, options } = render();
      await actions.disableTotp();
      expect(mockAuth.setTotp).toHaveBeenCalledWith(options.authedFetch, {
        enabled: false,
        masterPasswordHash: 'derived-hash',
      });
      expect(options.clearDisableTotpDialog).toHaveBeenCalled();
      expect(options.refetchTotpStatus).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_totp_disabled'));
    });

    it('notifies error when setTotp rejects', async () => {
      mockAuth.setTotp.mockRejectedValue(new Error('disable-fail'));
      const { actions, options } = render();
      await actions.disableTotp();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'disable-fail');
    });
  });

  describe('getRecoveryCode', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.getRecoveryCode('pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.getRecoveryCode('')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('throws when code empty', async () => {
      mockAuth.getTotpRecoveryCode.mockResolvedValue('');
      const { actions } = render();
      await expect(actions.getRecoveryCode('pw')).rejects.toThrow(t('txt_recovery_code_is_empty'));
    });

    it('returns recovery code on success', async () => {
      mockAuth.getTotpRecoveryCode.mockResolvedValue('RECOVERY');
      const { actions, options } = render();
      await expect(actions.getRecoveryCode('pw')).resolves.toBe('RECOVERY');
      expect(mockAuth.getTotpRecoveryCode).toHaveBeenCalledWith(options.authedFetch, 'derived-hash');
    });
  });

  describe('getApiKey', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.getApiKey('pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.getApiKey('')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('throws when key empty', async () => {
      mockAuth.getApiKey.mockResolvedValue('');
      const { actions } = render();
      await expect(actions.getApiKey('pw')).rejects.toThrow(t('txt_api_key_is_empty'));
    });

    it('returns api key on success', async () => {
      mockAuth.getApiKey.mockResolvedValue('API-KEY');
      const { actions, options } = render();
      await expect(actions.getApiKey('pw')).resolves.toBe('API-KEY');
      expect(mockAuth.getApiKey).toHaveBeenCalledWith(options.authedFetch, 'derived-hash');
    });
  });

  describe('rotateApiKey', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.rotateApiKey('pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.rotateApiKey('')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('throws when rotated key empty', async () => {
      mockAuth.rotateApiKey.mockResolvedValue('');
      const { actions } = render();
      await expect(actions.rotateApiKey('pw')).rejects.toThrow(t('txt_api_key_is_empty'));
    });

    it('returns rotated key on success', async () => {
      mockAuth.rotateApiKey.mockResolvedValue('NEW-KEY');
      const { actions, options } = render();
      await expect(actions.rotateApiKey('pw')).resolves.toBe('NEW-KEY');
      expect(mockAuth.rotateApiKey).toHaveBeenCalledWith(options.authedFetch, 'derived-hash');
    });
  });

  describe('listAccountPasskeys', () => {
    it('delegates to api', async () => {
      const list = [{ id: 'pk1' }] as any;
      mockAuth.listAccountPasskeys.mockResolvedValue(list);
      const { actions, options } = render();
      await expect(actions.listAccountPasskeys()).resolves.toBe(list);
      expect(mockAuth.listAccountPasskeys).toHaveBeenCalledWith(options.authedFetch);
    });
  });

  describe('createAccountPasskey', () => {
    const pending = {
      token: 'tok',
      request: { device: 'resp' },
      supportsPrf: true,
    } as any;

    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.createAccountPasskey('n', 'pw', false)).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.createAccountPasskey('n', '', false)).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('creates a login-only passkey when directUnlock false', async () => {
      mockAuth.getAccountPasskeyAttestationOptions.mockResolvedValue({ options: {}, token: 'tok' });
      mockPasskeys.createAccountPasskeyCredential.mockResolvedValue(pending);
      const credential = { id: 'pk' } as any;
      mockAuth.saveAccountPasskey.mockResolvedValue(credential);
      const { actions, options } = render();
      await expect(actions.createAccountPasskey('My Key', 'pw', false)).resolves.toBe(credential);
      expect(mockAuth.saveAccountPasskey).toHaveBeenCalledWith(options.authedFetch, {
        name: 'My Key',
        token: 'tok',
        deviceResponse: { device: 'resp' },
        supportsPrf: true,
        keySet: null,
      });
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_account_passkey_saved'));
    });

    it('uses default name when blank', async () => {
      mockAuth.getAccountPasskeyAttestationOptions.mockResolvedValue({ options: {}, token: 'tok' });
      mockPasskeys.createAccountPasskeyCredential.mockResolvedValue(pending);
      mockAuth.saveAccountPasskey.mockResolvedValue({ id: 'pk' });
      const { actions } = render();
      await actions.createAccountPasskey('   ', 'pw', false);
      expect(mockAuth.saveAccountPasskey).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: t('txt_account_passkey') })
      );
    });

    it('throws when directUnlock true but vault key unavailable', async () => {
      mockAuth.getAccountPasskeyAttestationOptions.mockResolvedValue({ options: {}, token: 'tok' });
      mockPasskeys.createAccountPasskeyCredential.mockResolvedValue(pending);
      const { actions } = render({ session: makeSession({ symEncKey: '', symMacKey: '' }) });
      await expect(actions.createAccountPasskey('n', 'pw', true)).rejects.toThrow(t('txt_vault_key_unavailable'));
    });

    it('builds a PRF key set and saves with direct unlock', async () => {
      mockAuth.getAccountPasskeyAttestationOptions.mockResolvedValue({ options: {}, token: 'tok' });
      mockPasskeys.createAccountPasskeyCredential.mockResolvedValue(pending);
      const keySet = { encryptedUserKey: 'u' } as any;
      mockPasskeys.buildAccountPasskeyPrfKeySet.mockResolvedValue(keySet);
      mockAuth.saveAccountPasskey.mockResolvedValue({ id: 'pk' });
      const { actions, options } = render();
      await actions.createAccountPasskey('n', 'pw', true);
      expect(mockPasskeys.buildAccountPasskeyPrfKeySet).toHaveBeenCalledWith(pending, {
        symEncKey: 'enc-key',
        symMacKey: 'mac-key',
      });
      expect(mockAuth.saveAccountPasskey).toHaveBeenCalledWith(
        options.authedFetch,
        expect.objectContaining({ supportsPrf: true, keySet })
      );
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_account_passkey_saved'));
    });

    it('PRF unavailable + user declines => returns null and warns', async () => {
      mockAuth.getAccountPasskeyAttestationOptions.mockResolvedValue({ options: {}, token: 'tok' });
      mockPasskeys.createAccountPasskeyCredential.mockResolvedValue(pending);
      mockPasskeys.buildAccountPasskeyPrfKeySet.mockRejectedValue(new mockPasskeys.AccountPasskeyPrfUnavailableError());
      const onSetConfirm = vi.fn((state: any) => {
        // user cancels (ignore the follow-up onSetConfirm(null) reset)
        if (state) state.onCancel();
      });
      const { actions, options } = render({ onSetConfirm });
      await expect(actions.createAccountPasskey('n', 'pw', true)).resolves.toBeNull();
      expect(options.onNotify).toHaveBeenCalledWith('warning', t('txt_account_passkey_not_saved'));
      expect(mockAuth.saveAccountPasskey).not.toHaveBeenCalled();
    });

    it('PRF unavailable + user accepts => saves login-only', async () => {
      mockAuth.getAccountPasskeyAttestationOptions.mockResolvedValue({ options: {}, token: 'tok' });
      mockPasskeys.createAccountPasskeyCredential.mockResolvedValue(pending);
      mockPasskeys.buildAccountPasskeyPrfKeySet.mockRejectedValue(new mockPasskeys.AccountPasskeyPrfUnavailableError());
      mockAuth.saveAccountPasskey.mockResolvedValue({ id: 'pk' });
      const onSetConfirm = vi.fn((state: any) => {
        if (state) state.onConfirm();
      });
      const { actions, options } = render({ onSetConfirm });
      await actions.createAccountPasskey('n', 'pw', true);
      expect(mockAuth.saveAccountPasskey).toHaveBeenCalledWith(
        options.authedFetch,
        expect.objectContaining({ supportsPrf: false, keySet: null })
      );
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_account_passkey_saved_login_only'));
    });

    it('rethrows non-PRF errors from buildAccountPasskeyPrfKeySet', async () => {
      mockAuth.getAccountPasskeyAttestationOptions.mockResolvedValue({ options: {}, token: 'tok' });
      mockPasskeys.createAccountPasskeyCredential.mockResolvedValue(pending);
      mockPasskeys.buildAccountPasskeyPrfKeySet.mockRejectedValue(new Error('other'));
      const { actions } = render();
      await expect(actions.createAccountPasskey('n', 'pw', true)).rejects.toThrow('other');
    });
  });

  describe('enableAccountPasskeyDirectUnlock', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.enableAccountPasskeyDirectUnlock('id', 'pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when vault key unavailable', async () => {
      const { actions } = render({ session: makeSession({ symEncKey: '' }) });
      await expect(actions.enableAccountPasskeyDirectUnlock('id', 'pw')).rejects.toThrow(t('txt_vault_key_unavailable'));
    });

    it('throws when id blank', async () => {
      const { actions } = render();
      await expect(actions.enableAccountPasskeyDirectUnlock('  ', 'pw')).rejects.toThrow(t('txt_account_passkey_not_found'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.enableAccountPasskeyDirectUnlock('id', '')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('throws when assertion has no prfKey', async () => {
      mockAuth.getAccountPasskeyUpdateAssertionOptions.mockResolvedValue({ options: {}, token: 'tok' });
      mockPasskeys.assertAccountPasskey.mockResolvedValue({ token: 'tok', deviceResponse: {}, prfKey: undefined });
      const { actions } = render();
      await expect(actions.enableAccountPasskeyDirectUnlock('id', 'pw')).rejects.toThrow(
        t('txt_account_passkey_prf_not_available')
      );
    });

    it('enables direct unlock on success', async () => {
      mockAuth.getAccountPasskeyUpdateAssertionOptions.mockResolvedValue({ options: {}, token: 'tok' });
      const prfKey = new Uint8Array(64);
      mockPasskeys.assertAccountPasskey.mockResolvedValue({
        token: 'asrt-tok',
        deviceResponse: { d: 1 },
        prfKey,
      });
      const keySet = { encryptedUserKey: 'u' } as any;
      mockPasskeys.buildAccountPasskeyPrfKeySetFromPrfKey.mockResolvedValue(keySet);
      mockAuth.enableAccountPasskeyDirectUnlock.mockResolvedValue(undefined);
      const { actions, options } = render();
      await actions.enableAccountPasskeyDirectUnlock('id', 'pw');
      expect(mockAuth.getAccountPasskeyUpdateAssertionOptions).toHaveBeenCalledWith(
        options.authedFetch,
        'derived-hash',
        'id'
      );
      expect(mockPasskeys.buildAccountPasskeyPrfKeySetFromPrfKey).toHaveBeenCalledWith(prfKey, {
        symEncKey: 'enc-key',
        symMacKey: 'mac-key',
      });
      expect(mockAuth.enableAccountPasskeyDirectUnlock).toHaveBeenCalledWith(options.authedFetch, {
        token: 'asrt-tok',
        deviceResponse: { d: 1 },
        keySet,
      });
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_account_passkey_direct_unlock_enabled'));
    });
  });

  describe('deleteAccountPasskey', () => {
    it('throws when profile null', async () => {
      const { actions } = render({ profile: null });
      await expect(actions.deleteAccountPasskey('id', 'pw')).rejects.toThrow(t('txt_profile_unavailable'));
    });

    it('throws when password empty', async () => {
      const { actions } = render();
      await expect(actions.deleteAccountPasskey('id', '')).rejects.toThrow(t('txt_master_password_is_required'));
    });

    it('deletes passkey and notifies success', async () => {
      mockAuth.deleteAccountPasskey.mockResolvedValue(undefined);
      const { actions, options } = render();
      await actions.deleteAccountPasskey('id', 'pw');
      expect(mockAuth.deleteAccountPasskey).toHaveBeenCalledWith(options.authedFetch, 'id', 'derived-hash');
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_account_passkey_deleted'));
    });
  });

  describe('refreshAuthorizedDevices', () => {
    it('delegates to refetch', async () => {
      const { actions, options } = render();
      await actions.refreshAuthorizedDevices();
      expect(options.refetchAuthorizedDevices).toHaveBeenCalled();
    });
  });

  describe('renameAuthorizedDevice', () => {
    const device = { identifier: 'dev-1', name: 'Phone' } as any;

    it('errors when name blank', async () => {
      const { actions, options } = render();
      await actions.renameAuthorizedDevice(device, '   ');
      expect(options.onNotify).toHaveBeenCalledWith('error', t('txt_device_note_required'));
      expect(mockAuth.updateAuthorizedDeviceName).not.toHaveBeenCalled();
    });

    it('renames device and refetches on success', async () => {
      mockAuth.updateAuthorizedDeviceName.mockResolvedValue(undefined);
      const { actions, options } = render();
      await actions.renameAuthorizedDevice(device, '  New Name  ');
      expect(mockAuth.updateAuthorizedDeviceName).toHaveBeenCalledWith(options.authedFetch, 'dev-1', 'New Name');
      expect(options.refetchAuthorizedDevices).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_device_note_updated'));
    });

    it('notifies error when update rejects', async () => {
      mockAuth.updateAuthorizedDeviceName.mockRejectedValue(new Error('rename-fail'));
      const { actions, options } = render();
      await actions.renameAuthorizedDevice(device, 'New');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'rename-fail');
    });
  });

  describe('openRevokeDeviceTrust', () => {
    const device = { identifier: 'dev-1', name: 'Phone' } as any;

    it('revokes trust and refetches on confirm', async () => {
      mockAuth.revokeAuthorizedDeviceTrust.mockResolvedValue(undefined);
      const { actions, options } = render();
      actions.openRevokeDeviceTrust(device);
      await fireConfirm(options.onSetConfirm as any);
      expect(mockAuth.revokeAuthorizedDeviceTrust).toHaveBeenCalledWith(options.authedFetch, 'dev-1');
      expect(options.refetchAuthorizedDevices).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_device_authorization_revoked'));
    });

    it('notifies error on reject', async () => {
      mockAuth.revokeAuthorizedDeviceTrust.mockRejectedValue(new Error('revoke-fail'));
      const { actions, options } = render();
      actions.openRevokeDeviceTrust(device);
      await fireConfirm(options.onSetConfirm as any);
      expect(options.onNotify).toHaveBeenCalledWith('error', 'revoke-fail');
    });
  });

  describe('openTrustDevicePermanently', () => {
    const device = { identifier: 'dev-1', name: 'Phone' } as any;

    it('trusts device and refetches on confirm', async () => {
      mockAuth.trustAuthorizedDevicePermanently.mockResolvedValue(undefined);
      const { actions, options } = render();
      actions.openTrustDevicePermanently(device);
      await fireConfirm(options.onSetConfirm as any);
      expect(mockAuth.trustAuthorizedDevicePermanently).toHaveBeenCalledWith(options.authedFetch, 'dev-1');
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_device_trusted_permanently'));
    });

    it('notifies error on reject', async () => {
      mockAuth.trustAuthorizedDevicePermanently.mockRejectedValue(new Error('trust-fail'));
      const { actions, options } = render();
      actions.openTrustDevicePermanently(device);
      await fireConfirm(options.onSetConfirm as any);
      expect(options.onNotify).toHaveBeenCalledWith('error', 'trust-fail');
    });
  });

  describe('openRemoveDevice', () => {
    const device = { identifier: 'dev-1', name: 'Phone' } as any;

    it('removes a non-current device, refetches, notifies', async () => {
      mockAuth.deleteAuthorizedDevice.mockResolvedValue(undefined);
      mockAuth.getCurrentDeviceIdentifier.mockReturnValue('other-dev');
      const { actions, options } = render();
      actions.openRemoveDevice(device);
      await fireConfirm(options.onSetConfirm as any);
      expect(mockAuth.deleteAuthorizedDevice).toHaveBeenCalledWith(options.authedFetch, 'dev-1');
      expect(options.refetchAuthorizedDevices).toHaveBeenCalled();
      expect(options.onLogoutNow).not.toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_device_removed'));
    });

    it('logs out when removing the current device', async () => {
      mockAuth.deleteAuthorizedDevice.mockResolvedValue(undefined);
      mockAuth.getCurrentDeviceIdentifier.mockReturnValue('dev-1');
      const { actions, options } = render();
      actions.openRemoveDevice(device);
      await fireConfirm(options.onSetConfirm as any);
      expect(options.onLogoutNow).toHaveBeenCalled();
      expect(options.refetchAuthorizedDevices).not.toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_device_removed'));
    });

    it('notifies error on reject', async () => {
      mockAuth.deleteAuthorizedDevice.mockRejectedValue(new Error('remove-fail'));
      const { actions, options } = render();
      actions.openRemoveDevice(device);
      await fireConfirm(options.onSetConfirm as any);
      expect(options.onNotify).toHaveBeenCalledWith('error', 'remove-fail');
    });
  });

  describe('openRevokeAllDeviceTrust', () => {
    it('revokes all trust on confirm', async () => {
      mockAuth.revokeAllAuthorizedDeviceTrust.mockResolvedValue(undefined);
      const { actions, options } = render();
      actions.openRevokeAllDeviceTrust();
      await fireConfirm(options.onSetConfirm as any);
      expect(mockAuth.revokeAllAuthorizedDeviceTrust).toHaveBeenCalledWith(options.authedFetch);
      expect(options.refetchAuthorizedDevices).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_all_device_authorizations_revoked'));
    });

    it('notifies error on reject', async () => {
      mockAuth.revokeAllAuthorizedDeviceTrust.mockRejectedValue(new Error('revoke-all-fail'));
      const { actions, options } = render();
      actions.openRevokeAllDeviceTrust();
      await fireConfirm(options.onSetConfirm as any);
      expect(options.onNotify).toHaveBeenCalledWith('error', 'revoke-all-fail');
    });
  });

  describe('openRemoveAllDevices', () => {
    it('removes all devices then logs out on confirm', async () => {
      mockAuth.deleteAllAuthorizedDevices.mockResolvedValue(undefined);
      const { actions, options } = render();
      actions.openRemoveAllDevices();
      await fireConfirm(options.onSetConfirm as any);
      expect(mockAuth.deleteAllAuthorizedDevices).toHaveBeenCalledWith(options.authedFetch);
      expect(options.onNotify).toHaveBeenCalledWith('success', t('txt_all_devices_removed'));
      expect(options.onLogoutNow).toHaveBeenCalled();
    });

    it('notifies error on reject', async () => {
      mockAuth.deleteAllAuthorizedDevices.mockRejectedValue(new Error('remove-all-fail'));
      const { actions, options } = render();
      actions.openRemoveAllDevices();
      await fireConfirm(options.onSetConfirm as any);
      expect(options.onNotify).toHaveBeenCalledWith('error', 'remove-all-fail');
      expect(options.onLogoutNow).not.toHaveBeenCalled();
    });
  });
});
