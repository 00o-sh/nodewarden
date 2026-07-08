import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64, decryptStr } from '@/lib/crypto';
import type { SessionState } from '@/lib/types';
import {
  archiveCipher,
  buildCipherImportPayload,
  bulkArchiveCiphers,
  bulkDeleteCiphers,
  bulkDeleteFolders,
  bulkMoveCiphers,
  bulkPermanentDeleteCiphers,
  bulkRestoreCiphers,
  bulkUnarchiveCiphers,
  createCipher,
  createFolder,
  deleteCipher,
  deleteCipherAttachment,
  deleteFolder,
  encryptFolderImportName,
  getAttachmentDownloadInfo,
  getCipherById,
  getFolderById,
  importCiphers,
  permanentDeleteCipher,
  repairCipherAttachmentMetadata,
  unarchiveCipher,
  updateCipher,
  updateFolder,
} from '@/lib/api/vault';

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const emptyOk = () => Promise.resolve(new Response(null, { status: 200 }));
const fail = (status = 500) => () => Promise.resolve(new Response(null, { status }));

function unlockedSession(): SessionState {
  return {
    email: 'user@example.com',
    authMode: 'token',
    accessToken: 'tok',
    symEncKey: bytesToBase64(new Uint8Array(32).fill(7)),
    symMacKey: bytesToBase64(new Uint8Array(32).fill(9)),
  } as SessionState;
}

const lastInit = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][1];

describe('api/vault getFolderById', () => {
  it('requires a folder id', async () => {
    await expect(getFolderById(vi.fn() as any, '  ')).rejects.toThrow('Folder id is required');
  });

  it('maps a 404 to a not-found api error', async () => {
    const authedFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    await expect(getFolderById(authedFetch as any, 'f1')).rejects.toThrow('Folder not found');
  });

  it('returns the parsed folder on success', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'f1', name: 'enc' }));
    expect(await getFolderById(authedFetch as any, 'f 1')).toEqual({ id: 'f1', name: 'enc' });
    expect(authedFetch).toHaveBeenCalledWith('/api/folders/f%201');
  });

  it('throws when the body has no id', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    await expect(getFolderById(authedFetch as any, 'f1')).rejects.toThrow('Load folder failed');
  });
});

describe('api/vault createFolder', () => {
  it('rejects a locked vault', async () => {
    const locked = { ...unlockedSession(), symEncKey: undefined };
    await expect(createFolder(vi.fn() as any, locked as SessionState, 'Work')).rejects.toThrow('Vault key unavailable');
  });

  it('encrypts the name and posts it, returning the created folder', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'new', name: 'x' }));
    const result = await createFolder(authedFetch as any, unlockedSession(), 'Work');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/folders');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    // Name is encrypted into a Bitwarden cipher string, not sent in the clear.
    expect(body.name).toMatch(/^2\..+\|.+\|.+$/);
    expect(body.name).not.toContain('Work');
    expect(result).toEqual({ id: 'new', name: 'x' });
  });

  it('throws when the create response omits an id', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    await expect(createFolder(authedFetch as any, unlockedSession(), 'Work')).rejects.toThrow('Create folder failed');
  });
});

describe('api/vault encryptFolderImportName', () => {
  it('produces a round-trippable cipher string', async () => {
    const session = unlockedSession();
    const cipher = await encryptFolderImportName(session, 'Imported');
    expect(cipher).toMatch(/^2\./);
    const enc = new Uint8Array(32).fill(7);
    const mac = new Uint8Array(32).fill(9);
    expect(await decryptStr(cipher, enc, mac)).toBe('Imported');
  });

  it('rejects a locked vault', async () => {
    const locked = { ...unlockedSession(), symMacKey: undefined };
    await expect(encryptFolderImportName(locked as SessionState, 'x')).rejects.toThrow('Vault key unavailable');
  });
});

describe('api/vault deleteFolder', () => {
  it('requires a folder id', async () => {
    await expect(deleteFolder(vi.fn() as any, '')).rejects.toThrow('Folder id is required');
  });

  it('DELETEs the encoded folder endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await deleteFolder(authedFetch as any, 'f/1');
    expect(authedFetch).toHaveBeenCalledWith('/api/folders/f%2F1', { method: 'DELETE' });
  });

  it('throws on a non-ok response', async () => {
    await expect(deleteFolder(vi.fn(fail()) as any, 'f1')).rejects.toThrow('Delete folder failed');
  });
});

describe('api/vault updateFolder', () => {
  it('requires a folder id', async () => {
    await expect(updateFolder(vi.fn() as any, unlockedSession(), ' ', 'n')).rejects.toThrow('Folder id is required');
  });

  it('rejects a locked vault', async () => {
    const locked = { ...unlockedSession(), symEncKey: undefined };
    await expect(updateFolder(vi.fn() as any, locked as SessionState, 'f1', 'n')).rejects.toThrow('Vault key unavailable');
  });

  it('PUTs an encrypted name to the encoded endpoint', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'f1' }));
    await updateFolder(authedFetch as any, unlockedSession(), 'f1', 'Renamed');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/folders/f1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body).name).toMatch(/^2\./);
  });
});

