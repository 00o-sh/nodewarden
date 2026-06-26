import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/preact';

// Mirrors the mocking strategy of useVaultSendActions.test.ts but targets the
// success+error branches the original test skipped: import (original folder mode
// + attachment upload), the remaining export formats, send-file upload, the
// folder validation/error paths, and the offline-write guards.

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

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
  encryptFolderImportName: vi.fn(async (_session: unknown, name: string) => `enc(${name})`),
  getAttachmentDownloadInfo: vi.fn(),
  getCipherById: vi.fn(),
  importCiphers: vi.fn(),
  permanentDeleteCipher: vi.fn(),
  updateCipher: vi.fn(),
  updateFolder: vi.fn(),
  unarchiveCipher: vi.fn(),
  uploadCipherAttachment: vi.fn(),
}));

vi.mock('@/lib/api/send', () => ({
  buildSendShareKey: vi.fn(),
  bulkDeleteSends: vi.fn(),
  createSend: vi.fn(),
  deleteSend: vi.fn(),
  updateSend: vi.fn(),
}));

vi.mock('@/lib/api/auth', () => ({
  deriveLoginHash: vi.fn(async () => ({ hash: 'H' })),
  getPreloginKdfConfig: vi.fn(async () => ({ kdf: 0, iterations: 600000 })),
  verifyMasterPassword: vi.fn(async () => undefined),
}));

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
  summarizeImportResult: vi.fn((ciphers: unknown[], folderCount: number, attachmentSummary: unknown) => ({
    imported: Array.isArray(ciphers) ? ciphers.length : 0,
    folderCount,
    attachmentSummary,
  })),
}));

