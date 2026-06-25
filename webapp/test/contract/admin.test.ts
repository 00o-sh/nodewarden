import { beforeAll, describe, expect, it } from 'vitest';
import {
  clearAuditLogs,
  createInvite,
  deleteAllInvites,
  deleteUser,
  getAuditLogSettings,
  listAdminInvites,
  listAdminUsers,
  listAuditLogs,
  revokeInvite,
  saveAuditLogSettings,
  setUserStatus,
} from '@/lib/api/admin';
import {
  createAuthedFetch,
  deriveLoginHash,
  loginWithPassword,
  registerAccount,
  unlockVaultKey,
} from '@/lib/api/auth';
import type { SessionState, TokenSuccess } from '@/lib/types';
import { DEFAULT_ITERATIONS, type ContractSession, fetchProfile, registerAndLogin } from './helpers';

// Admin endpoints driven through the real webapp api client against the real
// worker. The FIRST account registered in a fresh (per-file isolated) worker
// becomes role 'admin', so `admin` here owns every admin-only route. A second
// non-admin `member` account is the safe target for status/delete operations.
// Once an admin exists, registration requires a valid invite code, so the
// member is registered through the real invite flow (admin mints the code).
let admin: ContractSession;
let member: ContractSession;
let memberInviteCode: string;

// Mirror of helpers.registerAndLogin but threading an invite code through, since
// the shared helper registers without one (only valid for the first/admin user).
async function registerWithInviteAndLogin(
  label: string,
  inviteCode: string
): Promise<ContractSession> {
  const email = `contract-${label}-${crypto.randomUUID()}@vault.test`;
  const password = `pw-${crypto.randomUUID()}`;

  const reg = await registerAccount({
    email,
    name: 'Contract Test',
    password,
    inviteCode,
    fallbackIterations: DEFAULT_ITERATIONS,
  });
  if (!reg.ok) throw new Error(`register failed: ${reg.message}`);

  const prelogin = await deriveLoginHash(email, password, DEFAULT_ITERATIONS);
  const token = (await loginWithPassword(email, prelogin.hash)) as TokenSuccess;
  if (!token.access_token) throw new Error('login failed');

  const { symEncKey, symMacKey } = await unlockVaultKey(token.Key as string, prelogin.masterKey);
  let session: SessionState = {
    email,
    authMode: 'token',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    symEncKey,
    symMacKey,
  };
  const authedFetch = createAuthedFetch(
    () => session,
    (next) => {
      if (next) session = { ...next, symEncKey, symMacKey };
    }
  );
  return { email, password, session, authedFetch, masterKey: prelogin.masterKey };
}

beforeAll(async () => {
  admin = await registerAndLogin('admin');

  // Mint an invite as admin, read its code back, register the member with it.
  await createInvite(admin.authedFetch, 168);
  const invites = await listAdminInvites(admin.authedFetch);
  const active = invites.filter((i) => i.status === 'active');
  memberInviteCode = active[active.length - 1].code;

  member = await registerWithInviteAndLogin('member', memberInviteCode);
});

describe('admin users contract', () => {
  it('the first account is admin', async () => {
    const profile = await fetchProfile(admin);
    expect(profile.role).toBe('admin');
  });

  it('lists admin users including the admin itself', async () => {
    const users = await listAdminUsers(admin.authedFetch);
    expect(users.length).toBeGreaterThanOrEqual(2);

    const self = users.find((u) => u.email === admin.email);
    expect(self).toBeDefined();
    expect(self!.role).toBe('admin');
    expect(self!.status).toBe('active');
    expect(self!.id).toBeTruthy();

    const memberRow = users.find((u) => u.email === member.email);
    expect(memberRow).toBeDefined();
    expect(memberRow!.role).not.toBe('admin');
  });
});

describe('admin invites contract', () => {
  it('creates an invite that appears in the listing, then revokes it', async () => {
    const before = await listAdminInvites(admin.authedFetch);
    const beforeActive = before.filter((i) => i.status === 'active').length;

    await createInvite(admin.authedFetch, 48);

    const after = await listAdminInvites(admin.authedFetch);
    const activeInvites = after.filter((i) => i.status === 'active');
    expect(activeInvites.length).toBe(beforeActive + 1);

    const created = activeInvites[activeInvites.length - 1];
    expect(created.code).toBeTruthy();
    expect(created.inviteLink).toContain(created.code);

    await revokeInvite(admin.authedFetch, created.code);

    const afterRevoke = await listAdminInvites(admin.authedFetch);
    const stillActive = afterRevoke.find((i) => i.code === created.code && i.status === 'active');
    expect(stillActive).toBeUndefined();
  });

  it('deletes all invites', async () => {
    await createInvite(admin.authedFetch, 24);
    const seeded = await listAdminInvites(admin.authedFetch);
    expect(seeded.some((i) => i.status === 'active')).toBe(true);

    await deleteAllInvites(admin.authedFetch);

    const after = await listAdminInvites(admin.authedFetch);
    expect(after.some((i) => i.status === 'active')).toBe(false);
  });
});

