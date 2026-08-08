import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/preact';

// Third test file for useVaultSendActions. The two sibling files
// (useVaultSendActions.test.ts and .extra.test.ts) use inert vi.fn() patchers,
// so the optimistic-cache updater callbacks and many error/offline branches are
// never exercised. Here we drive the hook with STATEFUL patch mocks (each patch
// mock actually applies its updater to a tracked array) and seed representative
// caches so the internal patchCipherBatch / patchFolderBatch / decryptAndPatch /
// upsert / removeSend branches run, then assert the resulting cache mutations.
// We also cover the export zip-attachment pipeline (real ciphers with
// attachments) and the remaining error/offline guards.

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
  decryptSingleCipher: vi.fn(async (cipher: unknown) => ({ ...(cipher as Record<string, unknown>), _dec: true })),
}));

vi.mock('@/lib/crypto', () => ({
  base64ToBytes: vi.fn(() => new Uint8Array(32)),
  decryptBw: vi.fn(async () => new Uint8Array(64)),
  decryptBwFileData: vi.fn(async () => new Uint8Array([7, 8, 9])),
  decryptStr: vi.fn(async () => 'decrypted-name.txt'),
}));

vi.mock('@/lib/export-formats', () => ({
  attachNodeWardenEncryptedAttachmentPayload: vi.fn(async () => 'nw-enc-with-attachments'),
  buildAccountEncryptedBitwardenJsonString: vi.fn(async () => '{"encrypted":true}'),
  buildBitwardenCsvString: vi.fn(() => 'name,login\n'),
  buildBitwardenZipBytes: vi.fn(() => new Uint8Array([1, 2, 3])),
  buildExportFileName: vi.fn((format: string) => `export.${format}`),
  buildNodeWardenAttachmentRecords: vi.fn(() => [{ record: true }]),
  buildNodeWardenPlainJsonDocument: vi.fn((doc: unknown) => doc),
  buildPasswordProtectedBitwardenJsonString: vi.fn(async () => '{"pwprotected":true}'),
  buildPlainBitwardenJsonString: vi.fn(async () => '{"items":[{"id":"c1"}]}'),
  encryptZipBytesWithPassword: vi.fn(async () => ({ encrypted: true, bytes: new Uint8Array([9, 9]) })),
}));

// looksLikeCipherString is toggled per-test to steer the export decrypt branches.
const looksLikeCipherStringMock = vi.fn(() => false);
vi.mock('@/lib/app-support', () => ({
  buildPublicSendUrl: vi.fn(() => 'https://example.com/#/send/abc/key'),
  importCipherToDraft: vi.fn(() => ({ name: 'imported', type: 1, loginUris: [], loginFido2Credentials: [], customFields: [] })),
  looksLikeCipherString: (v: unknown) => looksLikeCipherStringMock(v),
  summarizeImportResult: vi.fn((ciphers: unknown[], folderCount: number, attachmentSummary: unknown) => ({
    imported: Array.isArray(ciphers) ? ciphers.length : 0,
    folderCount,
    attachmentSummary,
  })),
}));

import useVaultSendActions from '@/hooks/useVaultSendActions';
import * as vaultApi from '@/lib/api/vault';
import * as sendApi from '@/lib/api/send';
import { downloadBytesAsFile } from '@/lib/download';

const v = vaultApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const s = sendApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const SESSION = {
  accessToken: 'tok',
  symEncKey: 'ZW5j',
  symMacKey: 'bWFj',
  email: 'user@example.com',
} as any;

