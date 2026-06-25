import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/preact';

// --- Mock i18n so t() returns the key verbatim. This keeps notification
// assertions stable and readable (we assert on the message key, not a locale). ---
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

// --- Mock the vault api module. Every export the hook imports is a vi.fn(). ---
vi.mock('@/lib/api/vault', () => ({
  archiveCipher: vi.fn(),
  buildCipherImportPayload: vi.fn(),
  bulkArchiveCiphers: vi.fn(),
  bulkDeleteCiphers: vi.fn(),
  bulkDeleteFolders: vi.fn(),
  bulkMoveCiphers: vi.fn(),
  bulkPermanentDeleteCiphers: vi.fn(),
  bulkRestoreCiphers: vi.fn(),
  bulkUnarchiveCiphers: vi.fn(),
  createCipher: vi.fn(),
  createFolder: vi.fn(),
  deleteCipher: vi.fn(),
  deleteCipherAttachment: vi.fn(),
  deleteFolder: vi.fn(),
  downloadCipherAttachmentDecrypted: vi.fn(),
  encryptFolderImportName: vi.fn(),
  getAttachmentDownloadInfo: vi.fn(),
  getCipherById: vi.fn(),
  importCiphers: vi.fn(),
  permanentDeleteCipher: vi.fn(),
  updateCipher: vi.fn(),
  updateFolder: vi.fn(),
  unarchiveCipher: vi.fn(),
  uploadCipherAttachment: vi.fn(),
}));

// --- Mock the send api module. ---
vi.mock('@/lib/api/send', () => ({
  buildSendShareKey: vi.fn(),
  bulkDeleteSends: vi.fn(),
  createSend: vi.fn(),
  deleteSend: vi.fn(),
  updateSend: vi.fn(),
}));

// --- Mock auth api (verifyMasterPassword path). ---
vi.mock('@/lib/api/auth', () => ({
  deriveLoginHash: vi.fn(),
  getPreloginKdfConfig: vi.fn(),
  verifyMasterPassword: vi.fn(),
}));

// --- Mock heavy / side-effecting deps. ---
vi.mock('@/lib/download', () => ({
  downloadBytesAsFile: vi.fn(),
}));

vi.mock('@/lib/decrypt-cipher', () => ({
  decryptSingleCipher: vi.fn(async (cipher: unknown) => ({ ...(cipher as Record<string, unknown>) })),
}));

vi.mock('@/lib/crypto', () => ({
  base64ToBytes: vi.fn(() => new Uint8Array(32)),
  decryptBw: vi.fn(),
  decryptBwFileData: vi.fn(),
  decryptStr: vi.fn(),
}));

vi.mock('@/lib/export-formats', () => ({
  attachNodeWardenEncryptedAttachmentPayload: vi.fn(async () => 'nw-enc-with-attachments'),
  buildAccountEncryptedBitwardenJsonString: vi.fn(async () => '{"encrypted":true}'),
  buildBitwardenCsvString: vi.fn(() => 'name,login\n'),
  buildBitwardenZipBytes: vi.fn(() => new Uint8Array([1, 2, 3])),
  buildExportFileName: vi.fn((format: string) => `export.${format}`),
  buildNodeWardenAttachmentRecords: vi.fn(() => []),
  buildNodeWardenPlainJsonDocument: vi.fn((doc: unknown) => doc),
  buildPasswordProtectedBitwardenJsonString: vi.fn(async () => '{"pwprotected":true}'),
  buildPlainBitwardenJsonString: vi.fn(async () => '{"items":[]}'),
  encryptZipBytesWithPassword: vi.fn(async () => ({ encrypted: true, bytes: new Uint8Array([9, 9]) })),
}));

vi.mock('@/lib/app-support', () => ({
  buildPublicSendUrl: vi.fn(() => 'https://example.com/#/send/abc/key'),
  importCipherToDraft: vi.fn(() => ({ name: 'imported', type: 1, loginUris: [], loginFido2Credentials: [], customFields: [] })),
  looksLikeCipherString: vi.fn(() => false),
  summarizeImportResult: vi.fn(() => ({ imported: 1, total: 1 })),
}));