describe('admin audit log settings contract', () => {
  it('round-trips audit log settings', async () => {
    const initial = await getAuditLogSettings(admin.authedFetch);
    expect(initial).toHaveProperty('retentionDays');
    expect(initial).toHaveProperty('maxEntries');

    // retentionDays must be one of the allowed values; saving retention clears maxEntries.
    const savedRetention = await saveAuditLogSettings(admin.authedFetch, {
      retentionDays: 30,
      maxEntries: null,
    });
    expect(savedRetention.retentionDays).toBe(30);
    expect(savedRetention.maxEntries).toBeNull();

    const reread = await getAuditLogSettings(admin.authedFetch);
    expect(reread.retentionDays).toBe(30);
    expect(reread.maxEntries).toBeNull();

    // Switching to maxEntries clears retentionDays.
    const savedMax = await saveAuditLogSettings(admin.authedFetch, {
      retentionDays: null,
      maxEntries: 5000,
    });
    expect(savedMax.retentionDays).toBeNull();
    expect(savedMax.maxEntries).toBe(5000);

    const rereadMax = await getAuditLogSettings(admin.authedFetch);
    expect(rereadMax.retentionDays).toBeNull();
    expect(rereadMax.maxEntries).toBe(5000);
  });
});

describe('admin audit logs contract', () => {
  it('lists audit logs without filters', async () => {
    // Prior admin actions (invite create/revoke, settings updates) wrote logs.
    const result = await listAuditLogs(admin.authedFetch);
    expect(Array.isArray(result.logs)).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
    expect(typeof result.hasMore).toBe('boolean');

    const entry = result.logs[0];
    expect(entry.id).toBeTruthy();
    expect(entry.action).toBeTruthy();
    expect(entry.category).toBeTruthy();
    expect(entry.level).toBeTruthy();
  });

  it('lists audit logs with category and limit filters', async () => {
    const all = await listAuditLogs(admin.authedFetch, { limit: 5 });
    expect(all.limit).toBe(5);
    expect(all.logs.length).toBeLessThanOrEqual(5);

    const systemOnly = await listAuditLogs(admin.authedFetch, { category: 'system', limit: 100 });
    expect(systemOnly.logs.every((l) => l.category === 'system')).toBe(true);

    // 'all' is treated as no category filter by the client.
    const unfiltered = await listAuditLogs(admin.authedFetch, { category: 'all' });
    expect(unfiltered.total).toBeGreaterThanOrEqual(systemOnly.total);
  });

  it('clears audit logs', async () => {
    const beforeClear = await listAuditLogs(admin.authedFetch, { limit: 1 });
    expect(beforeClear.total).toBeGreaterThan(0);

    const deleted = await clearAuditLogs(admin.authedFetch);
    expect(deleted).toBeGreaterThan(0);

    const after = await listAuditLogs(admin.authedFetch, { limit: 1 });
    // Clearing removes pre-existing entries; the clear action itself is not logged
    // by the worker, so the table should be (close to) empty.
    expect(after.total).toBeLessThan(beforeClear.total);
  });
});

describe('admin user status/delete contract', () => {
  it('bans then reactivates the member account', async () => {
    const users = await listAdminUsers(admin.authedFetch);
    const memberRow = users.find((u) => u.email === member.email);
    expect(memberRow).toBeDefined();
    const memberId = memberRow!.id;

    await setUserStatus(admin.authedFetch, memberId, 'banned');
    const afterBan = await listAdminUsers(admin.authedFetch);
    expect(afterBan.find((u) => u.id === memberId)!.status).toBe('banned');

    await setUserStatus(admin.authedFetch, memberId, 'active');
    const afterReactivate = await listAdminUsers(admin.authedFetch);
    expect(afterReactivate.find((u) => u.id === memberId)!.status).toBe('active');
  });

  it('deletes the member account', async () => {
    const users = await listAdminUsers(admin.authedFetch);
    const memberRow = users.find((u) => u.email === member.email);
    expect(memberRow).toBeDefined();
    const memberId = memberRow!.id;

    await deleteUser(admin.authedFetch, memberId);

    const after = await listAdminUsers(admin.authedFetch);
    expect(after.some((u) => u.id === memberId)).toBe(false);
    // The admin itself must survive.
    expect(after.some((u) => u.email === admin.email)).toBe(true);
  });
});