// Build options whose patch* fns are stateful: they apply their updater to a
// tracked array, so we can both exercise the callback lines and assert results.
function makeStatefulOptions(overrides: Record<string, unknown> = {}) {
  const store = {
    encCiphers: (overrides.initialEncCiphers as any[]) ?? [],
    decCiphers: (overrides.initialDecCiphers as any[]) ?? [],
    encFolders: (overrides.initialEncFolders as any[]) ?? [],
    decFolders: (overrides.initialDecFolders as any[]) ?? [],
    encSends: (overrides.initialEncSends as any[]) ?? [],
    decSends: (overrides.initialDecSends as any[]) ?? [],
  };
  const onNotify = vi.fn();
  const opts: Record<string, unknown> = {
    authedFetch: vi.fn(),
    importAuthedFetch: vi.fn(),
    session: SESSION,
    profile: { email: 'user@example.com' } as any,
    defaultKdfIterations: 600000,
    encryptedCiphers: (overrides.encryptedCiphers as any[]) ?? [],
    encryptedFolders: (overrides.encryptedFolders as any[]) ?? [],
    refetchCiphers: vi.fn(async () => ({ data: (overrides.refetchCiphersData as any[]) ?? [] })),
    refetchFolders: vi.fn(async () => ({ data: [] })),
    refetchSends: vi.fn(async () => undefined),
    onNotify,
    patchEncryptedCiphers: vi.fn((u: (prev: any[]) => any[]) => { store.encCiphers = u(store.encCiphers); }),
    patchEncryptedFolders: vi.fn((u: (prev: any[]) => any[]) => { store.encFolders = u(store.encFolders); }),
    patchEncryptedSends: vi.fn((u: (prev: any[]) => any[]) => { store.encSends = u(store.encSends); }),
    patchDecryptedCiphers: vi.fn((u: (prev: any[]) => any[]) => { store.decCiphers = u(store.decCiphers); }),
    patchDecryptedFolders: vi.fn((u: (prev: any[]) => any[]) => { store.decFolders = u(store.decFolders); }),
    patchDecryptedSends: vi.fn((u: (prev: any[]) => any[]) => { store.decSends = u(store.decSends); }),
    refreshVaultRevisionStamp: vi.fn(async () => undefined),
  };
  // allow direct option overrides (e.g. session)
  for (const [k, val] of Object.entries(overrides)) {
    if (k.startsWith('initial') || k === 'encryptedCiphers' || k === 'encryptedFolders' || k === 'refetchCiphersData') continue;
    opts[k] = val;
  }
  return { opts, store };
}