import useVaultSendActions from '@/hooks/useVaultSendActions';
import * as vaultApi from '@/lib/api/vault';
import * as sendApi from '@/lib/api/send';
import * as authApi from '@/lib/api/auth';
import { downloadBytesAsFile } from '@/lib/download';
import { buildExportFileName } from '@/lib/export-formats';

// Typed helpers to read the mocks.
const v = vaultApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const s = sendApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const a = authApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const SESSION = {
  accessToken: 'tok',
  symEncKey: 'ZW5j',
  symMacKey: 'bWFj',
  email: 'user@example.com',
} as any;

function makeOptions(overrides: Record<string, unknown> = {}) {
  const onNotify = vi.fn();
  const opts = {
    authedFetch: vi.fn(),
    importAuthedFetch: vi.fn(),
    session: SESSION,
    profile: { email: 'user@example.com' } as any,
    defaultKdfIterations: 600000,
    encryptedCiphers: [],
    encryptedFolders: [],
    refetchCiphers: vi.fn(async () => ({ data: [] })),
    refetchFolders: vi.fn(async () => ({ data: [] })),
    refetchSends: vi.fn(async () => undefined),
    onNotify,
    patchEncryptedCiphers: vi.fn(),
    patchEncryptedFolders: vi.fn(),
    patchEncryptedSends: vi.fn(),
    patchDecryptedCiphers: vi.fn(),
    patchDecryptedFolders: vi.fn(),
    patchDecryptedSends: vi.fn(),
    refreshVaultRevisionStamp: vi.fn(async () => undefined),
    ...overrides,
  };
  return opts;
}

function render(overrides: Record<string, unknown> = {}) {
  const options = makeOptions(overrides);
  const { result } = renderHook(() => useVaultSendActions(options as any));
  return { result, options };
}

