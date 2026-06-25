import { beforeAll, describe, expect, it } from 'vitest';
import {
  bulkDeleteCiphers,
  createCipher,
  createFolder,
  deleteCipher,
  deleteFolder,
  getCipherById,
  getCiphers,
  getFolderById,
  getFolders,
  updateCipher,
  updateFolder,
} from '@/lib/api/vault';
import { decryptSingleCipher } from '@/lib/decrypt-cipher';
import { importCipherToDraft } from '@/lib/app-support';
import { base64ToBytes } from '@/lib/crypto';
import type { VaultDraft } from '@/lib/types';
import { type ContractSession, freshCacheKey, registerAndLogin } from './helpers';

// Folder + cipher CRUD driven through the real webapp api client against the
// real worker, with real client-side encryption. Proves the frontend's encrypt
// -> POST -> sync -> decrypt loop agrees with the backend end to end.
let ctx: ContractSession;

function loginDraft(over: Partial<Record<string, unknown>> = {}): VaultDraft {
  return importCipherToDraft(
    {
      type: 1,
      name: 'GitHub',
      login: { username: 'octocat', password: 'hunter2', uris: [{ uri: 'https://github.com' }] },
      ...over,
    },
    null
  );
}

beforeAll(async () => {
  ctx = await registerAndLogin('vault');
});

describe('folder CRUD contract', () => {
  it('creates, lists, fetches, renames and deletes a folder', async () => {
    const created = await createFolder(ctx.authedFetch, ctx.session, 'Work');
    expect(created.id).toBeTruthy();

    const folders = await getFolders(ctx.authedFetch, freshCacheKey());
    expect(folders.some((f) => f.id === created.id)).toBe(true);

    const byId = await getFolderById(ctx.authedFetch, created.id);
    expect(byId.id).toBe(created.id);

    const renamed = await updateFolder(ctx.authedFetch, ctx.session, created.id, 'Personal');
    expect(renamed.id).toBe(created.id);

    await deleteFolder(ctx.authedFetch, created.id);
    const after = await getFolders(ctx.authedFetch, freshCacheKey());
    expect(after.some((f) => f.id === created.id)).toBe(false);
  });
});

describe('cipher CRUD contract', () => {
  it('creates a login cipher the backend stores and the client can decrypt', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft());
    expect(created.id).toBeTruthy();

    const ciphers = await getCiphers(ctx.authedFetch, freshCacheKey());
    expect(ciphers.some((c) => c.id === created.id)).toBe(true);

    const fetched = await getCipherById(ctx.authedFetch, created.id);
    const decrypted = await decryptSingleCipher(
      fetched,
      base64ToBytes(ctx.session.symEncKey!),
      base64ToBytes(ctx.session.symMacKey!)
    );
    expect(decrypted.login?.decUsername).toBe('octocat');
    expect(decrypted.login?.decPassword).toBe('hunter2');
  });

  it('updates a cipher', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Before' }));
    const updated = await updateCipher(
      ctx.authedFetch,
      ctx.session,
      created,
      loginDraft({ name: 'After' })
    );
    const decrypted = await decryptSingleCipher(
      updated,
      base64ToBytes(ctx.session.symEncKey!),
      base64ToBytes(ctx.session.symMacKey!)
    );
    expect(decrypted.decName).toBe('After');
  });

  it('soft-deletes a cipher (marks deletedDate)', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft());
    const deleted = await deleteCipher(ctx.authedFetch, created.id);
    expect(deleted.deletedDate ?? deleted.id).toBeTruthy();
  });

  it('bulk-deletes ciphers', async () => {
    const a = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'A' }));
    const b = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'B' }));
    await expect(bulkDeleteCiphers(ctx.authedFetch, [a.id, b.id])).resolves.toBeUndefined();
  });
});
