import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/preact';
import type { AppConfirmState } from '@/components/AppGlobalOverlays';
import { t } from '@/lib/i18n';

vi.mock('@/lib/api/admin', () => ({
  createInvite: vi.fn(),
  deleteAllInvites: vi.fn(),
  deleteInvalidInvites: vi.fn(),
  deleteInvite: vi.fn(),
  deleteUser: vi.fn(),
  setUserStatus: vi.fn(),
}));

// v1.8.0 requires the master password for admin actions: the hook derives the
// login hash from the password typed into the confirm dialog before every call.
vi.mock('@/lib/api/auth', () => ({
  deriveLoginHash: vi.fn(),
}));

import useAdminActions from '@/hooks/useAdminActions';
import { createInvite, deleteAllInvites, deleteInvalidInvites, deleteInvite, deleteUser, setUserStatus } from '@/lib/api/admin';
import { deriveLoginHash } from '@/lib/api/auth';

const mockedCreateInvite = vi.mocked(createInvite);
const mockedDeleteAllInvites = vi.mocked(deleteAllInvites);
const mockedDeleteInvalidInvites = vi.mocked(deleteInvalidInvites);
const mockedDeleteInvite = vi.mocked(deleteInvite);
const mockedDeleteUser = vi.mocked(deleteUser);
const mockedSetUserStatus = vi.mocked(setUserStatus);
const mockedDeriveLoginHash = vi.mocked(deriveLoginHash);

const EMAIL = 'admin@example.com';
const KDF = 600000;

function setup() {
  const authedFetch = vi.fn();
  const onNotify = vi.fn();
  const onSetConfirm = vi.fn();
  const refetchUsers = vi.fn().mockResolvedValue(undefined);
  const refetchInvites = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useAdminActions({
      authedFetch,
      email: EMAIL,
      defaultKdfIterations: KDF,
      onNotify,
      onSetConfirm,
      refetchUsers,
      refetchInvites,
    })
  );
  return { actions: result.current, authedFetch, onNotify, onSetConfirm, refetchUsers, refetchInvites };
}

// Fire the confirm dialog's onConfirm with a typed master password and flush the
// inner void async IIFE (derive hash -> api call -> refetch -> notify).
async function confirmWith(
  onSetConfirm: ReturnType<typeof vi.fn>,
  masterPassword: string = 'master-pass'
): Promise<AppConfirmState> {
  const confirm = capturedConfirm(onSetConfirm);
  await act(async () => {
    confirm.onConfirm(masterPassword);
    await new Promise((r) => setTimeout(r, 0));
  });
  return confirm;
}

