import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { zipSync, strToU8 } from 'fflate';
import ImportPage, { type ImportResultSummary } from '@/components/ImportPage';
import { t } from '@/lib/i18n';
import type { Folder } from '@/lib/types';

// These tests cover the zip / encrypted-JSON / NodeWarden-attachment import
// branches that the CSV/JSON-focused sibling suites (ImportPage.test.tsx and
// ImportPage.extra.test.tsx) do not exercise.
//
// What is real vs. mocked:
//  - The component reads `bitwarden_zip` archives through @zip.js/zip.js, whose
//    ZipReader cannot decrypt AES-encrypted zips that fflate is able to produce
//    (fflate has no zip-encryption support). To exercise BOTH the unencrypted
//    branches AND the password branches from one suite, we MOCK the
//    @zip.js/zip.js boundary: the mocked ZipReader serves entries (filename +
//    bytes) supplied per-test, so the component's own zip-walking, attachment
//    parsing, JSON parsing, and password-error sniffing all run for real.
//  - The unencrypted entry bytes ARE produced with fflate's strToU8 so the
//    decoded payloads are genuine; only the archive container is stubbed.
//  - The crypto-bearing branches (account-encrypted validation token,
//    encrypted NodeWarden attachments) use the real crypto helpers against
//    bogus tokens and assert the component's error handling, since real account
//    crypto fixtures are out of scope. onImport / onImportEncryptedRaw are
//    vi.fn() stubs throughout, so we assert the forwarded payload/attachments
//    and branch handling rather than persistence.

// jsdom's File lacks .text(); the JSON-text branches call File.text().
if (!(File.prototype as { text?: unknown }).text) {
  (File.prototype as unknown as { text: () => Promise<string> }).text = function (this: File & { __contents?: string }) {
    return Promise.resolve(this.__contents ?? '');
  };
}

// --- Mockable @zip.js/zip.js boundary -----------------------------------
// The component constructs `new ZipReader(new BlobReader(file), opts)` then
// calls getEntries() / entry.getData(writer, options). We default to a
// pass-through that reads the REAL fflate archive bytes, and let individual
// tests override `zipBehavior` to force the password-error code paths.
type ZipEntry = {
  filename: string;
  directory: boolean;
  getData: (writer: unknown, options?: { password?: string }) => Promise<Uint8Array>;
};
type ZipBehavior = {
  getEntries: () => Promise<ZipEntry[]>;
};
let zipBehavior: ZipBehavior | null = null;

vi.mock('@zip.js/zip.js', () => {
  class BlobReader {
    constructor(public file: File) {}
  }
  class Uint8ArrayWriter {}
  class ZipReader {
    constructor(_reader: unknown, _opts?: unknown) {}
    async getEntries() {
      if (!zipBehavior) throw new Error('zipBehavior not configured for this test');
      return zipBehavior.getEntries();
    }
    async close() {}
  }
  return {
    BlobReader,
    Uint8ArrayWriter,
    ZipReader,
    configure: () => {},
  };
});

// Expose a set of (genuine, fflate-decoded) entries through the mocked
// ZipReader. The component walks these exactly as it would a real archive.
function useZip(files: Record<string, Uint8Array>) {
  zipBehavior = {
    getEntries: async () =>
      Object.keys(files).map((filename) => ({
        filename,
        directory: filename.endsWith('/'),
        getData: async () => files[filename],
      })),
  };
}

function makeZipFile(name = 'backup.zip'): File {
  // Bytes are a real fflate zip header; the mocked ZipReader serves entries
  // from `zipBehavior`, but the File still needs to look like a zip.
  return new File([zipSync({ 'placeholder': new Uint8Array() })], name, { type: 'application/zip' });
}

function makeTextFile(contents: string, name: string, type = 'application/json'): File {
  const file = new File([contents], name, { type }) as File & { __contents?: string };
  file.__contents = contents;
  return file;
}

