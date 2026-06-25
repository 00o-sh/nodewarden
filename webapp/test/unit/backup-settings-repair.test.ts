import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, SessionState } from '@/lib/types';

// Mock the three dependency modules so we exercise only the orchestration
// logic in silentlyRepairBackupSettingsIfNeeded.
const createAuthedFetch = vi.fn(() => 'AUTHED_FETCH' as unknown);
const getAdminBackupSettingsRepairState = vi.fn();
const repairAdminBackupSettings = vi.fn();
const decryptPortableBackupSettings = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  createAuthedFetch: (...args: unknown[]) => createAuthedFetch(...args),
}));
vi.mock('@/lib/api/backup', () => ({
  getAdminBackupSettingsRepairState: (...args: unknown[]) =>
    getAdminBackupSettingsRepairState(...args),
  repairAdminBackupSettings: (...args: unknown[]) => repairAdminBackupSettings(...args),
}));
vi.mock('@/lib/admin-backup-portable', () => ({
  decryptPortableBackupSettings: (...args: unknown[]) =>
    decryptPortableBackupSettings(...args),
}));

import { silentlyRepairBackupSettingsIfNeeded } from '@/lib/backup-settings-repair';

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    email: 'admin@example.com',
    accessToken: 'token',
    symEncKey: 'enc',
    symMacKey: 'mac',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    email: 'admin@example.com',
    name: 'Admin',
    key: 'k',
    role: 'admin',
    ...overrides,
  };
}

describe('silentlyRepairBackupSettingsIfNeeded', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does nothing for non-admin profiles', async () => {
    await silentlyRepairBackupSettingsIfNeeded(
      makeSession(),
      makeProfile({ role: 'user' }),
      { masterPasswordHash: 'h' }
    );
    expect(getAdminBackupSettingsRepairState).not.toHaveBeenCalled();
    expect(createAuthedFetch).not.toHaveBeenCalled();
  });

  it('does nothing when the session lacks an access token', async () => {
    await silentlyRepairBackupSettingsIfNeeded(
      makeSession({ accessToken: undefined }),
      makeProfile(),
      { masterPasswordHash: 'h' }
    );
    expect(getAdminBackupSettingsRepairState).not.toHaveBeenCalled();
  });

  it('does nothing when the session lacks symmetric keys', async () => {
    await silentlyRepairBackupSettingsIfNeeded(
      makeSession({ symEncKey: undefined }),
      makeProfile(),
      { masterPasswordHash: 'h' }
    );
    await silentlyRepairBackupSettingsIfNeeded(
      makeSession({ symMacKey: undefined }),
      makeProfile(),
      { masterPasswordHash: 'h' }
    );
    expect(getAdminBackupSettingsRepairState).not.toHaveBeenCalled();
  });

  it('returns early when repair is not needed', async () => {
    getAdminBackupSettingsRepairState.mockResolvedValue({ needsRepair: false, portable: null });
    await silentlyRepairBackupSettingsIfNeeded(makeSession(), makeProfile(), {
      masterPasswordHash: 'h',
    });
    expect(getAdminBackupSettingsRepairState).toHaveBeenCalledTimes(1);
    expect(decryptPortableBackupSettings).not.toHaveBeenCalled();
    expect(repairAdminBackupSettings).not.toHaveBeenCalled();
  });

  it('returns early when there is no portable payload even if repair is flagged', async () => {
    getAdminBackupSettingsRepairState.mockResolvedValue({ needsRepair: true, portable: null });
    await silentlyRepairBackupSettingsIfNeeded(makeSession(), makeProfile(), {
      masterPasswordHash: 'h',
    });
    expect(decryptPortableBackupSettings).not.toHaveBeenCalled();
    expect(repairAdminBackupSettings).not.toHaveBeenCalled();
  });

  it('returns early when no verification material is supplied', async () => {
    getAdminBackupSettingsRepairState.mockResolvedValue({
      needsRepair: true,
      portable: { some: 'data' },
    });

    await silentlyRepairBackupSettingsIfNeeded(makeSession(), makeProfile(), null);
    await silentlyRepairBackupSettingsIfNeeded(makeSession(), makeProfile(), undefined);
    await silentlyRepairBackupSettingsIfNeeded(makeSession(), makeProfile(), {
      masterPasswordHash: '',
      userVerificationToken: null,
    });

    expect(getAdminBackupSettingsRepairState).toHaveBeenCalledTimes(3);
    expect(decryptPortableBackupSettings).not.toHaveBeenCalled();
    expect(repairAdminBackupSettings).not.toHaveBeenCalled();
  });

  it('performs the repair when needed with a master password hash', async () => {
    const session = makeSession();
    const profile = makeProfile();
    const portable = { encrypted: 'blob' };
    const repaired = { destinations: [] };
    getAdminBackupSettingsRepairState.mockResolvedValue({ needsRepair: true, portable });
    decryptPortableBackupSettings.mockResolvedValue(repaired);
    repairAdminBackupSettings.mockResolvedValue(repaired);

    const verification = { masterPasswordHash: 'hash' };
    await silentlyRepairBackupSettingsIfNeeded(session, profile, verification);

    expect(createAuthedFetch).toHaveBeenCalledTimes(1);
    expect(decryptPortableBackupSettings).toHaveBeenCalledWith(portable, profile, session);
    expect(repairAdminBackupSettings).toHaveBeenCalledWith(
      'AUTHED_FETCH',
      verification,
      repaired
    );
  });

  it('performs the repair when only a user verification token is supplied', async () => {
    getAdminBackupSettingsRepairState.mockResolvedValue({
      needsRepair: true,
      portable: { x: 1 },
    });
    decryptPortableBackupSettings.mockResolvedValue({ destinations: [] });
    repairAdminBackupSettings.mockResolvedValue({ destinations: [] });

    await silentlyRepairBackupSettingsIfNeeded(makeSession(), makeProfile(), {
      userVerificationToken: 'uvt',
    });

    expect(repairAdminBackupSettings).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from the repair state fetch and logs them', async () => {
    getAdminBackupSettingsRepairState.mockRejectedValue(new Error('network down'));
    await expect(
      silentlyRepairBackupSettingsIfNeeded(makeSession(), makeProfile(), {
        masterPasswordHash: 'h',
      })
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Backup settings auto-repair failed:',
      expect.any(Error)
    );
    expect(repairAdminBackupSettings).not.toHaveBeenCalled();
  });

  it('swallows errors thrown during decryption', async () => {
    getAdminBackupSettingsRepairState.mockResolvedValue({
      needsRepair: true,
      portable: { x: 1 },
    });
    decryptPortableBackupSettings.mockRejectedValue(new Error('bad key'));
    await expect(
      silentlyRepairBackupSettingsIfNeeded(makeSession(), makeProfile(), {
        masterPasswordHash: 'h',
      })
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(repairAdminBackupSettings).not.toHaveBeenCalled();
  });
});