// Pull the AppConfirmState that was passed to onSetConfirm (the confirm payload).
function capturedConfirm(onSetConfirm: ReturnType<typeof vi.fn>): AppConfirmState {
  const payload = onSetConfirm.mock.calls[0][0];
  expect(payload).not.toBeNull();
  return payload as AppConfirmState;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateInvite.mockResolvedValue(undefined);
  mockedDeleteAllInvites.mockResolvedValue(undefined);
  mockedDeleteInvalidInvites.mockResolvedValue(undefined);
  mockedDeleteInvite.mockResolvedValue(undefined);
  mockedDeleteUser.mockResolvedValue(undefined);
  mockedSetUserStatus.mockResolvedValue(undefined);
  mockedDeriveLoginHash.mockResolvedValue({ hash: 'derived-hash' } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAdminActions', () => {
  describe('refreshAdmin', () => {
    it('refetches users and invites', async () => {
      const { actions, refetchUsers, refetchInvites, onNotify } = setup();
      await act(async () => {
        actions.refreshAdmin();
        await Promise.resolve();
      });
      expect(refetchUsers).toHaveBeenCalledTimes(1);
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).not.toHaveBeenCalled();
    });

    it('notifies error when a refetch rejects', async () => {
      const authedFetch = vi.fn();
      const onNotify = vi.fn();
      const onSetConfirm = vi.fn();
      const refetchUsers = vi.fn().mockRejectedValue(new Error('boom'));
      const refetchInvites = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useAdminActions({ authedFetch, onNotify, onSetConfirm, refetchUsers, refetchInvites })
      );
      await act(async () => {
        result.current.refreshAdmin();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onNotify).toHaveBeenCalledWith('error', 'boom');
    });
  });

  describe('createInvite (master-password-gated)', () => {
    it('opens a master-password confirm and does not call the api until confirmed', async () => {
      const { actions, onSetConfirm } = setup();
      await act(async () => {
        await actions.createInvite(48);
      });
      expect(onSetConfirm).toHaveBeenCalledTimes(1);
      const confirm = capturedConfirm(onSetConfirm);
      expect(confirm.requireMasterPassword).toBe(true);
      expect(typeof confirm.onConfirm).toBe('function');
      expect(mockedCreateInvite).not.toHaveBeenCalled();
    });

    it('derives the hash, creates the invite, refetches, and notifies success on confirm', async () => {
      const { actions, authedFetch, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.createInvite(48);
      });
      await confirmWith(onSetConfirm);
      expect(mockedDeriveLoginHash).toHaveBeenCalledWith(EMAIL, 'master-pass', KDF);
      expect(mockedCreateInvite).toHaveBeenCalledWith(authedFetch, 48, 'derived-hash');
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when the api rejects after confirm', async () => {
      mockedCreateInvite.mockRejectedValue(new Error('nope'));
      const { actions, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.createInvite(1);
      });
      await confirmWith(onSetConfirm);
      expect(refetchInvites).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'nope');
    });
  });

  describe('toggleUserStatus (master-password-gated)', () => {
    it('flips active -> banned on confirm, refetches, and notifies success', async () => {
      const { actions, authedFetch, onSetConfirm, refetchUsers, onNotify } = setup();
      await act(async () => {
        await actions.toggleUserStatus('u1', 'active');
      });
      expect(mockedSetUserStatus).not.toHaveBeenCalled();
      await confirmWith(onSetConfirm);
      expect(mockedDeriveLoginHash).toHaveBeenCalledWith(EMAIL, 'master-pass', KDF);
      expect(mockedSetUserStatus).toHaveBeenCalledWith(authedFetch, 'u1', 'banned', 'derived-hash');
      expect(refetchUsers).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('flips banned -> active on confirm', async () => {
      const { actions, authedFetch, onSetConfirm } = setup();
      await act(async () => {
        await actions.toggleUserStatus('u2', 'banned');
      });
      await confirmWith(onSetConfirm);
      expect(mockedSetUserStatus).toHaveBeenCalledWith(authedFetch, 'u2', 'active', 'derived-hash');
    });

    it('notifies error when the api rejects after confirm', async () => {
      mockedSetUserStatus.mockRejectedValue(new Error('status fail'));
      const { actions, onSetConfirm, refetchUsers, onNotify } = setup();
      await act(async () => {
        await actions.toggleUserStatus('u1', 'active');
      });
      await confirmWith(onSetConfirm);
      expect(refetchUsers).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'status fail');
    });
  });

  describe('deleteInvite (confirm-gated)', () => {
    it('opens a danger confirm and does not call the api until confirmed', async () => {
      const { actions, onSetConfirm } = setup();
      await act(async () => {
        await actions.deleteInvite('CODE1');
      });
      expect(onSetConfirm).toHaveBeenCalledTimes(1);
      const confirm = capturedConfirm(onSetConfirm);
      expect(confirm.danger).toBe(true);
      expect(typeof confirm.onConfirm).toBe('function');
      expect(mockedDeleteInvite).not.toHaveBeenCalled();
    });

    it('deletes, dismisses the confirm, refetches, and notifies success on confirm', async () => {
      const { actions, authedFetch, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvite('CODE1');
      });
      await confirmWith(onSetConfirm);
      expect(onSetConfirm).toHaveBeenLastCalledWith(null);
      expect(mockedDeriveLoginHash).toHaveBeenCalledWith(EMAIL, 'master-pass', KDF);
      expect(mockedDeleteInvite).toHaveBeenCalledWith(authedFetch, 'CODE1', 'derived-hash');
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when delete rejects after confirm', async () => {
      mockedDeleteInvite.mockRejectedValue(new Error('delete fail'));
      const { actions, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvite('CODE1');
      });
      await confirmWith(onSetConfirm);
      expect(refetchInvites).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'delete fail');
    });

    it('falls back to a generic message when a non-Error is thrown', async () => {
      mockedDeleteInvite.mockRejectedValue('boom');
      const { actions, onSetConfirm, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvite('CODE1');
      });
      await confirmWith(onSetConfirm);
      expect(onNotify).toHaveBeenCalledWith('error', t('txt_delete_invite_failed'));
    });
  });

  describe('deleteInvalidInvites (confirm-gated)', () => {
    it('deletes invalid invites, refetches, and notifies success on confirm', async () => {
      const { actions, authedFetch, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvalidInvites();
      });
      const confirm = capturedConfirm(onSetConfirm);
      expect(confirm.danger).toBe(true);
      expect(mockedDeleteInvalidInvites).not.toHaveBeenCalled();
      await confirmWith(onSetConfirm);
      expect(onSetConfirm).toHaveBeenLastCalledWith(null);
      expect(mockedDeleteInvalidInvites).toHaveBeenCalledWith(authedFetch, 'derived-hash');
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when the api rejects after confirm', async () => {
      mockedDeleteInvalidInvites.mockRejectedValue(new Error('del invalid fail'));
      const { actions, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvalidInvites();
      });
      await confirmWith(onSetConfirm);
      expect(refetchInvites).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'del invalid fail');
    });

    it('falls back to a generic message when a non-Error is thrown', async () => {
      mockedDeleteInvalidInvites.mockRejectedValue('boom');
      const { actions, onSetConfirm, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvalidInvites();
      });
      await confirmWith(onSetConfirm);
      expect(onNotify).toHaveBeenCalledWith('error', t('txt_delete_invalid_invites_failed'));
    });
  });

  describe('deleteAllInvites (confirm-gated)', () => {
    it('opens a danger confirm and does not call the api until confirmed', async () => {
      const { actions, onSetConfirm } = setup();
      await act(async () => {
        await actions.deleteAllInvites();
      });
      expect(onSetConfirm).toHaveBeenCalledTimes(1);
      const confirm = capturedConfirm(onSetConfirm);
      expect(confirm.danger).toBe(true);
      expect(typeof confirm.onConfirm).toBe('function');
      expect(mockedDeleteAllInvites).not.toHaveBeenCalled();
    });

    it('runs delete, dismisses the confirm, refetches, and notifies success on confirm', async () => {
      const { actions, authedFetch, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteAllInvites();
      });
      await confirmWith(onSetConfirm);
      expect(onSetConfirm).toHaveBeenLastCalledWith(null);
      expect(mockedDeleteAllInvites).toHaveBeenCalledWith(authedFetch, 'derived-hash');
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when delete rejects after confirm', async () => {
      mockedDeleteAllInvites.mockRejectedValue(new Error('del all fail'));
      const { actions, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteAllInvites();
      });
      await confirmWith(onSetConfirm);
      expect(refetchInvites).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'del all fail');
    });
  });

  describe('deleteUser (confirm-gated)', () => {
    it('opens a danger confirm and does not call the api until confirmed', async () => {
      const { actions, onSetConfirm } = setup();
      await act(async () => {
        await actions.deleteUser('u9');
      });
      expect(onSetConfirm).toHaveBeenCalledTimes(1);
      const confirm = capturedConfirm(onSetConfirm);
      expect(confirm.danger).toBe(true);
      expect(mockedDeleteUser).not.toHaveBeenCalled();
    });

    it('runs delete, dismisses the confirm, refetches, and notifies success on confirm', async () => {
      const { actions, authedFetch, onSetConfirm, refetchUsers, onNotify } = setup();
      await act(async () => {
        await actions.deleteUser('u9');
      });
      await confirmWith(onSetConfirm);
      expect(onSetConfirm).toHaveBeenLastCalledWith(null);
      expect(mockedDeleteUser).toHaveBeenCalledWith(authedFetch, 'u9', 'derived-hash');
      expect(refetchUsers).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when delete rejects after confirm', async () => {
      mockedDeleteUser.mockRejectedValue(new Error('del user fail'));
      const { actions, onSetConfirm, refetchUsers, onNotify } = setup();
      await act(async () => {
        await actions.deleteUser('u9');
      });
      await confirmWith(onSetConfirm);
      expect(refetchUsers).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'del user fail');
    });
  });
});
