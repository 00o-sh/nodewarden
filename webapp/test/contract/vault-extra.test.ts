import { beforeAll, describe, expect, it } from 'vitest';
import {
  archiveCipher,
  buildCipherImportPayload,
  bulkArchiveCiphers,
  bulkMoveCiphers,
  bulkPermanentDeleteCiphers,
  bulkRestoreCiphers,
  bulkUnarchiveCiphers,
  createCipher,
  createFolder,
  deleteCipher,
  encryptFolderImportName,
  getCipherById,
  getCiphers,
  getFolders,
  importCiphers,
  permanentDeleteCipher,
  unarchiveCipher,
  type CiphersImportPayload,
} from '@/lib/api/vault';
import { decryptSingleCipher } from '@/lib/decrypt-cipher';
import { importCipherToDraft } from '@/lib/app-support';
import { base64ToBytes } from '@/lib/crypto';
import type { Cipher, VaultDraft } from '@/lib/types';

type ApiError = Error & { status?: number };
import { type ContractSession, freshCacheKey, registerAndLogin } from './helpers';

// Lifecycle + import + error-path contract coverage for the vault api client,
// driven through the real webapp crypto against the real worker. These exercise
// functions NOT covered by vault.test.ts (archive/unarchive, soft-delete +
// restore, permanent delete, the bulk variants, bulkMove, importCiphers, and the
// getCipherById 404 path) so the encrypt -> POST -> sync -> decrypt loop is
// verified end to end for the trash/archive/move/import surface area.
let ctx: ContractSession;

function loginDraft(over: Partial<Record<string, unknown>> = {}): VaultDraft {
  return importCipherToDraft(
    {
      type: 1,
      name: 'Lifecycle',
      login: { username: 'neo', password: 'matrix', uris: [{ uri: 'https://example.com' }] },
      ...over,
    },
    null
  );
}

function decryptName(c: Cipher): Promise<Cipher> {
  return decryptSingleCipher(
    c,
    base64ToBytes(ctx.session.symEncKey!),
    base64ToBytes(ctx.session.symMacKey!)
  );
}

async function fetchById(id: string): Promise<Cipher | undefined> {
  const ciphers = await getCiphers(ctx.authedFetch, freshCacheKey());
  return ciphers.find((c) => c.id === id);
}

beforeAll(async () => {
  ctx = await registerAndLogin('vault-extra');
});

describe('cipher archive lifecycle contract', () => {
  it('archives then unarchives a cipher (archivedDate set then cleared)', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Archive me' }));

    const archived = await archiveCipher(ctx.authedFetch, created.id);
    expect(archived.id).toBe(created.id);
    expect(archived.archivedDate).toBeTruthy();

    const inSyncArchived = await fetchById(created.id);
    expect(inSyncArchived?.archivedDate).toBeTruthy();

    const unarchived = await unarchiveCipher(ctx.authedFetch, created.id);
    expect(unarchived.id).toBe(created.id);
    expect(unarchived.archivedDate ?? null).toBeNull();

    const inSyncActive = await fetchById(created.id);
    expect(inSyncActive?.archivedDate ?? null).toBeNull();
    // Round-trips: content survives the archive cycle.
    const decrypted = await decryptName(inSyncActive!);
    expect(decrypted.decName).toBe('Archive me');
  });
});

describe('cipher soft-delete + restore contract', () => {
  it('soft-deletes then restores via bulkRestoreCiphers (deletedDate set then cleared)', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Trash then restore' }));

    const deleted = await deleteCipher(ctx.authedFetch, created.id);
    expect(deleted.deletedDate).toBeTruthy();

    const trashed = await fetchById(created.id);
    expect(trashed?.deletedDate).toBeTruthy();

    await expect(bulkRestoreCiphers(ctx.authedFetch, [created.id])).resolves.toBeUndefined();

    const restored = await fetchById(created.id);
    expect(restored).toBeDefined();
    expect(restored?.deletedDate ?? null).toBeNull();
    const decrypted = await decryptName(restored!);
    expect(decrypted.decName).toBe('Trash then restore');
  });
});

describe('cipher permanent delete contract', () => {
  it('permanently removes a single cipher (gone from sync, getCipherById 404)', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Perma single' }));

    await expect(permanentDeleteCipher(ctx.authedFetch, created.id)).resolves.toBeUndefined();

    const after = await fetchById(created.id);
    expect(after).toBeUndefined();

    await expect(getCipherById(ctx.authedFetch, created.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('bulk archive / unarchive contract', () => {
  it('bulk-archives then bulk-unarchives multiple ciphers', async () => {
    const a = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'BulkArch A' }));
    const b = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'BulkArch B' }));

    await expect(bulkArchiveCiphers(ctx.authedFetch, [a.id, b.id])).resolves.toBeUndefined();
    const afterArchive = await getCiphers(ctx.authedFetch, freshCacheKey());
    expect(afterArchive.find((c) => c.id === a.id)?.archivedDate).toBeTruthy();
    expect(afterArchive.find((c) => c.id === b.id)?.archivedDate).toBeTruthy();

    await expect(bulkUnarchiveCiphers(ctx.authedFetch, [a.id, b.id])).resolves.toBeUndefined();
    const afterUnarchive = await getCiphers(ctx.authedFetch, freshCacheKey());
    expect(afterUnarchive.find((c) => c.id === a.id)?.archivedDate ?? null).toBeNull();
    expect(afterUnarchive.find((c) => c.id === b.id)?.archivedDate ?? null).toBeNull();
  });
});

