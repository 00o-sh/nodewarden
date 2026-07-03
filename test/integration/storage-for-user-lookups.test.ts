import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/services/storage';

// The per-user ownership lookups added by the upstream sync all resolve to null
// when the row is absent (or owned by a different user). Exercise those
// not-found branches directly against D1.
const storage = new StorageService(env.DB);

beforeAll(async () => {
  await storage.initializeDatabase();
});

describe('per-user ownership lookups return null when nothing matches', () => {
  const missing = crypto.randomUUID();
  const user = crypto.randomUUID();

  it('getCipherForUser', async () => {
    expect(await storage.getCipherForUser(missing, user)).toBeNull();
  });

  it('getFolderForUser', async () => {
    expect(await storage.getFolderForUser(missing, user)).toBeNull();
  });

  it('getAttachmentForUser', async () => {
    expect(await storage.getAttachmentForUser(missing, user)).toBeNull();
  });

  it('getSendForUser', async () => {
    expect(await storage.getSendForUser(missing, user)).toBeNull();
  });

  it('getAuthRequestByIdForUser', async () => {
    expect(await storage.getAuthRequestByIdForUser(missing, user)).toBeNull();
  });

  it('getFolder (id-only lookup) returns null when absent', async () => {
    expect(await storage.getFolder(missing)).toBeNull();
  });
});

describe('attachment repo not-found / empty-input branches', () => {
  const missing = crypto.randomUUID();

  it('getAttachment returns null for an absent id', async () => {
    expect(await storage.getAttachment(missing)).toBeNull();
  });

  it('deleteAttachment is a no-op for an absent id', async () => {
    await expect(storage.deleteAttachment(missing)).resolves.toBeUndefined();
  });

  it('bulkDeleteAttachmentsByIds short-circuits on an empty list', async () => {
    await expect(storage.bulkDeleteAttachmentsByIds([])).resolves.toBeUndefined();
  });

  it('getAttachmentsByCipherIds returns an empty map for no ids', async () => {
    expect((await storage.getAttachmentsByCipherIds([])).size).toBe(0);
  });

  it('getAttachmentsByCipher returns an empty list for an absent cipher', async () => {
    expect(await storage.getAttachmentsByCipher(missing)).toEqual([]);
  });

  it('getAttachmentsByUserId returns an empty map for an absent user', async () => {
    expect((await storage.getAttachmentsByUserId(missing)).size).toBe(0);
  });
});

describe('config/setup helpers', () => {
  it('reports the registration flag and treats a repeat init as a no-op', async () => {
    expect(typeof (await storage.isRegistered())).toBe('boolean');
    // Schema is already verified from beforeAll, so this takes the early return.
    await expect(storage.initializeDatabase()).resolves.toBeUndefined();
  });
});