const DRAFT = {
  name: 'My Item',
  type: 1,
  notes: '',
  favorite: false,
  reprompt: false,
  folderId: null,
  loginUsername: 'u',
  loginPassword: 'p',
  loginTotp: '',
  loginUris: [],
  loginFido2Credentials: [],
  customFields: [],
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom clipboard / origin used by send autocopy.
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

describe('useVaultSendActions', () => {
  describe('refreshVault', () => {
    it('refetches everything and notifies success', async () => {
      const { result, options } = render();
      await act(async () => {
        await result.current.refreshVault();
      });
      expect(options.refetchCiphers).toHaveBeenCalled();
      expect(options.refetchFolders).toHaveBeenCalled();
      expect(options.refetchSends).toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_vault_synced');
    });
  });

  describe('createVaultItem', () => {
    it('creates a cipher and notifies success', async () => {
      v.createCipher.mockResolvedValue({ id: 'c1', type: 1 });
      const { result, options } = render();
      await act(async () => {
        await result.current.createVaultItem(DRAFT);
      });
      expect(v.createCipher).toHaveBeenCalledWith(options.authedFetch, SESSION, DRAFT);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_item_created');
      expect(options.refreshVaultRevisionStamp).toHaveBeenCalled();
    });

    it('uploads attachments then fetches the final cipher', async () => {
      v.createCipher.mockResolvedValue({ id: 'c1', type: 1 });
      v.getCipherById.mockResolvedValue({ id: 'c1', type: 1, attachments: [] });
      const file = new File(['x'], 'a.txt');
      const { result, options } = render();
      await act(async () => {
        await result.current.createVaultItem(DRAFT, [file]);
      });
      expect(v.uploadCipherAttachment).toHaveBeenCalledWith(
        options.authedFetch, SESSION, 'c1', file, undefined, expect.any(Function),
      );
      expect(v.getCipherById).toHaveBeenCalledWith(options.authedFetch, 'c1');
    });

    it('notifies error and rethrows when creation fails', async () => {
      v.createCipher.mockRejectedValue(new Error('boom'));
      const { result, options } = render();
      await expect(act(async () => {
        await result.current.createVaultItem(DRAFT);
      })).rejects.toThrow('boom');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'boom');
    });

    it('errors on offline write (no access token)', async () => {
      const { result, options } = render({ session: { ...SESSION, accessToken: '' } });
      await expect(act(async () => {
        await result.current.createVaultItem(DRAFT);
      })).rejects.toThrow();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_offline_vault_readonly');
      expect(v.createCipher).not.toHaveBeenCalled();
    });
  });

  describe('updateVaultItem', () => {
    const CIPHER = { id: 'c1', type: 1, name: 'enc', decName: 'plain' } as any;

    it('updates a cipher and notifies success', async () => {
      v.updateCipher.mockResolvedValue({ id: 'c1', type: 1 });
      const { result, options } = render();
      await act(async () => {
        await result.current.updateVaultItem(CIPHER, DRAFT);
      });
      expect(v.updateCipher).toHaveBeenCalledWith(options.authedFetch, SESSION, CIPHER, DRAFT);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_item_updated');
    });

    it('removes attachments and re-fetches when attachment ops requested', async () => {
      v.updateCipher.mockResolvedValue({ id: 'c1', type: 1 });
      v.getCipherById.mockResolvedValue({ id: 'c1', type: 1 });
      const { result, options } = render();
      await act(async () => {
        await result.current.updateVaultItem(CIPHER, DRAFT, { removeAttachmentIds: ['att1'] });
      });
      expect(v.deleteCipherAttachment).toHaveBeenCalledWith(options.authedFetch, 'c1', 'att1');
      expect(v.getCipherById).toHaveBeenCalledWith(options.authedFetch, 'c1');
    });

    it('notifies error and rethrows on failure', async () => {
      v.updateCipher.mockRejectedValue(new Error('nope'));
      const { result, options } = render();
      await expect(act(async () => {
        await result.current.updateVaultItem(CIPHER, DRAFT);
      })).rejects.toThrow('nope');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'nope');
    });
  });

  describe('downloadVaultAttachment', () => {
    const CIPHER = { id: 'c1' } as any;

    it('downloads and writes the decrypted file', async () => {
      v.downloadCipherAttachmentDecrypted.mockResolvedValue({ fileName: 'f.txt', bytes: new Uint8Array([1]) });
      const { result, options } = render();
      await act(async () => {
        await result.current.downloadVaultAttachment(CIPHER, 'att1');
      });
      expect(v.downloadCipherAttachmentDecrypted).toHaveBeenCalledWith(
        options.authedFetch, SESSION, CIPHER, 'att1', expect.any(Function),
      );
      expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.any(Uint8Array), 'f.txt', 'application/octet-stream');
    });

    it('notifies error and rethrows on failure', async () => {
      v.downloadCipherAttachmentDecrypted.mockRejectedValue(new Error('dl'));
      const { result, options } = render();
      await expect(act(async () => {
        await result.current.downloadVaultAttachment(CIPHER, 'att1');
      })).rejects.toThrow('dl');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'dl');
    });
  });

  describe('deleteVaultItem', () => {
    it('soft-deletes an active cipher', async () => {
      v.deleteCipher.mockResolvedValue({ id: 'c1', type: 1, deletedDate: 'now' });
      const { result, options } = render();
      await act(async () => {
        await result.current.deleteVaultItem({ id: 'c1', type: 1 } as any);
      });
      expect(v.deleteCipher).toHaveBeenCalledWith(options.authedFetch, 'c1');
      expect(v.permanentDeleteCipher).not.toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_item_deleted');
    });

    it('permanently deletes an already-trashed cipher', async () => {
      v.permanentDeleteCipher.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => {
        await result.current.deleteVaultItem({ id: 'c1', type: 1, deletedDate: 'yesterday' } as any);
      });
      expect(v.permanentDeleteCipher).toHaveBeenCalledWith(options.authedFetch, 'c1');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_item_deleted_permanently');
    });

    it('notifies error and rethrows on soft-delete failure', async () => {
      v.deleteCipher.mockRejectedValue(new Error('del'));
      const { result, options } = render();
      await expect(act(async () => {
        await result.current.deleteVaultItem({ id: 'c1', type: 1 } as any);
      })).rejects.toThrow('del');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'del');
    });
  });

  describe('archive / unarchive', () => {
    it('archives a cipher', async () => {
      v.archiveCipher.mockResolvedValue({ id: 'c1', type: 1, archivedDate: 'now' });
      const { result, options } = render();
      await act(async () => {
        await result.current.archiveVaultItem({ id: 'c1', type: 1 } as any);
      });
      expect(v.archiveCipher).toHaveBeenCalledWith(options.authedFetch, 'c1');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_item_archived');
    });

    it('notifies error on archive failure', async () => {
      v.archiveCipher.mockRejectedValue(new Error('arch'));
      const { result, options } = render();
      await expect(act(async () => {
        await result.current.archiveVaultItem({ id: 'c1', type: 1 } as any);
      })).rejects.toThrow('arch');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'arch');
    });

    it('unarchives a cipher', async () => {
      v.unarchiveCipher.mockResolvedValue({ id: 'c1', type: 1, archivedDate: null });
      const { result, options } = render();
      await act(async () => {
        await result.current.unarchiveVaultItem({ id: 'c1', type: 1 } as any);
      });
      expect(v.unarchiveCipher).toHaveBeenCalledWith(options.authedFetch, 'c1');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_item_unarchived');
    });
  });

  describe('bulk cipher operations', () => {
    const IDS = ['a', 'b'];

    it('bulk deletes', async () => {
      v.bulkDeleteCiphers.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.bulkDeleteVaultItems(IDS); });
      expect(v.bulkDeleteCiphers).toHaveBeenCalledWith(options.authedFetch, IDS);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_deleted_selected_items');
    });

    it('bulk archives', async () => {
      v.bulkArchiveCiphers.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.bulkArchiveVaultItems(IDS); });
      expect(v.bulkArchiveCiphers).toHaveBeenCalledWith(options.authedFetch, IDS);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_archived_selected_items');
    });

    it('bulk unarchives', async () => {
      v.bulkUnarchiveCiphers.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.bulkUnarchiveVaultItems(IDS); });
      expect(v.bulkUnarchiveCiphers).toHaveBeenCalledWith(options.authedFetch, IDS);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_unarchived_selected_items');
    });

    it('bulk moves to a folder', async () => {
      v.bulkMoveCiphers.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.bulkMoveVaultItems(IDS, 'f1'); });
      expect(v.bulkMoveCiphers).toHaveBeenCalledWith(options.authedFetch, IDS, 'f1');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_moved_selected_items');
    });

    it('bulk restores', async () => {
      v.bulkRestoreCiphers.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.bulkRestoreVaultItems(IDS); });
      expect(v.bulkRestoreCiphers).toHaveBeenCalledWith(options.authedFetch, IDS);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_restored_selected_items');
    });

    it('bulk permanent deletes', async () => {
      v.bulkPermanentDeleteCiphers.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.bulkPermanentDeleteVaultItems(IDS); });
      expect(v.bulkPermanentDeleteCiphers).toHaveBeenCalledWith(options.authedFetch, IDS);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_deleted_selected_items_permanently');
    });

    it('notifies error on bulk delete failure', async () => {
      v.bulkDeleteCiphers.mockRejectedValue(new Error('bulk'));
      const { result, options } = render();
      await expect(act(async () => { await result.current.bulkDeleteVaultItems(IDS); })).rejects.toThrow('bulk');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'bulk');
    });
  });

  describe('folder operations', () => {
    it('creates a folder', async () => {
      v.createFolder.mockResolvedValue({ id: 'f1', name: 'enc', revisionDate: 'r', creationDate: 'c' });
      const { result, options } = render();
      await act(async () => { await result.current.createFolder('Work'); });
      expect(v.createFolder).toHaveBeenCalledWith(options.authedFetch, SESSION, 'Work');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_folder_created');
    });

    it('rejects an empty folder name without calling the api', async () => {
      const { result, options } = render();
      await act(async () => { await result.current.createFolder('   '); });
      expect(v.createFolder).not.toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_folder_name_is_required');
    });

    it('deletes a folder', async () => {
      v.deleteFolder.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.deleteFolder('f1'); });
      expect(v.deleteFolder).toHaveBeenCalledWith(options.authedFetch, 'f1');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_folder_deleted');
    });

    it('renames a folder', async () => {
      v.updateFolder.mockResolvedValue({ id: 'f1', name: 'enc', revisionDate: 'r' });
      const { result, options } = render();
      await act(async () => { await result.current.renameFolder('f1', 'Renamed'); });
      expect(v.updateFolder).toHaveBeenCalledWith(options.authedFetch, SESSION, 'f1', 'Renamed');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_folder_updated');
    });

    it('bulk deletes folders', async () => {
      v.bulkDeleteFolders.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.bulkDeleteFolders(['f1', 'f2']); });
      expect(v.bulkDeleteFolders).toHaveBeenCalledWith(options.authedFetch, ['f1', 'f2']);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_folders_deleted');
    });

    it('notifies error on folder create failure', async () => {
      v.createFolder.mockRejectedValue(new Error('fc'));
      const { result, options } = render();
      await expect(act(async () => { await result.current.createFolder('Work'); })).rejects.toThrow('fc');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'fc');
    });
  });

  describe('verifyMasterPassword', () => {
    it('derives a login hash and verifies it', async () => {
      a.deriveLoginHash.mockResolvedValue({ hash: 'H' });
      a.verifyMasterPassword.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => {
        await result.current.verifyMasterPassword('user@example.com', 'pw');
      });
      expect(a.deriveLoginHash).toHaveBeenCalledWith('user@example.com', 'pw', 600000);
      expect(a.verifyMasterPassword).toHaveBeenCalledWith(options.authedFetch, 'H');
    });
  });

  describe('send operations', () => {
    const SEND = { id: 's1', accessId: 'acc', key: 'k' } as any;
    const SEND_DRAFT = { type: 'text', file: null } as any;

    it('creates a send', async () => {
      s.createSend.mockResolvedValue({ id: 's1', accessId: 'acc', key: null });
      const { result, options } = render();
      await act(async () => { await result.current.createSend(SEND_DRAFT, false); });
      expect(s.createSend).toHaveBeenCalledWith(options.authedFetch, SESSION, SEND_DRAFT, undefined);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_send_created');
    });

    it('copies the share link when autoCopyLink is set', async () => {
      s.createSend.mockResolvedValue({ id: 's1', accessId: 'acc', key: 'k' });
      s.buildSendShareKey.mockResolvedValue('keypart');
      const { result } = render();
      await act(async () => { await result.current.createSend(SEND_DRAFT, true); });
      expect(s.buildSendShareKey).toHaveBeenCalledWith('k', SESSION.symEncKey, SESSION.symMacKey);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/#/send/abc/key');
    });

    it('updates a send', async () => {
      s.updateSend.mockResolvedValue({ id: 's1', accessId: 'acc', key: null });
      const { result, options } = render();
      await act(async () => { await result.current.updateSend(SEND, SEND_DRAFT, false); });
      expect(s.updateSend).toHaveBeenCalledWith(options.authedFetch, SESSION, SEND, SEND_DRAFT);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_send_updated');
    });

    it('deletes a send', async () => {
      s.deleteSend.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.deleteSend(SEND); });
      expect(s.deleteSend).toHaveBeenCalledWith(options.authedFetch, 's1');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_send_deleted');
    });

    it('bulk deletes sends', async () => {
      s.bulkDeleteSends.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => { await result.current.bulkDeleteSends(['s1', 's2']); });
      expect(s.bulkDeleteSends).toHaveBeenCalledWith(options.authedFetch, ['s1', 's2']);
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_deleted_selected_sends');
    });

    it('notifies error and rethrows on send create failure', async () => {
      s.createSend.mockRejectedValue(new Error('sc'));
      const { result, options } = render();
      await expect(act(async () => { await result.current.createSend(SEND_DRAFT, false); })).rejects.toThrow('sc');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'sc');
    });
  });

  describe('importVault', () => {
    const PAYLOAD = {
      ciphers: [{ id: 'src1', name: 'Item' }],
      folders: [],
      folderRelationships: [],
    } as any;

    it('builds payloads, imports, and refetches', async () => {
      v.buildCipherImportPayload.mockResolvedValue({ name: 'enc' });
      v.importCiphers.mockResolvedValue(null);
      const { result, options } = render();
      let summary: any;
      await act(async () => {
        summary = await result.current.importVault(PAYLOAD, { folderMode: 'none', targetFolderId: null });
      });
      expect(v.buildCipherImportPayload).toHaveBeenCalled();
      expect(v.importCiphers).toHaveBeenCalledWith(options.importAuthedFetch, expect.objectContaining({ ciphers: [expect.objectContaining({ id: 'src1' })] }), { returnCipherMap: false });
      expect(options.refetchCiphers).toHaveBeenCalled();
      expect(options.refetchFolders).toHaveBeenCalled();
      expect(summary).toEqual({ imported: 1, total: 1 });
    });

    it('throws when the vault key is unavailable', async () => {
      const { result } = render({ session: { ...SESSION, symEncKey: null } });
      await expect(act(async () => {
        await result.current.importVault(PAYLOAD, { folderMode: 'none', targetFolderId: null });
      })).rejects.toThrow('txt_vault_key_unavailable');
    });
  });

  describe('importEncryptedRaw', () => {
    const PAYLOAD = {
      ciphers: [{ id: 'src1', name: 'enc' }],
      folders: [],
      folderRelationships: [],
    } as any;

    it('imports raw ciphers with folderMode none (clears folderId)', async () => {
      v.importCiphers.mockResolvedValue(null);
      const { result, options } = render();
      await act(async () => {
        await result.current.importEncryptedRaw(PAYLOAD, { folderMode: 'none', targetFolderId: null });
      });
      expect(v.importCiphers).toHaveBeenCalledWith(
        options.importAuthedFetch,
        expect.objectContaining({ ciphers: [expect.objectContaining({ folderId: null })] }),
        { returnCipherMap: false },
      );
      expect(options.refetchCiphers).toHaveBeenCalled();
    });

    it('targets a folder with folderMode target', async () => {
      v.importCiphers.mockResolvedValue(null);
      const { result } = render();
      await act(async () => {
        await result.current.importEncryptedRaw(PAYLOAD, { folderMode: 'target', targetFolderId: 'f9' });
      });
      expect(v.importCiphers).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ciphers: [expect.objectContaining({ folderId: 'f9' })] }),
        { returnCipherMap: false },
      );
    });
  });

  describe('exportVault', () => {
    it('verifies the master password then downloads bitwarden_json', async () => {
      a.deriveLoginHash.mockResolvedValue({ hash: 'H' });
      a.verifyMasterPassword.mockResolvedValue(undefined);
      const { result, options } = render();
      await act(async () => {
        await result.current.exportVault({ format: 'bitwarden_json', masterPassword: 'pw' } as any);
      });
      expect(a.verifyMasterPassword).toHaveBeenCalledWith(options.authedFetch, 'H');
      expect(buildExportFileName).toHaveBeenCalledWith('bitwarden_json');
      expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.bitwarden_json', 'application/json');
    });

    it('exports bitwarden_csv', async () => {
      a.deriveLoginHash.mockResolvedValue({ hash: 'H' });
      const { result } = render();
      await act(async () => {
        await result.current.exportVault({ format: 'bitwarden_csv', masterPassword: 'pw' } as any);
      });
      expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.bitwarden_csv', 'text/csv;charset=utf-8');
    });

    it('throws when master password is missing', async () => {
      const { result } = render();
      await expect(act(async () => {
        await result.current.exportVault({ format: 'bitwarden_json', masterPassword: '' } as any);
      })).rejects.toThrow('txt_master_password_is_required');
      expect(downloadBytesAsFile).not.toHaveBeenCalled();
    });

    it('throws when the vault key is unavailable', async () => {
      const { result } = render({ session: { ...SESSION, symMacKey: null } });
      await expect(act(async () => {
        await result.current.exportVault({ format: 'bitwarden_json', masterPassword: 'pw' } as any);
      })).rejects.toThrow('txt_vault_key_unavailable');
    });
  });

  describe('exposed progress state', () => {
    it('exposes default progress fields', () => {
      const { result } = render();
      expect(result.current.downloadingAttachmentKey).toBe('');
      expect(result.current.attachmentDownloadPercent).toBeNull();
      expect(result.current.uploadingAttachmentName).toBe('');
      expect(result.current.uploadingSendFileName).toBe('');
    });
  });
});
