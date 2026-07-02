import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/services/storage';
import type { AuditLog, Invite, User } from '../../src/types';
import { enc } from './helpers';

// Direct coverage of the admin/audit/invite/config repos against D1.
const storage = new StorageService(env.DB);
let userId: string;
let usedById: string;

beforeAll(async () => {
  await storage.initializeDatabase();
  // audit_logs.actor_user_id and invites.created_by/used_by have FK -> users(id).
  userId = (await createUser()).id;
  usedById = (await createUser()).id;
});

async function createUser(): Promise<User> {
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email: `adm-${crypto.randomUUID()}@vault.test`,
    name: 'Admin Repo',
    masterPasswordHint: null,
    masterPasswordHash: enc('mph'),
    key: enc('key'),
    privateKey: enc('priv'),
    publicKey: 'pub',
    kdfType: 0,
    kdfIterations: 600000,
    kdfMemory: undefined,
    kdfParallelism: undefined,
    securityStamp: crypto.randomUUID(),
    role: 'user',
    status: 'active',
    verifyDevices: true,
    totpSecret: null,
    totpRecoveryCode: null,
    apiKey: null,
    createdAt: now,
    updatedAt: now,
  } as User;
  await storage.createUser(user);
  return user;
}

function makeAuditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: crypto.randomUUID(),
    actorUserId: userId,
    action: 'test.event',
    category: 'system',
    level: 'info',
    targetType: 'user',
    targetId: crypto.randomUUID(),
    metadata: JSON.stringify({ a: 1 }),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('audit log repo', () => {
  it('creates, lists, and clears audit logs', async () => {
    const log = makeAuditLog();
    await storage.createAuditLog(log);

    const listed = await storage.listAuditLogs({ limit: 50, offset: 0 });
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.logs.some((l) => l.id === log.id)).toBe(true);

    const cleared = await storage.clearAuditLogs();
    expect(cleared).toBeGreaterThanOrEqual(1);
    expect((await storage.listAuditLogs({ limit: 50, offset: 0 })).total).toBe(0);
  });

  it('prunes audit logs before a cutoff', async () => {
    await storage.createAuditLog(makeAuditLog({ createdAt: '2000-01-01T00:00:00.000Z' }));
    const pruned = await storage.pruneAuditLogs('2001-01-01T00:00:00.000Z');
    expect(pruned).toBeGreaterThanOrEqual(1);
  });
});

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  const now = new Date().toISOString();
  return {
    code: crypto.randomUUID().replace(/-/g, ''),
    createdBy: userId,
    usedBy: null,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('invite repo', () => {
  it('creates, looks up, marks used, and revokes invites', async () => {
    const invite = makeInvite();
    await storage.createInvite(invite);
    expect((await storage.getInvite(invite.code))?.code).toBe(invite.code);

    expect(await storage.markInviteUsed(invite.code, usedById)).toBe(true);
    // A used invite can't be marked used again.
    expect(await storage.markInviteUsed(invite.code, usedById)).toBe(false);

    const deletable = makeInvite();
    await storage.createInvite(deletable);
    expect(await storage.deleteInvite(deletable.code)).toBe(true);
  });

  it('lists active invites', async () => {
    await storage.createInvite(makeInvite());
    const list = await storage.listInvites();
    expect(Array.isArray(list)).toBe(true);
  });
});

describe('config repo', () => {
  it('reads and writes config values', async () => {
    const key = `test.${crypto.randomUUID()}`;
    expect(await storage.getConfigValue(key)).toBeNull();
    await storage.setConfigValue(key, 'hello');
    expect(await storage.getConfigValue(key)).toBe('hello');
  });
});