import useVaultSendActions from '@/hooks/useVaultSendActions';
import * as vaultApi from '@/lib/api/vault';
import * as sendApi from '@/lib/api/send';
import * as authApi from '@/lib/api/auth';
import { downloadBytesAsFile } from '@/lib/download';

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
  return {
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
  a.deriveLoginHash.mockResolvedValue({ hash: 'H' });
  a.verifyMasterPassword.mockResolvedValue(undefined);
  a.getPreloginKdfConfig.mockResolvedValue({ kdf: 0, iterations: 600000 });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

describe('useVaultSendActions extra coverage', () => {
  describe('updateVaultItem guards', () => {
    it('throws when the cipher still has unresolved encrypted data', async () => {
      // looksLikeCipherString returns true so name(enc)/decName(enc) looks unresolved.
      const support = await import('@/lib/app-support');
      (support.looksLikeCipherString as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const cipher = { id: 'c1', type: 1, name: '2.abc|def|mac', decName: '2.abc|def|mac' } as any;
      const { result } = render();
      await expect(act(async () => {
        await result.current.updateVaultItem(cipher, DRAFT);
      })).rejects.toThrow('txt_decrypt_failed_2');
      expect(v.updateCipher).not.toHaveBeenCalled();
      (support.looksLikeCipherString as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    });

    it('uploads added files on update and re-fetches the final cipher', async () => {
      v.updateCipher.mockResolvedValue({ id: 'c1', type: 1 });
      v.getCipherById.mockResolvedValue({ id: 'c1', type: 1 });
      const file = new File(['x'], 'add.txt');
      const cipher = { id: 'c1', type: 1, name: 'enc', decName: 'plain' } as any;
      const { result, options } = render();
      await act(async () => {
        await result.current.updateVaultItem(cipher, DRAFT, { addFiles: [file] });
      });
      expect(v.uploadCipherAttachment).toHaveBeenCalledWith(
        options.authedFetch, SESSION, 'c1', file, cipher, expect.any(Function),
      );
      expect(v.getCipherById).toHaveBeenCalledWith(options.authedFetch, 'c1');
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_item_updated');
    });
  });

  describe('offline write guards', () => {
    const offline = { session: { ...SESSION, accessToken: '' } };

    it('blocks bulk move when offline', async () => {
      const { result, options } = render(offline);
      await expect(act(async () => {
        await result.current.bulkMoveVaultItems(['a'], 'f1');
      })).rejects.toThrow();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_offline_vault_readonly');
      expect(v.bulkMoveCiphers).not.toHaveBeenCalled();
    });

    it('blocks delete folder when offline', async () => {
      const { result, options } = render(offline);
      await expect(act(async () => {
        await result.current.deleteFolder('f1');
      })).rejects.toThrow();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_offline_vault_readonly');
      expect(v.deleteFolder).not.toHaveBeenCalled();
    });

    it('blocks creating a send when offline', async () => {
      const { result, options } = render(offline);
      await expect(act(async () => {
        await result.current.createSend({ type: 'text', file: null } as any, false);
      })).rejects.toThrow();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_offline_vault_readonly');
      expect(s.createSend).not.toHaveBeenCalled();
    });
  });

  describe('folder validation and error branches', () => {
    it('deleteFolder rejects a blank id', async () => {
      const { result, options } = render();
      await act(async () => { await result.current.deleteFolder('   '); });
      expect(v.deleteFolder).not.toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_folder_not_found');
    });

    it('renameFolder rejects a blank id', async () => {
      const { result, options } = render();
      await act(async () => { await result.current.renameFolder('   ', 'New'); });
      expect(v.updateFolder).not.toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_folder_not_found');
    });

    it('renameFolder rejects a blank name', async () => {
      const { result, options } = render();
      await act(async () => { await result.current.renameFolder('f1', '   '); });
      expect(v.updateFolder).not.toHaveBeenCalled();
      expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_folder_name_is_required');
    });

    it('deleteFolder notifies on api error', async () => {
      v.deleteFolder.mockRejectedValue(new Error('df'));
      const { result, options } = render();
      await expect(act(async () => { await result.current.deleteFolder('f1'); })).rejects.toThrow('df');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'df');
    });

    it('renameFolder notifies on api error', async () => {
      v.updateFolder.mockRejectedValue(new Error('rf'));
      const { result, options } = render();
      await expect(act(async () => { await result.current.renameFolder('f1', 'New'); })).rejects.toThrow('rf');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'rf');
    });

    it('bulkDeleteFolders returns early when given no usable ids', async () => {
      const { result, options } = render();
      await act(async () => { await result.current.bulkDeleteFolders(['', '   ']); });
      expect(v.bulkDeleteFolders).not.toHaveBeenCalled();
      expect(options.onNotify).not.toHaveBeenCalled();
    });

    it('bulkDeleteFolders notifies on api error', async () => {
      v.bulkDeleteFolders.mockRejectedValue(new Error('bdf'));
      const { result, options } = render();
      await expect(act(async () => { await result.current.bulkDeleteFolders(['f1']); })).rejects.toThrow('bdf');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'bdf');
    });
  });

  describe('send error / file branches', () => {
    const SEND = { id: 's1', accessId: 'acc', key: 'k' } as any;

    it('uploads a send file with a progress callback and the uploading name', async () => {
      s.createSend.mockResolvedValue({ id: 's1', accessId: 'acc', key: null });
      const file = new File(['data'], 'secret.pdf');
      const { result, options } = render();
      await act(async () => {
        await result.current.createSend({ type: 'file', file } as any, false);
      });
      // A progress callback is passed only for file sends.
      expect(s.createSend).toHaveBeenCalledWith(options.authedFetch, SESSION, expect.objectContaining({ type: 'file' }), expect.any(Function));
      expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_send_created');
    });

    it('updates a send and copies the link when autoCopyLink is set', async () => {
      s.updateSend.mockResolvedValue({ id: 's1', accessId: 'acc', key: 'k' });
      s.buildSendShareKey.mockResolvedValue('keypart');
      const { result } = render();
      await act(async () => { await result.current.updateSend(SEND, { type: 'text', file: null } as any, true); });
      expect(s.buildSendShareKey).toHaveBeenCalledWith('k', SESSION.symEncKey, SESSION.symMacKey);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/#/send/abc/key');
    });

    it('notifies error and rethrows on send update failure', async () => {
      s.updateSend.mockRejectedValue(new Error('su'));
      const { result, options } = render();
      await expect(act(async () => {
        await result.current.updateSend(SEND, { type: 'text', file: null } as any, false);
      })).rejects.toThrow('su');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'su');
    });

    it('notifies error and rethrows on send delete failure', async () => {
      s.deleteSend.mockRejectedValue(new Error('sd'));
      const { result, options } = render();
      await expect(act(async () => { await result.current.deleteSend(SEND); })).rejects.toThrow('sd');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'sd');
    });

    it('notifies error and rethrows on bulk send delete failure', async () => {
      s.bulkDeleteSends.mockRejectedValue(new Error('bds'));
      const { result, options } = render();
      await expect(act(async () => { await result.current.bulkDeleteSends(['s1']); })).rejects.toThrow('bds');
      expect(options.onNotify).toHaveBeenCalledWith('error', 'bds');
    });
  });

  describe('importVault (original folder mode + attachments)', () => {
    const PAYLOAD = {
      ciphers: [
        { id: 'src1', name: 'Item A', folderId: 'leg1' },
        { id: 'src2', name: 'Item B', folder: 'Personal' },
      ],
      folders: [{ id: 'leg1', name: 'Work' }, { id: 'leg2', name: 'Personal' }],
      folderRelationships: [{ key: 0, value: 0 }],
    } as any;

    it('encrypts folders, builds payloads, and uploads matched attachments', async () => {
      v.buildCipherImportPayload.mockResolvedValue({ name: 'enc' });
      v.importCiphers.mockResolvedValue([
        { index: 0, id: 'newC1', sourceId: 'src1' },
        { index: 1, id: 'newC2', sourceId: 'src2' },
      ]);
      v.uploadCipherAttachment.mockResolvedValue(undefined);
      const refetchCiphers = vi.fn(async () => ({
        data: [{ id: 'newC1' }, { id: 'newC2' }],
      }));
      const attachments = [
        { fileName: 'a.bin', bytes: [1, 2, 3], sourceCipherId: 'src1', sourceCipherIndex: 0 },
        { fileName: 'orphan.bin', bytes: [4], sourceCipherId: 'missing', sourceCipherIndex: 99 },
      ] as any;
      const { result, options } = render({ refetchCiphers });
      let summary: any;
      await act(async () => {
        summary = await result.current.importVault(PAYLOAD, { folderMode: 'original', targetFolderId: null }, attachments);
      });
      // Folder names encrypted for the import payload.
      expect(v.encryptFolderImportName).toHaveBeenCalled();
      // returnCipherMap requested because attachments are present.
      expect(v.importCiphers).toHaveBeenCalledWith(options.importAuthedFetch, expect.any(Object), { returnCipherMap: true });
      // The matched attachment uploads; the orphan is reported as failed.
      expect(v.uploadCipherAttachment).toHaveBeenCalledTimes(1);
      expect(summary.attachmentSummary).toEqual({ total: 2, imported: 1, failed: [expect.objectContaining({ fileName: 'orphan.bin' })] });
    });

    it('reports failed uploads when uploadCipherAttachment throws', async () => {
      v.buildCipherImportPayload.mockResolvedValue({ name: 'enc' });
      v.importCiphers.mockResolvedValue([{ index: 0, id: 'newC1', sourceId: 'src1' }]);
      v.uploadCipherAttachment.mockRejectedValue(new Error('upload boom'));
      const refetchCiphers = vi.fn(async () => ({ data: [{ id: 'newC1' }] }));
      const attachments = [{ fileName: 'a.bin', bytes: [1], sourceCipherId: 'src1', sourceCipherIndex: 0 }] as any;
      const { result } = render({ refetchCiphers });
      let summary: any;
      await act(async () => {
        summary = await result.current.importVault(
          { ciphers: [{ id: 'src1', name: 'A' }], folders: [], folderRelationships: [] } as any,
          { folderMode: 'none', targetFolderId: null },
          attachments,
        );
      });
      expect(summary.attachmentSummary.imported).toBe(0);
      expect(summary.attachmentSummary.failed[0]).toEqual(expect.objectContaining({ fileName: 'a.bin', reason: 'upload boom' }));
    });

    it('throws offline when import lacks an access token', async () => {
      const { result } = render({ session: { ...SESSION, accessToken: '' } });
      await expect(act(async () => {
        await result.current.importVault(PAYLOAD, { folderMode: 'original', targetFolderId: null });
      })).rejects.toThrow('txt_offline_vault_readonly');
    });
  });

  describe('importEncryptedRaw (original folder mode)', () => {
    it('keeps the original folders/relationships under original mode', async () => {
      v.importCiphers.mockResolvedValue(null);
      const payload = {
        ciphers: [{ id: 'src1', name: 'enc', folderId: 'keepme' }],
        folders: [{ name: 'F' }],
        folderRelationships: [{ key: 0, value: 0 }],
      } as any;
      const { result, options } = render();
      await act(async () => {
        await result.current.importEncryptedRaw(payload, { folderMode: 'original', targetFolderId: null });
      });
      expect(v.importCiphers).toHaveBeenCalledWith(
        options.importAuthedFetch,
        expect.objectContaining({
          folders: [{ name: 'F' }],
          folderRelationships: [{ key: 0, value: 0 }],
          ciphers: [expect.objectContaining({ folderId: 'keepme' })],
        }),
        { returnCipherMap: false },
      );
    });
  });

  describe('exportVault remaining formats', () => {
    it('exports account-encrypted bitwarden json', async () => {
      const { result } = render();
      await act(async () => {
        await result.current.exportVault({ format: 'bitwarden_encrypted_json', masterPassword: 'pw' } as any);
      });
      expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.bitwarden_encrypted_json', 'application/json');
    });

    it('exports password-protected bitwarden encrypted json', async () => {
      const exportFormats = await import('@/lib/export-formats');
      const { result } = render();
      await act(async () => {
        await result.current.exportVault({
          format: 'bitwarden_encrypted_json',
          encryptedJsonMode: 'password',
          filePassword: 'filepw',
          masterPassword: 'pw',
        } as any);
      });
      expect(exportFormats.buildPasswordProtectedBitwardenJsonString).toHaveBeenCalled();
      expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.bitwarden_encrypted_json', 'application/json');
    });

    it('exports nodewarden plain json', async () => {
      const { result } = render();
      await act(async () => {
        await result.current.exportVault({ format: 'nodewarden_json', masterPassword: 'pw' } as any);
      });
      expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.nodewarden_json', 'application/json');
    });

    it('exports nodewarden encrypted json (account mode)', async () => {
      const exportFormats = await import('@/lib/export-formats');
      const { result } = render();
      await act(async () => {
        await result.current.exportVault({ format: 'nodewarden_encrypted_json', masterPassword: 'pw' } as any);
      });
      expect(exportFormats.attachNodeWardenEncryptedAttachmentPayload).toHaveBeenCalled();
      expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.nodewarden_encrypted_json', 'application/json');
    });

    it('exports a (possibly encrypted) zip and names it from the zip result', async () => {
      const exportFormats = await import('@/lib/export-formats');
      const { result } = render();
      await act(async () => {
        await result.current.exportVault({ format: 'bitwarden_json_zip', masterPassword: 'pw', zipPassword: 'zp' } as any);
      });
      expect(exportFormats.buildBitwardenZipBytes).toHaveBeenCalled();
      expect(exportFormats.encryptZipBytesWithPassword).toHaveBeenCalled();
      // buildExportFileName is called with the encrypted flag from the zip result.
      expect(exportFormats.buildExportFileName).toHaveBeenCalledWith('bitwarden_json_zip', true);
      expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.bitwarden_json_zip', 'application/zip');
    });

    it('throws on an unsupported export format', async () => {
      const { result } = render();
      await expect(act(async () => {
        await result.current.exportVault({ format: 'totally_unknown', masterPassword: 'pw' } as any);
      })).rejects.toThrow('txt_unsupported_export_format');
      expect(downloadBytesAsFile).not.toHaveBeenCalled();
    });

    it('throws when the profile email is unavailable', async () => {
      const { result } = render({ profile: null, session: { ...SESSION, email: '' } });
      await expect(act(async () => {
        await result.current.exportVault({ format: 'bitwarden_json', masterPassword: 'pw' } as any);
      })).rejects.toThrow('txt_profile_unavailable');
    });
  });

  describe('createVaultItem early return', () => {
    it('returns silently when there is no session', async () => {
      const { result, options } = render({ session: null });
      await act(async () => { await result.current.createVaultItem(DRAFT); });
      expect(v.createCipher).not.toHaveBeenCalled();
      expect(options.onNotify).not.toHaveBeenCalled();
    });
  });
});
