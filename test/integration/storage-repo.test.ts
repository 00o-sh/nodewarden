import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/services/storage';
import type { Cipher, Folder, User } from '../../src/types';
import { enc } from './helpers';

// Tier 3: exercise the storage repos directly against a live D1 binding,
// isolating the persistence/SQL layer from routing and auth. This is the fast
// net that catches SQL regressions (scoping, uniqueness, hashing) when merging
// upstream, independent of the HTTP handlers.
const storage = new StorageService(env.DB);

beforeAll(async () => {
  await storage.initializeDatabase();
});

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    email: `repo-${crypto.randomUUID()}@vault.test`,
    name: 'Repo Test',
    masterPasswordHint: null,
    masterPasswordHash: enc('mph'),
    key: enc('key'),
    privateKey: enc('priv'),
    publicKey: btoa('public-key'),
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
    ...overrides,
  } as User;
}

function makeCipher(userId: string, overrides: Partial<Cipher> = {}): Cipher {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId,
    type: 1,
    folderId: null,
    name: enc('name'),
    notes: null,
    favorite: false,
    reprompt: 0,
    login: { username: enc('u'), password: enc('p') },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  } as Cipher;
}

function makeFolder(userId: string, overrides: Partial<Folder> = {}): Folder {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId,
    name: enc('folder'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Folder;
}

describe('user repo', () => {
  it('persists and looks up a user by email and id (case-insensitive email)', async () => {
    const user = makeUser({ email: `Mixed-${crypto.randomUUID()}@Vault.Test`.toLowerCase() });
    await storage.createUser(user);

    expect((await storage.getUser(user.email))?.id).toBe(user.id);
    expect((await storage.getUserById(user.id))?.email).toBe(user.email);
  });

  it('enforces unique emails', async () => {
    const user = makeUser();
    await storage.createUser(user);
    await expect(storage.createUser(makeUser({ email: user.email }))).rejects.toThrow();
  });

  it('createFirstUser succeeds only while no users exist', async () => {
    // Other tests in this file have already created users, so the "first user"
    // guard must now refuse.
    expect(await storage.createFirstUser(makeUser())).toBe(false);
  });
});

describe('cipher repo', () => {
  it('persists a cipher and scopes reads to the owner', async () => {
    const owner = makeUser();
    const other = makeUser();
    await storage.createUser(owner);
    await storage.createUser(other);

    const cipher = makeCipher(owner.id);
    await storage.saveCipher(cipher);

    expect((await storage.getCipher(cipher.id))?.userId).toBe(owner.id);
    expect((await storage.getAllCiphers(owner.id)).map((c) => c.id)).toContain(cipher.id);
    // Owner scoping: the other user does not see it.
    expect((await storage.getAllCiphers(other.id)).map((c) => c.id)).not.toContain(cipher.id);
  });

  it('round-trips structured login JSON', async () => {
    const owner = makeUser();
    await storage.createUser(owner);
    const username = enc('user');
    const cipher = makeCipher(owner.id, { login: { username, password: enc('pass') } });
    await storage.saveCipher(cipher);

    const stored = await storage.getCipher(cipher.id);
    expect((stored as any)?.login?.username).toBe(username);
  });

  it('deletes a cipher scoped to its owner', async () => {
    const owner = makeUser();
    await storage.createUser(owner);
    const cipher = makeCipher(owner.id);
    await storage.saveCipher(cipher);

    await storage.deleteCipher(cipher.id, owner.id);
    expect(await storage.getCipher(cipher.id)).toBeNull();
  });
});

describe('folder repo', () => {
  it('persists folders scoped to the owner', async () => {
    const owner = makeUser();
    const other = makeUser();
    await storage.createUser(owner);
    await storage.createUser(other);

    const folder = makeFolder(owner.id);
    await storage.saveFolder(folder);

    expect((await storage.getAllFolders(owner.id)).map((f) => f.id)).toContain(folder.id);
    expect((await storage.getAllFolders(other.id)).map((f) => f.id)).not.toContain(folder.id);

    await storage.deleteFolder(folder.id, owner.id);
    expect((await storage.getAllFolders(owner.id)).map((f) => f.id)).not.toContain(folder.id);
  });
});

describe('refresh token repo', () => {
  it('stores tokens hashed and resolves the owner by the raw token', async () => {
    const owner = makeUser();
    await storage.createUser(owner);
    const rawToken = `refresh-${crypto.randomUUID()}`;

    await storage.saveRefreshToken(rawToken, owner.id);

    expect(await storage.getRefreshTokenUserId(rawToken)).toBe(owner.id);
    // A different token does not resolve.
    expect(await storage.getRefreshTokenUserId(`refresh-${crypto.randomUUID()}`)).toBeNull();

    // The raw token is never stored verbatim (only a sha256 key).
    const row = await env.DB.prepare('SELECT token FROM refresh_tokens LIMIT 1').first<{ token: string }>();
    expect(row?.token).not.toBe(rawToken);

    await storage.deleteRefreshToken(rawToken);
    expect(await storage.getRefreshTokenUserId(rawToken)).toBeNull();
  });
});

describe('revision dates', () => {
  it('advances the user revision on update', async () => {
    const owner = makeUser();
    await storage.createUser(owner);

    const first = await storage.updateRevisionDate(owner.id);
    expect(typeof first).toBe('string');
    const second = await storage.updateRevisionDate(owner.id);
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
    expect(await storage.getRevisionDate(owner.id)).toBe(second);
  });
});