describe('bulk permanent delete contract', () => {
  it('bulk-permanently-deletes soft-deleted ciphers', async () => {
    const a = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'BulkPerma A' }));
    const b = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'BulkPerma B' }));

    await deleteCipher(ctx.authedFetch, a.id);
    await deleteCipher(ctx.authedFetch, b.id);

    await expect(bulkPermanentDeleteCiphers(ctx.authedFetch, [a.id, b.id])).resolves.toBeUndefined();

    const after = await getCiphers(ctx.authedFetch, freshCacheKey());
    expect(after.some((c) => c.id === a.id)).toBe(false);
    expect(after.some((c) => c.id === b.id)).toBe(false);
  });
});

describe('bulk move contract', () => {
  it('moves ciphers into a folder then back to no folder', async () => {
    const folder = await createFolder(ctx.authedFetch, ctx.session, 'Move Target');
    const a = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Move A' }));
    const b = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Move B' }));

    await expect(bulkMoveCiphers(ctx.authedFetch, [a.id, b.id], folder.id)).resolves.toBeUndefined();
    const afterMove = await getCiphers(ctx.authedFetch, freshCacheKey());
    expect(afterMove.find((c) => c.id === a.id)?.folderId).toBe(folder.id);
    expect(afterMove.find((c) => c.id === b.id)?.folderId).toBe(folder.id);

    await expect(bulkMoveCiphers(ctx.authedFetch, [a.id, b.id], null)).resolves.toBeUndefined();
    const afterClear = await getCiphers(ctx.authedFetch, freshCacheKey());
    expect(afterClear.find((c) => c.id === a.id)?.folderId ?? null).toBeNull();
    expect(afterClear.find((c) => c.id === b.id)?.folderId ?? null).toBeNull();
  });
});

describe('import ciphers contract', () => {
  it('imports ciphers + a folder with folderRelationships the worker persists', async () => {
    // Encrypt two ciphers and one folder with the session keys, exactly as the
    // importer does, then wire folderRelationships so cipher #0 lands in the
    // imported folder.
    const cipher0 = await buildCipherImportPayload(
      ctx.session,
      loginDraft({ name: 'Imported One', login: { username: 'alice', password: 'a-secret' } })
    );
    const cipher1 = await buildCipherImportPayload(
      ctx.session,
      loginDraft({ name: 'Imported Two', login: { username: 'bob', password: 'b-secret' } })
    );
    const folderName = 'Imported Folder';
    const encryptedFolderName = await encryptFolderImportName(ctx.session, folderName);

    const payload: CiphersImportPayload = {
      ciphers: [cipher0, cipher1],
      folders: [{ name: encryptedFolderName }],
      folderRelationships: [{ key: 0, value: 0 }],
    };

    const map = await importCiphers(ctx.authedFetch, payload, { returnCipherMap: true });
    expect(Array.isArray(map)).toBe(true);
    expect(map!.length).toBe(2);
    const importedIds = map!.map((m) => m.id);

    const ciphers = await getCiphers(ctx.authedFetch, freshCacheKey());
    const imported = ciphers.filter((c) => importedIds.includes(c.id));
    expect(imported.length).toBe(2);

    const decrypted = await Promise.all(imported.map((c) => decryptName(c)));
    const names = decrypted.map((c) => c.decName).sort();
    expect(names).toEqual(['Imported One', 'Imported Two']);

    // The first imported cipher should be filed under the imported folder, which
    // means a brand-new folder id was created and linked via the relationship.
    const cipherOne = decrypted.find((c) => c.decName === 'Imported One')!;
    expect(cipherOne.folderId).toBeTruthy();

    const folders = await getFolders(ctx.authedFetch, freshCacheKey());
    const importedFolder = folders.find((f) => f.id === cipherOne.folderId);
    expect(importedFolder).toBeDefined();
  });
});

describe('getCipherById error path contract', () => {
  it('throws a 404 api error for a non-existent cipher id', async () => {
    const bogusId = crypto.randomUUID();
    let caught: ApiError | null = null;
    try {
      await getCipherById(ctx.authedFetch, bogusId);
    } catch (err) {
      caught = err as ApiError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.status).toBe(404);
  });
});
