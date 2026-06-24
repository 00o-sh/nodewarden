import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/services/storage';
import type { EmailAlias, User } from '../../src/types';
import {
  countEmailAliasesByUserId,
  createAliasApiToken,
  createEmailAlias,
  deleteAliasApiToken,
  deleteEmailAlias,
  getActiveAliasApiTokenByHash,
  getEmailAliasByAddress,
  getEmailAliasById,
  listAliasApiTokensByUserId,
  listEmailAliasesByUserId,
  touchAliasApiTokenLastUsed,
  updateEmailAlias,
} from '../../src/services/storage-email-alias-repo';
import { getAliasSettings, saveAliasSettings } from '../../src/services/alias-generator';
import { enc } from './helpers';

// Direct repo coverage against D1, exercising every branch (optional fields on
// update, inactive rows, not-found paths, and the active-user token JOIN).
const storage = new StorageService(env.DB);

beforeAll(async () => {
  await storage.initializeDatabase();
});

async function makeUser(status: 'active' | 'banned' = 'active'): Promise<User> {
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email: `alias-${crypto.randomUUID()}@vault.test`,
    name: 'Alias',
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
    status,
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

function makeAlias(userId: string, overrides: Partial<EmailAlias> = {}): EmailAlias {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId,
    address: `${crypto.randomUUID()}@alias.test`,
    domain: 'alias.test',
    destination: 'inbox@vault.test',
    description: 'desc',
    active: true,
    cfRuleId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('email alias repo', () => {
  it('creates, reads, lists, counts, and deletes aliases scoped to the owner', async () => {
    const user = await makeUser();
    const alias = makeAlias(user.id);
    await createEmailAlias(env.DB, alias);

    expect((await getEmailAliasById(env.DB, user.id, alias.id))?.address).toBe(alias.address);
    expect((await getEmailAliasByAddress(env.DB, alias.address.toUpperCase()))?.id).toBe(alias.id);
    expect((await listEmailAliasesByUserId(env.DB, user.id)).length).toBe(1);
    expect(await countEmailAliasesByUserId(env.DB, user.id)).toBe(1);

    // Not-found paths.
    expect(await getEmailAliasById(env.DB, user.id, crypto.randomUUID())).toBeNull();
    expect(await getEmailAliasByAddress(env.DB, 'missing@alias.test')).toBeNull();

    expect(await deleteEmailAlias(env.DB, user.id, alias.id)).toBe(true);
    expect(await deleteEmailAlias(env.DB, user.id, alias.id)).toBe(false);
  });

  it('maps an inactive row and a null description', async () => {
    const user = await makeUser();
    const alias = makeAlias(user.id, { active: false, description: null });
    await createEmailAlias(env.DB, alias);
    const read = await getEmailAliasById(env.DB, user.id, alias.id);
    expect(read?.active).toBe(false);
    expect(read?.description).toBeNull();
  });

  it('updates each field independently and returns false for an empty/missing update', async () => {
    const user = await makeUser();
    const alias = makeAlias(user.id);
    await createEmailAlias(env.DB, alias);

    expect(await updateEmailAlias(env.DB, user.id, alias.id, { active: false }, new Date().toISOString())).toBe(true);
    expect(await updateEmailAlias(env.DB, user.id, alias.id, { description: null }, new Date().toISOString())).toBe(true);
    expect(await updateEmailAlias(env.DB, user.id, alias.id, { destination: 'new@vault.test' }, new Date().toISOString())).toBe(true);
    expect(await updateEmailAlias(env.DB, user.id, alias.id, { cfRuleId: 'rule-x' }, new Date().toISOString())).toBe(true);

    const read = await getEmailAliasById(env.DB, user.id, alias.id);
    expect(read?.active).toBe(false);
    expect(read?.destination).toBe('new@vault.test');
    expect(read?.cfRuleId).toBe('rule-x');

    // Empty update set -> false.
    expect(await updateEmailAlias(env.DB, user.id, alias.id, {}, new Date().toISOString())).toBe(false);
    // Unknown id -> false.
    expect(await updateEmailAlias(env.DB, user.id, crypto.randomUUID(), { active: true }, new Date().toISOString())).toBe(false);
  });

  it('resolves API tokens only for active users and maps last_used_at', async () => {
    const user = await makeUser();
    const now = new Date().toISOString();
    await createAliasApiToken(env.DB, {
      id: crypto.randomUUID(),
      userId: user.id,
      name: 'cli',
      tokenHash: 'hash-active',
      lastUsedAt: null,
      createdAt: now,
    });

    const found = await getActiveAliasApiTokenByHash(env.DB, 'hash-active');
    expect(found?.userId).toBe(user.id);
    expect(found?.lastUsedAt).toBeNull();
    expect(await getActiveAliasApiTokenByHash(env.DB, 'no-such-hash')).toBeNull();

    expect((await listAliasApiTokensByUserId(env.DB, user.id)).length).toBe(1);
    await touchAliasApiTokenLastUsed(env.DB, found!.id, now);
    const touched = await getActiveAliasApiTokenByHash(env.DB, 'hash-active');
    expect(typeof touched?.lastUsedAt).toBe('string');

    // A token for a banned user does not resolve.
    const banned = await makeUser('banned');
    await createAliasApiToken(env.DB, {
      id: crypto.randomUUID(),
      userId: banned.id,
      name: 'cli',
      tokenHash: 'hash-banned',
      lastUsedAt: null,
      createdAt: now,
    });
    expect(await getActiveAliasApiTokenByHash(env.DB, 'hash-banned')).toBeNull();

    expect(await deleteAliasApiToken(env.DB, user.id, found!.id)).toBe(true);
    expect(await deleteAliasApiToken(env.DB, user.id, found!.id)).toBe(false);
  });
});

describe('alias generator settings', () => {
  const ALIAS_SETTINGS_KEY = 'alias.generator.settings';

  it('returns disabled defaults when nothing is stored', async () => {
    // This file's D1 never stores alias settings, so the first read is the
    // unconfigured default.
    const settings = await getAliasSettings(storage);
    expect(settings.enabled).toBe(false);
    expect(settings.domains).toEqual([]);
    expect(settings.defaultDomain).toBeNull();
  });

  it('round-trips saved settings and falls back to defaults on corrupt JSON', async () => {
    await saveAliasSettings(storage, {
      enabled: true,
      domains: ['alias.test'],
      defaultDomain: 'alias.test',
      defaultDestination: 'inbox@vault.test',
      recipients: ['inbox@vault.test'],
    });
    const saved = await getAliasSettings(storage);
    expect(saved.enabled).toBe(true);
    expect(saved.domains).toEqual(['alias.test']);

    await storage.setConfigValue(ALIAS_SETTINGS_KEY, '{ not valid json');
    const corrupt = await getAliasSettings(storage);
    expect(corrupt.enabled).toBe(false);
    expect(corrupt.domains).toEqual([]);
  });
});