describe('api/vault getCipherById', () => {
  it('requires a cipher id', async () => {
    await expect(getCipherById(vi.fn() as any, '')).rejects.toThrow('Cipher id is required');
  });

  it('maps a 404 to a not-found api error', async () => {
    const authedFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    await expect(getCipherById(authedFetch as any, 'c1')).rejects.toThrow('Cipher not found');
  });

  it('returns the parsed cipher', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    expect(await getCipherById(authedFetch as any, 'c1')).toEqual({ id: 'c1' });
  });
});

describe('api/vault importCiphers', () => {
  const payload = { ciphers: [{}], folders: [{ name: 'F' }], folderRelationships: [] };

  it('rejects imports over the item limit', async () => {
    const big = { ciphers: new Array(5001).fill({}), folders: [], folderRelationships: [] };
    await expect(importCiphers(vi.fn() as any, big as any)).rejects.toThrow('Import exceeds maximum of 5000 items');
  });

  it('uses the plain endpoint and returns null without a cipher map', async () => {
    const authedFetch = vi.fn(emptyOk);
    expect(await importCiphers(authedFetch as any, payload as any)).toBeNull();
    expect(authedFetch.mock.calls[0][0]).toBe('/api/ciphers/import');
  });

  it('requests the cipher map and normalizes rows, dropping invalid ones', async () => {
    const authedFetch = vi.fn(() =>
      jsonResponse({
        cipherMap: [
          { index: 0, sourceId: 'src', id: 'id0' },
          { index: 1, id: 'id1' },
          { index: 2, id: '' }, // dropped: no id
          { index: 'nope', id: 'id3' }, // dropped: non-finite index
        ],
      })
    );
    const result = await importCiphers(authedFetch as any, payload as any, { returnCipherMap: true });
    expect(authedFetch.mock.calls[0][0]).toBe('/api/ciphers/import?returnCipherMap=1');
    expect(result).toEqual([
      { index: 0, id: 'id0', sourceId: 'src' },
      { index: 1, id: 'id1', sourceId: null },
    ]);
  });

  it('returns an empty array when the cipher map is absent', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    expect(await importCiphers(authedFetch as any, payload as any, { returnCipherMap: true })).toEqual([]);
  });

  it('surfaces the server error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'nope' }, 400));
    await expect(importCiphers(authedFetch as any, payload as any)).rejects.toThrow('nope');
  });
});

describe('api/vault getAttachmentDownloadInfo', () => {
  it('returns normalized download info', async () => {
    const authedFetch = vi.fn(() =>
      jsonResponse({ id: 'a1', url: 'https://blob/x', fileName: 'f.enc', key: 'k', size: '10', sizeName: '10 B' })
    );
    const info = await getAttachmentDownloadInfo(authedFetch as any, 'c1', 'a1');
    expect(authedFetch).toHaveBeenCalledWith('/api/ciphers/c1/attachment/a1');
    expect(info).toEqual({ id: 'a1', url: 'https://blob/x', fileName: 'f.enc', key: 'k', size: '10', sizeName: '10 B' });
  });

  it('throws when the url is missing', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'a1' }));
    await expect(getAttachmentDownloadInfo(authedFetch as any, 'c1', 'a1')).rejects.toThrow(
      'Invalid attachment download response'
    );
  });

  it('throws the parsed error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error_description: 'boom' }, 500));
    await expect(getAttachmentDownloadInfo(authedFetch as any, 'c1', 'a1')).rejects.toThrow('boom');
  });
});

describe('api/vault deleteCipherAttachment', () => {
  it('requires both ids', async () => {
    await expect(deleteCipherAttachment(vi.fn() as any, 'c1', '')).rejects.toThrow('Attachment id is required');
  });

  it('DELETEs the encoded attachment endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await deleteCipherAttachment(authedFetch as any, 'c1', 'a1');
    expect(authedFetch).toHaveBeenCalledWith('/api/ciphers/c1/attachment/a1', { method: 'DELETE' });
  });
});

describe('api/vault repairCipherAttachmentMetadata', () => {
  it('PUTs the metadata payload', async () => {
    const authedFetch = vi.fn(emptyOk);
    await repairCipherAttachmentMetadata(authedFetch as any, 'c1', 'a1', { fileName: 'x', key: null });
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/ciphers/c1/attachment/a1/metadata');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ fileName: 'x', key: null });
  });

  it('throws the parsed error on failure', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ error: 'meta failed' }, 400));
    await expect(
      repairCipherAttachmentMetadata(authedFetch as any, 'c1', 'a1', {})
    ).rejects.toThrow('meta failed');
  });
});