function render(overrides: Record<string, unknown> = {}) {
  const { opts, store } = makeStatefulOptions(overrides);
  const { result } = renderHook(() => useVaultSendActions(opts as any));
  return { result, options: opts, store };
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

const RESOLVED_CIPHER = { id: 'c1', type: 1, name: 'enc', decName: 'plain' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  looksLikeCipherStringMock.mockReturnValue(false);
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

describe('useVaultSendActions - stateful cache patching', () => {
  it('createVaultItem replaces the optimistic entry with the decrypted cipher', async () => {
    v.createCipher.mockResolvedValue({ id: 'c1', type: 1 });
    const { result, store } = render({ initialDecCiphers: [{ id: 'existing', type: 1 }] });
    await act(async () => { await result.current.createVaultItem(DRAFT); });
    // Encrypted cache received the server cipher; decrypted cache has the
    // decrypted copy and the pre-existing item, but no optimistic:* placeholder.
    expect(store.encCiphers.some((c) => c.id === 'c1')).toBe(true);
    expect(store.decCiphers.some((c) => c.id === 'c1' && c._dec)).toBe(true);
    expect(store.decCiphers.some((c) => String(c.id).startsWith('optimistic:'))).toBe(false);
    expect(store.decCiphers.some((c) => c.id === 'existing')).toBe(true);
  });

  it('createVaultItem rolls back the optimistic entry when the API fails', async () => {
    v.createCipher.mockRejectedValue(new Error('boom'));
    const { result, store, options } = render();
    await expect(act(async () => { await result.current.createVaultItem(DRAFT); })).rejects.toThrow('boom');
    // Optimistic entry was added then removed on failure.
    expect(store.decCiphers).toEqual([]);
    expect(options.onNotify).toHaveBeenCalledWith('error', 'boom');
  });

  it('updateVaultItem patches the decrypted cache in place and leaves siblings alone', async () => {
    v.updateCipher.mockResolvedValue({ id: 'c1', type: 1, name: 'enc2' });
    const { result, store } = render({
      initialDecCiphers: [{ id: 'c1', type: 1, decName: 'old' }, { id: 'other', type: 1 }],
    });
    await act(async () => { await result.current.updateVaultItem(RESOLVED_CIPHER, DRAFT); });
    // c1 replaced by the decrypted server cipher, other untouched.
    expect(store.decCiphers.find((c) => c.id === 'c1')?._dec).toBe(true);
    expect(store.decCiphers.find((c) => c.id === 'other')).toBeTruthy();
  });

  it('updateVaultItem rolls the decrypted cache back to the previous cipher on failure', async () => {
    v.updateCipher.mockRejectedValue(new Error('nope'));
    const prev = { id: 'c1', type: 1, name: 'enc', decName: 'plain' } as any;
    const { result, store } = render({ initialDecCiphers: [prev] });
    await expect(act(async () => { await result.current.updateVaultItem(prev, DRAFT); })).rejects.toThrow('nope');
    // The optimistic patch was reverted back to the original cipher.
    expect(store.decCiphers.find((c) => c.id === 'c1')?.decName).toBe('plain');
  });

  it('updateVaultItem without a vault key refetches instead of decrypting locally', async () => {
    v.updateCipher.mockResolvedValue({ id: 'c1', type: 1 });
    const session = { ...SESSION, symEncKey: null };
    const { result, options } = render({ session, initialDecCiphers: [RESOLVED_CIPHER] });
    await act(async () => { await result.current.updateVaultItem(RESOLVED_CIPHER, DRAFT); });
    // decryptAndPatch takes the no-key branch → refetchCiphers.
    expect(options.refetchCiphers).toHaveBeenCalled();
    expect(options.onNotify).toHaveBeenCalledWith('success', 'txt_item_updated');
  });

  it('deleteVaultItem soft-delete stamps deletedDate then patches the decrypted server copy', async () => {
    v.deleteCipher.mockResolvedValue({ id: 'c1', type: 1, deletedDate: 'server-now' });
    const { result, store } = render({ initialDecCiphers: [{ id: 'c1', type: 1 }, { id: 'keep' }] });
    await act(async () => { await result.current.deleteVaultItem({ id: 'c1', type: 1 } as any); });
    expect(store.decCiphers.find((c) => c.id === 'c1')?._dec).toBe(true);
    expect(store.decCiphers.find((c) => c.id === 'keep')).toBeTruthy();
  });

  it('deleteVaultItem permanent-delete removes the cipher from both caches', async () => {
    v.permanentDeleteCipher.mockResolvedValue(undefined);
    const { result, store } = render({
      initialEncCiphers: [{ id: 'c1' }, { id: 'other' }],
      initialDecCiphers: [{ id: 'c1' }, { id: 'other' }],
    });
    await act(async () => { await result.current.deleteVaultItem({ id: 'c1', type: 1, deletedDate: 'x' } as any); });
    expect(store.encCiphers.some((c) => c.id === 'c1')).toBe(false);
    expect(store.decCiphers.some((c) => c.id === 'c1')).toBe(false);
    expect(store.decCiphers.some((c) => c.id === 'other')).toBe(true);
  });

  it('deleteVaultItem permanent-delete notifies and rethrows on failure', async () => {
    v.permanentDeleteCipher.mockRejectedValue(new Error('pdel'));
    const { result, options } = render();
    await expect(act(async () => {
      await result.current.deleteVaultItem({ id: 'c1', type: 1, deletedDate: 'x' } as any);
    })).rejects.toThrow('pdel');
    expect(options.onNotify).toHaveBeenCalledWith('error', 'pdel');
  });

  it('unarchiveVaultItem notifies and rethrows on failure', async () => {
    v.unarchiveCipher.mockRejectedValue(new Error('unarch'));
    const { result, options } = render({ initialDecCiphers: [{ id: 'c1', type: 1, archivedDate: 'x' }] });
    await expect(act(async () => {
      await result.current.unarchiveVaultItem({ id: 'c1', type: 1, archivedDate: 'x' } as any);
    })).rejects.toThrow('unarch');
    expect(options.onNotify).toHaveBeenCalledWith('error', 'unarch');
  });

  it('bulk operations patch every matching cipher and skip the rest', async () => {
    v.bulkArchiveCiphers.mockResolvedValue(undefined);
    const { result, store } = render({
      initialEncCiphers: [{ id: 'a' }, { id: 'skip' }],
      initialDecCiphers: [{ id: 'a' }, { id: 'skip' }],
    });
    await act(async () => { await result.current.bulkArchiveVaultItems(['a']); });
    expect(store.decCiphers.find((c) => c.id === 'a')?.archivedDate).toBeTruthy();
    expect(store.decCiphers.find((c) => c.id === 'skip')?.archivedDate).toBeUndefined();
  });

  it('bulkMove reassigns the folder on matched ciphers', async () => {
    v.bulkMoveCiphers.mockResolvedValue(undefined);
    const { result, store } = render({ initialDecCiphers: [{ id: 'a', folderId: 'old' }] });
    await act(async () => { await result.current.bulkMoveVaultItems(['a'], 'f9'); });
    expect(store.decCiphers.find((c) => c.id === 'a')?.folderId).toBe('f9');
  });

  it('bulkRestore clears deletedDate; bulkPermanentDelete drops the ciphers', async () => {
    v.bulkRestoreCiphers.mockResolvedValue(undefined);
    v.bulkPermanentDeleteCiphers.mockResolvedValue(undefined);
    const { result, store } = render({ initialDecCiphers: [{ id: 'a', deletedDate: 'x' }, { id: 'b', deletedDate: 'y' }] });
    await act(async () => { await result.current.bulkRestoreVaultItems(['a']); });
    expect(store.decCiphers.find((c) => c.id === 'a')?.deletedDate).toBeNull();
    await act(async () => { await result.current.bulkPermanentDeleteVaultItems(['b']); });
    expect(store.decCiphers.some((c) => c.id === 'b')).toBe(false);
  });

  it.each([
    ['bulkArchiveVaultItems', 'bulkArchiveCiphers'],
    ['bulkUnarchiveVaultItems', 'bulkUnarchiveCiphers'],
    ['bulkMoveVaultItems', 'bulkMoveCiphers'],
    ['bulkRestoreVaultItems', 'bulkRestoreCiphers'],
    ['bulkPermanentDeleteVaultItems', 'bulkPermanentDeleteCiphers'],
  ])('%s notifies and rethrows when the API fails', async (action, apiName) => {
    v[apiName].mockRejectedValue(new Error('bulk-fail'));
    const { result, options } = render();
    await expect(act(async () => {
      if (action === 'bulkMoveVaultItems') await (result.current as any)[action](['a'], 'f1');
      else await (result.current as any)[action](['a']);
    })).rejects.toThrow('bulk-fail');
    expect(options.onNotify).toHaveBeenCalledWith('error', 'bulk-fail');
  });
});

describe('useVaultSendActions - folder cache patching', () => {
  it('createFolder upserts the encrypted folder and prepends the decrypted one', async () => {
    v.createFolder.mockResolvedValue({ id: 'f1', name: 'enc', revisionDate: 'r', creationDate: 'c' });
    const { result, store } = render({ initialEncFolders: [{ id: 'f0' }], initialDecFolders: [{ id: 'f0' }] });
    await act(async () => { await result.current.createFolder('Work'); });
    expect(store.encFolders.some((f) => f.id === 'f1')).toBe(true);
    expect(store.decFolders[0]).toMatchObject({ id: 'f1', decName: 'Work' });
  });

  it('deleteFolder removes the folder and detaches ciphers from it', async () => {
    v.deleteFolder.mockResolvedValue(undefined);
    const { result, store } = render({
      initialEncFolders: [{ id: 'f1' }],
      initialDecFolders: [{ id: 'f1' }],
      initialEncCiphers: [{ id: 'c1', folderId: 'f1' }, { id: 'c2', folderId: 'other' }],
      initialDecCiphers: [{ id: 'c1', folderId: 'f1' }],
    });
    await act(async () => { await result.current.deleteFolder('f1'); });
    expect(store.encFolders.some((f) => f.id === 'f1')).toBe(false);
    expect(store.encCiphers.find((c) => c.id === 'c1')?.folderId).toBeNull();
    expect(store.encCiphers.find((c) => c.id === 'c2')?.folderId).toBe('other');
    expect(store.decCiphers.find((c) => c.id === 'c1')?.folderId).toBeNull();
  });

  it('renameFolder updates the matching decrypted folder only', async () => {
    v.updateFolder.mockResolvedValue({ id: 'f1', name: 'enc', revisionDate: 'r2' });
    const { result, store } = render({
      initialEncFolders: [{ id: 'f1' }],
      initialDecFolders: [{ id: 'f1', name: 'old', decName: 'old' }, { id: 'f2', decName: 'keep' }],
    });
    await act(async () => { await result.current.renameFolder('f1', 'Renamed'); });
    expect(store.decFolders.find((f) => f.id === 'f1')).toMatchObject({ decName: 'Renamed', revisionDate: 'r2' });
    expect(store.decFolders.find((f) => f.id === 'f2')?.decName).toBe('keep');
  });

  it('bulkDeleteFolders removes folders and detaches their ciphers', async () => {
    v.bulkDeleteFolders.mockResolvedValue(undefined);
    const { result, store } = render({
      initialEncFolders: [{ id: 'f1' }, { id: 'f2' }],
      initialDecFolders: [{ id: 'f1' }, { id: 'f2' }],
      initialEncCiphers: [{ id: 'c1', folderId: 'f1' }],
      initialDecCiphers: [{ id: 'c1', folderId: 'f1' }],
    });
    await act(async () => { await result.current.bulkDeleteFolders(['f1', 'f2']); });
    expect(store.encFolders).toEqual([]);
    expect(store.encCiphers.find((c) => c.id === 'c1')?.folderId).toBeNull();
    expect(store.decCiphers.find((c) => c.id === 'c1')?.folderId).toBeNull();
  });
});

describe('useVaultSendActions - send cache patching', () => {
  const SEND = { id: 's1', accessId: 'acc', key: 'k' } as any;

  it('createSend upserts a new send into the encrypted cache', async () => {
    s.createSend.mockResolvedValue({ id: 's1', accessId: 'acc', key: null });
    const { result, store } = render({ initialEncSends: [{ id: 's0' }] });
    await act(async () => { await result.current.createSend({ type: 'text', file: null } as any, false); });
    expect(store.encSends.some((x) => x.id === 's1')).toBe(true);
    expect(store.encSends.some((x) => x.id === 's0')).toBe(true);
  });

  it('updateSend replaces an existing send in the encrypted cache', async () => {
    s.updateSend.mockResolvedValue({ id: 's1', accessId: 'acc', key: null, name: 'updated' });
    const { result, store } = render({ initialEncSends: [{ id: 's1', name: 'old' }] });
    await act(async () => { await result.current.updateSend(SEND, { type: 'text', file: null } as any, false); });
    expect(store.encSends.find((x) => x.id === 's1')?.name).toBe('updated');
    expect(store.encSends).toHaveLength(1);
  });

  it('deleteSend removes it from both send caches', async () => {
    s.deleteSend.mockResolvedValue(undefined);
    const { result, store } = render({
      initialEncSends: [{ id: 's1' }, { id: 's2' }],
      initialDecSends: [{ id: 's1' }, { id: 's2' }],
    });
    await act(async () => { await result.current.deleteSend(SEND); });
    expect(store.encSends.some((x) => x.id === 's1')).toBe(false);
    expect(store.decSends.some((x) => x.id === 's1')).toBe(false);
    expect(store.encSends.some((x) => x.id === 's2')).toBe(true);
  });

  it('bulkDeleteSends filters the selected ids out of both caches', async () => {
    s.bulkDeleteSends.mockResolvedValue(undefined);
    const { result, store } = render({
      initialEncSends: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
      initialDecSends: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
    });
    await act(async () => { await result.current.bulkDeleteSends(['s1', 's3']); });
    expect(store.encSends.map((x) => x.id)).toEqual(['s2']);
    expect(store.decSends.map((x) => x.id)).toEqual(['s2']);
  });

  it('createSend and updateSend return early when there is no session', async () => {
    const { result, options } = render({ session: null });
    await act(async () => {
      await result.current.createSend({ type: 'text', file: null } as any, false);
      await result.current.updateSend(SEND, { type: 'text', file: null } as any, false);
    });
    expect(s.createSend).not.toHaveBeenCalled();
    expect(s.updateSend).not.toHaveBeenCalled();
    expect(options.onNotify).not.toHaveBeenCalled();
  });
});

describe('useVaultSendActions - offline write guards', () => {
  const offline = { session: { ...SESSION, accessToken: '' } };

  it.each([
    ['deleteVaultItem', (a: any) => a.deleteVaultItem({ id: 'c1', type: 1 })],
    ['archiveVaultItem', (a: any) => a.archiveVaultItem({ id: 'c1', type: 1 })],
    ['unarchiveVaultItem', (a: any) => a.unarchiveVaultItem({ id: 'c1', type: 1 })],
    ['bulkDeleteVaultItems', (a: any) => a.bulkDeleteVaultItems(['c1'])],
    ['bulkArchiveVaultItems', (a: any) => a.bulkArchiveVaultItems(['c1'])],
    ['bulkUnarchiveVaultItems', (a: any) => a.bulkUnarchiveVaultItems(['c1'])],
    ['bulkRestoreVaultItems', (a: any) => a.bulkRestoreVaultItems(['c1'])],
    ['bulkPermanentDeleteVaultItems', (a: any) => a.bulkPermanentDeleteVaultItems(['c1'])],
    ['createFolder', (a: any) => a.createFolder('Work')],
    ['renameFolder', (a: any) => a.renameFolder('f1', 'New')],
    ['bulkDeleteFolders', (a: any) => a.bulkDeleteFolders(['f1'])],
    ['deleteSend', (a: any) => a.deleteSend({ id: 's1' })],
    ['bulkDeleteSends', (a: any) => a.bulkDeleteSends(['s1'])],
  ])('%s rejects with the offline error when there is no access token', async (_name, run) => {
    const { result, options } = render(offline);
    await expect(act(async () => { await run(result.current); })).rejects.toThrow();
    expect(options.onNotify).toHaveBeenCalledWith('error', 'txt_offline_vault_readonly');
  });

  it('downloadVaultAttachment returns early with no session', async () => {
    const { result, options } = render({ session: null });
    await act(async () => { await result.current.downloadVaultAttachment({ id: 'c1' } as any, 'att1'); });
    expect(v.downloadCipherAttachmentDecrypted).not.toHaveBeenCalled();
    expect(options.onNotify).not.toHaveBeenCalled();
  });
});

describe('useVaultSendActions - importVault original-mode folder mapping', () => {
  it('encrypts named folders, skips blank ones, and maps ciphers by legacy folderId', async () => {
    v.buildCipherImportPayload.mockResolvedValue({ name: 'enc' });
    v.importCiphers.mockResolvedValue(null);
    const payload = {
      // one blank-named folder (skipped) and one real folder with a legacy id.
      folders: [{ id: '', name: '   ' }, { id: 'leg1', name: 'Work' }],
      ciphers: [{ id: 'src1', name: 'Item', folderId: 'leg1' }],
      folderRelationships: [],
    } as any;
    const { result, options } = render();
    let summary: any;
    await act(async () => {
      summary = await result.current.importVault(payload, { folderMode: 'original', targetFolderId: null });
    });
    // Only the non-blank folder was encrypted for the import payload.
    expect(v.encryptFolderImportName).toHaveBeenCalledTimes(1);
    expect(v.importCiphers).toHaveBeenCalledWith(
      options.importAuthedFetch,
      expect.objectContaining({
        folders: [{ name: 'enc(Work)' }],
        folderRelationships: [{ key: 0, value: 0 }],
      }),
      { returnCipherMap: false },
    );
    expect(summary.folderCount).toBe(1);
  });

  it('importEncryptedRaw with attachments but no vault key throws vault_key_unavailable', async () => {
    v.importCiphers.mockResolvedValue([{ index: 0, id: 'n1', sourceId: 'src1' }]);
    const attachments = [{ fileName: 'a.bin', bytes: [1], sourceCipherId: 'src1', sourceCipherIndex: 0 }] as any;
    const { result } = render({ session: { ...SESSION, symEncKey: null } });
    await expect(act(async () => {
      await result.current.importEncryptedRaw(
        { ciphers: [{ id: 'src1' }], folders: [], folderRelationships: [] } as any,
        { folderMode: 'none', targetFolderId: null },
        attachments,
      );
    })).rejects.toThrow('txt_vault_key_unavailable');
  });
});

describe('useVaultSendActions - export zip attachment pipeline', () => {
  // A cipher that carries an attachment, with encrypted item/attachment keys and
  // an encrypted file name so every decrypt branch in zipAttachments runs.
  const cipherWithAttachment = {
    id: 'c1',
    key: '2.itemkey|iv|mac',
    deletedDate: null,
    attachments: [{ id: 'a1', key: '2.attkey|iv|mac', fileName: '2.encname|iv|mac' }],
  } as any;

  function stubFetchOk() {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })));
  }

  it('nodewarden_json downloads, decrypts item/attachment keys and the file name', async () => {
    looksLikeCipherStringMock.mockReturnValue(true); // treat every key/name as encrypted
    stubFetchOk();
    v.getAttachmentDownloadInfo.mockResolvedValue({ url: 'https://blob/a1', key: '2.attkey', fileName: '2.encname' });
    const { result } = render({ encryptedCiphers: [cipherWithAttachment], encryptedFolders: [] });
    await act(async () => {
      await result.current.exportVault({ format: 'nodewarden_json', masterPassword: 'pw' } as any);
    });
    expect(v.getAttachmentDownloadInfo).toHaveBeenCalledWith(expect.anything(), 'c1', 'a1');
    expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.nodewarden_json', 'application/json');
    vi.unstubAllGlobals();
  });

  it('bitwarden_json_zip zips the decrypted attachments', async () => {
    looksLikeCipherStringMock.mockReturnValue(true);
    stubFetchOk();
    v.getAttachmentDownloadInfo.mockResolvedValue({ url: 'https://blob/a1', key: '2.attkey', fileName: '2.encname' });
    const exportFormats = await import('@/lib/export-formats');
    const { result } = render({ encryptedCiphers: [cipherWithAttachment], encryptedFolders: [] });
    await act(async () => {
      await result.current.exportVault({ format: 'bitwarden_json_zip', masterPassword: 'pw', zipPassword: 'zp' } as any);
    });
    expect(exportFormats.buildBitwardenZipBytes).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ cipherId: 'c1' })]),
    );
    expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.bitwarden_json_zip', 'application/zip');
    vi.unstubAllGlobals();
  });

  it('bitwarden_encrypted_json_zip (account mode) encrypts the json before zipping', async () => {
    stubFetchOk();
    const exportFormats = await import('@/lib/export-formats');
    const { result } = render({ encryptedCiphers: [], encryptedFolders: [] });
    await act(async () => {
      await result.current.exportVault({ format: 'bitwarden_encrypted_json_zip', masterPassword: 'pw', zipPassword: 'zp' } as any);
    });
    expect(exportFormats.buildAccountEncryptedBitwardenJsonString).toHaveBeenCalled();
    expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.bitwarden_encrypted_json_zip', 'application/zip');
    vi.unstubAllGlobals();
  });

  it('bitwarden_encrypted_json_zip (password mode) password-protects the json before zipping', async () => {
    stubFetchOk();
    const exportFormats = await import('@/lib/export-formats');
    const { result } = render({ encryptedCiphers: [], encryptedFolders: [] });
    await act(async () => {
      await result.current.exportVault({
        format: 'bitwarden_encrypted_json_zip',
        encryptedJsonMode: 'password',
        filePassword: 'fp',
        masterPassword: 'pw',
        zipPassword: 'zp',
      } as any);
    });
    expect(exportFormats.buildPasswordProtectedBitwardenJsonString).toHaveBeenCalled();
    expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.bitwarden_encrypted_json_zip', 'application/zip');
    vi.unstubAllGlobals();
  });

  it('nodewarden_encrypted_json (password mode) password-protects the nodewarden document', async () => {
    const exportFormats = await import('@/lib/export-formats');
    const { result } = render({ encryptedCiphers: [], encryptedFolders: [] });
    await act(async () => {
      await result.current.exportVault({
        format: 'nodewarden_encrypted_json',
        encryptedJsonMode: 'password',
        filePassword: 'fp',
        masterPassword: 'pw',
      } as any);
    });
    expect(exportFormats.buildPasswordProtectedBitwardenJsonString).toHaveBeenCalled();
    expect(downloadBytesAsFile).toHaveBeenCalledWith(expect.anything(), 'export.nodewarden_encrypted_json', 'application/json');
  });

  it('zipAttachments throws when the attachment blob download fails', async () => {
    looksLikeCipherStringMock.mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })));
    v.getAttachmentDownloadInfo.mockResolvedValue({ url: 'https://blob/a1', key: '2.attkey', fileName: '2.encname' });
    const { result } = render({ encryptedCiphers: [cipherWithAttachment], encryptedFolders: [] });
    await expect(act(async () => {
      await result.current.exportVault({ format: 'bitwarden_json_zip', masterPassword: 'pw', zipPassword: 'zp' } as any);
    })).rejects.toThrow(/Failed to download attachment/);
    vi.unstubAllGlobals();
  });
});
