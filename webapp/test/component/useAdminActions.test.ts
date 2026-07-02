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

import useAdminActions from '@/hooks/useAdminActions';
import { createInvite, deleteAllInvites, deleteInvalidInvites, deleteInvite, deleteUser, setUserStatus } from '@/lib/api/admin';

const mockedCreateInvite = vi.mocked(createInvite);
const mockedDeleteAllInvites = vi.mocked(deleteAllInvites);
const mockedDeleteInvalidInvites = vi.mocked(deleteInvalidInvites);
const mockedDeleteInvite = vi.mocked(deleteInvite);
const mockedDeleteUser = vi.mocked(deleteUser);
const mockedSetUserStatus = vi.mocked(setUserStatus);

function setup() {
  const authedFetch = vi.fn();
  const onNotify = vi.fn();
  const onSetConfirm = vi.fn();
  const refetchUsers = vi.fn().mockResolvedValue(undefined);
  const refetchInvites = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useAdminActions({ authedFetch, onNotify, onSetConfirm, refetchUsers, refetchInvites })
  );
  return { actions: result.current, authedFetch, onNotify, onSetConfirm, refetchUsers, refetchInvites };
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

  describe('createInvite', () => {
    it('creates the invite, refetches, and notifies success', async () => {
      const { actions, authedFetch, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.createInvite(48);
      });
      expect(mockedCreateInvite).toHaveBeenCalledWith(authedFetch, 48);
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when the api rejects', async () => {
      mockedCreateInvite.mockRejectedValue(new Error('nope'));
      const { actions, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.createInvite(1);
      });
      expect(refetchInvites).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'nope');
    });
  });

  describe('toggleUserStatus', () => {
    it('flips active -> banned, refetches, and notifies success', async () => {
      const { actions, authedFetch, refetchUsers, onNotify } = setup();
      await act(async () => {
        await actions.toggleUserStatus('u1', 'active');
      });
      expect(mockedSetUserStatus).toHaveBeenCalledWith(authedFetch, 'u1', 'banned');
      expect(refetchUsers).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('flips banned -> active', async () => {
      const { actions, authedFetch } = setup();
      await act(async () => {
        await actions.toggleUserStatus('u2', 'banned');
      });
      expect(mockedSetUserStatus).toHaveBeenCalledWith(authedFetch, 'u2', 'active');
    });

    it('notifies error when the api rejects', async () => {
      mockedSetUserStatus.mockRejectedValue(new Error('status fail'));
      const { actions, refetchUsers, onNotify } = setup();
      await act(async () => {
        await actions.toggleUserStatus('u1', 'active');
      });
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
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
      expect(onSetConfirm).toHaveBeenLastCalledWith(null);
      expect(mockedDeleteInvite).toHaveBeenCalledWith(authedFetch, 'CODE1');
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when delete rejects after confirm', async () => {
      mockedDeleteInvite.mockRejectedValue(new Error('delete fail'));
      const { actions, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvite('CODE1');
      });
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
      expect(refetchInvites).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'delete fail');
    });

    it('falls back to a generic message when a non-Error is thrown', async () => {
      mockedDeleteInvite.mockRejectedValue('boom');
      const { actions, onSetConfirm, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvite('CODE1');
      });
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
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
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
      expect(onSetConfirm).toHaveBeenLastCalledWith(null);
      expect(mockedDeleteInvalidInvites).toHaveBeenCalledWith(authedFetch);
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when the api rejects after confirm', async () => {
      mockedDeleteInvalidInvites.mockRejectedValue(new Error('del invalid fail'));
      const { actions, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvalidInvites();
      });
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
      expect(refetchInvites).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'del invalid fail');
    });

    it('falls back to a generic message when a non-Error is thrown', async () => {
      mockedDeleteInvalidInvites.mockRejectedValue('boom');
      const { actions, onSetConfirm, onNotify } = setup();
      await act(async () => {
        await actions.deleteInvalidInvites();
      });
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
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
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
      expect(onSetConfirm).toHaveBeenLastCalledWith(null);
      expect(mockedDeleteAllInvites).toHaveBeenCalledWith(authedFetch);
      expect(refetchInvites).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when delete rejects after confirm', async () => {
      mockedDeleteAllInvites.mockRejectedValue(new Error('del all fail'));
      const { actions, onSetConfirm, refetchInvites, onNotify } = setup();
      await act(async () => {
        await actions.deleteAllInvites();
      });
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
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
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
      expect(onSetConfirm).toHaveBeenLastCalledWith(null);
      expect(mockedDeleteUser).toHaveBeenCalledWith(authedFetch, 'u9');
      expect(refetchUsers).toHaveBeenCalledTimes(1);
      expect(onNotify).toHaveBeenCalledWith('success', expect.any(String));
    });

    it('notifies error when delete rejects after confirm', async () => {
      mockedDeleteUser.mockRejectedValue(new Error('del user fail'));
      const { actions, onSetConfirm, refetchUsers, onNotify } = setup();
      await act(async () => {
        await actions.deleteUser('u9');
      });
      const confirm = capturedConfirm(onSetConfirm);
      await act(async () => {
        confirm.onConfirm();
        await Promise.resolve();
      });
      expect(refetchUsers).not.toHaveBeenCalled();
      expect(onNotify).toHaveBeenCalledWith('error', 'del user fail');
    });
  });
});