describe('api/vault createCipher / updateCipher', () => {
  const secureNoteDraft = {
    type: 2,
    name: 'Note',
    notes: 'secret',
    favorite: true,
    reprompt: false,
    folderId: '',
    customFields: [],
  };

  it('buildCipherImportPayload encrypts name/notes for a secure note', async () => {
    const payload = await buildCipherImportPayload(unlockedSession(), secureNoteDraft as any);
    expect(payload.type).toBe(2);
    expect(payload.favorite).toBe(true);
    expect(payload.folderId).toBeNull();
    expect(payload.name).toMatch(/^2\./);
    expect(payload.secureNote).toEqual({ type: 0 });
  });

  it('createCipher POSTs the payload and returns the created cipher', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    const result = await createCipher(authedFetch as any, unlockedSession(), secureNoteDraft as any);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/ciphers');
    expect(init.method).toBe('POST');
    expect(result).toEqual({ id: 'c1' });
  });

  it('createCipher throws when the response has no id', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    await expect(createCipher(authedFetch as any, unlockedSession(), secureNoteDraft as any)).rejects.toThrow(
      'Create item failed'
    );
  });

  it('updateCipher PUTs to the encoded id and merges extra payload + web-repair header', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    await updateCipher(
      authedFetch as any,
      unlockedSession(),
      { id: 'c 1', type: 2 } as any,
      secureNoteDraft as any,
      { lastKnownRevisionDate: 'rev' },
      { webRepair: true }
    );
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/ciphers/c%201');
    expect(init.method).toBe('PUT');
    expect(init.headers['X-NodeWarden-Web']).toBe('1');
    expect(JSON.parse(init.body).lastKnownRevisionDate).toBe('rev');
  });
});

describe('api/vault single-cipher lifecycle', () => {
  it('deleteCipher soft-deletes and returns the cipher', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1', deletedDate: 'now' }));
    const result = await deleteCipher(authedFetch as any, 'c1');
    expect(authedFetch).toHaveBeenCalledWith('/api/ciphers/c1', { method: 'DELETE' });
    expect(result).toEqual({ id: 'c1', deletedDate: 'now' });
  });

  it('permanentDeleteCipher requires an id and hits the delete endpoint', async () => {
    await expect(permanentDeleteCipher(vi.fn() as any, '')).rejects.toThrow('Cipher id is required');
    const authedFetch = vi.fn(emptyOk);
    await permanentDeleteCipher(authedFetch as any, 'c1');
    expect(authedFetch).toHaveBeenCalledWith('/api/ciphers/c1/delete', { method: 'DELETE' });
  });

  it('archiveCipher PUTs the archive endpoint', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    await archiveCipher(authedFetch as any, 'c1');
    expect(authedFetch).toHaveBeenCalledWith('/api/ciphers/c1/archive', { method: 'PUT' });
  });

  it('unarchiveCipher PUTs the unarchive endpoint', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ id: 'c1' }));
    await unarchiveCipher(authedFetch as any, 'c1');
    expect(authedFetch).toHaveBeenCalledWith('/api/ciphers/c1/unarchive', { method: 'PUT' });
  });

  it('archiveCipher throws on failure', async () => {
    await expect(archiveCipher(vi.fn(fail()) as any, 'c1')).rejects.toThrow('Archive item failed');
  });
});

describe('api/vault bulk operations', () => {
  it('bulkDeleteCiphers dedupes, trims, drops blanks and posts the ids', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkDeleteCiphers(authedFetch as any, ['a', ' a ', '', '  ', 'b']);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/ciphers/delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ids: ['a', 'b'] });
  });

  it('bulkArchiveCiphers PUTs to the archive collection', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkArchiveCiphers(authedFetch as any, ['a']);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/ciphers/archive');
    expect(init.method).toBe('PUT');
  });

  it('bulkPermanentDeleteCiphers targets the permanent endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkPermanentDeleteCiphers(authedFetch as any, ['a']);
    expect(authedFetch.mock.calls[0][0]).toBe('/api/ciphers/delete-permanent');
  });

  it('bulkRestoreCiphers targets the restore endpoint', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkRestoreCiphers(authedFetch as any, ['a']);
    expect(authedFetch.mock.calls[0][0]).toBe('/api/ciphers/restore');
  });

  it('bulkUnarchiveCiphers PUTs to the unarchive collection', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkUnarchiveCiphers(authedFetch as any, ['a']);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/ciphers/unarchive');
    expect(init.method).toBe('PUT');
  });

  it('bulkMoveCiphers includes the target folder id', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkMoveCiphers(authedFetch as any, ['a', 'b'], 'folder-1');
    expect(JSON.parse(lastInit(authedFetch).body)).toEqual({ ids: ['a', 'b'], folderId: 'folder-1' });
  });

  it('bulkDeleteFolders posts to the folder delete collection', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkDeleteFolders(authedFetch as any, ['a']);
    expect(authedFetch.mock.calls[0][0]).toBe('/api/folders/delete');
  });

  it('still issues one request with an empty id list when all ids are blank', async () => {
    const authedFetch = vi.fn(emptyOk);
    await bulkDeleteCiphers(authedFetch as any, ['', '  ']);
    expect(authedFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lastInit(authedFetch).body)).toEqual({ ids: [] });
  });

  it('throws when a bulk chunk fails', async () => {
    await expect(bulkDeleteCiphers(vi.fn(fail()) as any, ['a'])).rejects.toThrow('Bulk delete failed');
  });
});