function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeSummary(overrides: Partial<ImportResultSummary> = {}): ImportResultSummary {
  return {
    totalItems: 3,
    folderCount: 1,
    typeCounts: [{ label: 'Login', count: 3 }],
    attachmentCount: 0,
    importedAttachmentCount: 0,
    failedAttachments: [],
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof ImportPage>[0]> = {}) {
  const onImport = vi.fn(async () => makeSummary());
  const onImportEncryptedRaw = vi.fn(async () => makeSummary());
  const onNotify = vi.fn();
  const onExport = vi.fn(async () => {});
  const folders: Folder[] = [
    { id: 'f1', name: 'Personal', decName: 'Personal' },
  ];
  const utils = render(
    <ImportPage
      onImport={onImport}
      onImportEncryptedRaw={onImportEncryptedRaw}
      accountKeys={null}
      onNotify={onNotify}
      folders={folders}
      onExport={onExport}
      {...overrides}
    />
  );
  return { onImport, onImportEncryptedRaw, onNotify, onExport, folders, ...utils };
}

function getImportButton(): HTMLButtonElement {
  return screen
    .getAllByRole('button')
    .find((b) => new RegExp(t('txt_import')).test(b.textContent || '')) as HTMLButtonElement;
}

function selectImportSource(value: string) {
  const formatSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
  formatSelect.value = value;
  formatSelect.dispatchEvent(new Event('change', { bubbles: true }));
}

const VALID_DATA_JSON = JSON.stringify({ items: [{ id: '1', type: 1, name: 'x' }] });

describe('<ImportPage> zip / encrypted branches', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    zipBehavior = null;
  });

  it('imports an unencrypted bitwarden_zip with data.json + attachments and forwards both', async () => {
    const { onImport } = setup();
    useZip({
      'data.json': strToU8(VALID_DATA_JSON),
      'attachments/cipher-1/note.txt': strToU8('hello attachment'),
    });

    selectImportSource('bitwarden_zip');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeZipFile()]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('backup.zip'));

    fireEvent.click(getImportButton());
    await screen.findByText(t('txt_import_success'));

    expect(onImport).toHaveBeenCalledTimes(1);
    // The third arg is the attachment list parsed out of the attachments/ tree.
    const attachments = onImport.mock.calls[0][2] as Array<{ fileName: string; sourceCipherId: string | null }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].fileName).toBe('note.txt');
    expect(attachments[0].sourceCipherId).toBe('cipher-1');
  });

  it('notifies the data.json-not-found error when the zip has no data.json', async () => {
    const { onNotify, onImport } = setup();
    useZip({
      'attachments/cipher-1/note.txt': strToU8('orphaned attachment'),
    });

    selectImportSource('bitwarden_zip');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeZipFile()]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('backup.zip'));

    fireEvent.click(getImportButton());
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_import_data_json_not_found')));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('reports invalid JSON inside a zip data.json', async () => {
    const { onNotify, onImport } = setup();
    useZip({ 'data.json': strToU8('not valid json {{{') });

    selectImportSource('bitwarden_zip');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeZipFile()]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('backup.zip'));

    fireEvent.click(getImportButton());
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_import_invalid_json_file')));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('opens the encrypted-file dialog for a password-protected export inside a zip', async () => {
    setup();
    const protectedJson = JSON.stringify({ encrypted: true, passwordProtected: true, salt: 's', kdfType: 0, kdfIterations: 1 });
    useZip({ 'data.json': strToU8(protectedJson) });

    selectImportSource('bitwarden_zip');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeZipFile()]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('backup.zip'));

    fireEvent.click(getImportButton());
    // Password-protected payload inside the zip => the encrypted-file dialog.
    expect(await screen.findByText(t('txt_import_encrypted_file_title'))).toBeInTheDocument();
  });

  it('opens the zip-password dialog when the archive requires a password, then reports an invalid password', async () => {
    const { onNotify } = setup();
    // First getEntries succeeds, getData throws a password-shaped error with no
    // password => ZipNeedsPasswordError => zip-password dialog.
    zipBehavior = {
      getEntries: async () => [
        {
          filename: 'data.json',
          directory: false,
          getData: async (_w: unknown, options?: { password?: string }) => {
            if (!options?.password) throw new Error('File contains encrypted entry');
            throw new Error('Invalid password while decrypting entry');
          },
        },
      ],
    };

    selectImportSource('bitwarden_zip');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeZipFile()]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('backup.zip'));

    fireEvent.click(getImportButton());
    // The zip-password ConfirmDialog opens.
    const dialog = await waitFor(() => {
      const found = screen
        .getAllByRole('dialog')
        .find((d) => within(d).queryByText(t('txt_import_encrypted_zip_title')));
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });

    // Supply a (wrong) password => getData throws the password error again =>
    // ZipInvalidPasswordError => invalid-zip-password notification.
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'wrong-pw' } });
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(t('txt_import')) }));

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_import_invalid_zip_password')));
  });

  it('completes a zip import after the correct password is supplied in the zip-password dialog', async () => {
    const { onImport } = setup();
    zipBehavior = {
      getEntries: async () => [
        {
          filename: 'data.json',
          directory: false,
          getData: async (_w: unknown, options?: { password?: string }) => {
            if (!options?.password) throw new Error('File contains encrypted entry');
            if (options.password !== 'good-pw') throw new Error('Invalid password');
            return strToU8(VALID_DATA_JSON);
          },
        },
      ],
    };

    selectImportSource('bitwarden_zip');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeZipFile()]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('backup.zip'));

    fireEvent.click(getImportButton());
    const dialog = await waitFor(() => {
      const found = screen
        .getAllByRole('dialog')
        .find((d) => within(d).queryByText(t('txt_import_encrypted_zip_title')));
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    const pwInput = dialog.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.input(pwInput, { target: { value: 'good-pw' } });
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(t('txt_import')) }));

    await screen.findByText(t('txt_import_success'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('notifies the empty-zip-archive error when the archive has no entries', async () => {
    const { onNotify, onImport } = setup();
    zipBehavior = { getEntries: async () => [] };

    selectImportSource('bitwarden_zip');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeZipFile()]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('backup.zip'));

    fireEvent.click(getImportButton());
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_import_empty_zip_archive')));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('imports a nodewarden_json export bundling inline (plaintext) attachments', async () => {
    const { onImport } = setup();
    // nodewardenAttachments holds base64 file data; the component decodes it and
    // forwards the attachment alongside the normal import payload.
    const base64 = btoa('inline-bytes');
    const json = JSON.stringify({
      items: [{ id: '1', type: 1, name: 'x' }],
      nodewardenAttachments: [
        { fileName: 'inline.bin', data: base64, cipherId: 'c-9', cipherIndex: 2 },
      ],
    });

    selectImportSource('nodewarden_json');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeTextFile(json, 'nw.json')]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('nw.json'));

    fireEvent.click(getImportButton());
    await screen.findByText(t('txt_import_success'));

    expect(onImport).toHaveBeenCalledTimes(1);
    const attachments = onImport.mock.calls[0][2] as Array<{ fileName: string; sourceCipherId: string | null; sourceCipherIndex: number | null }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].fileName).toBe('inline.bin');
    expect(attachments[0].sourceCipherId).toBe('c-9');
    expect(attachments[0].sourceCipherIndex).toBe(2);
  });

  it('surfaces vault-key-unavailable for a nodewarden_json export with encrypted attachments and no account keys', async () => {
    const { onNotify, onImport } = setup({ accountKeys: null });
    const json = JSON.stringify({
      items: [{ id: '1', type: 1, name: 'x' }],
      nodewardenAttachmentsEnc: '2.aaaa|bbbb|cccc',
    });

    selectImportSource('nodewarden_json');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeTextFile(json, 'nw-enc.json')]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('nw-enc.json'));

    fireEvent.click(getImportButton());
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_vault_key_unavailable')));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('rejects an account-encrypted export whose validation token belongs to another account', async () => {
    // accountKeys present + a non-empty validation token that fails to decrypt
    // against those keys => "belongs to another account" branch (distinct from
    // the empty-validation branch covered by the sibling suite).
    const { onNotify, onImportEncryptedRaw } = setup({
      accountKeys: { encB64: btoa('0123456789abcdef0123456789abcdef'), macB64: btoa('0123456789abcdef0123456789abcdef') },
    });
    const json = JSON.stringify({
      encrypted: true,
      encKeyValidation_DO_NOT_EDIT: '2.aaaa|bbbb|cccc',
    });

    selectImportSource('bitwarden_json');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeTextFile(json, 'acct-enc.json')]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('acct-enc.json'));

    fireEvent.click(getImportButton());
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_export_belongs_to_another_account')));
    expect(onImportEncryptedRaw).not.toHaveBeenCalled();
  });
});
