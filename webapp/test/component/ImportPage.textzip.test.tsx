import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { zipSync, strToU8 } from 'fflate';
import ImportPage, { type ImportResultSummary } from '@/components/ImportPage';
import { t } from '@/lib/i18n';
import type { Folder } from '@/lib/types';

// The 1Password (1pux) and ProtonPass sources read their payload through
// readImportText -> readZipText, which uses fflate's unzipSync directly (NOT the
// @zip.js/zip.js boundary the sibling zip suite mocks). These tests feed REAL
// fflate archives so the zip-entry safety filter, size guards, candidate
// selection (preferred name + first-json fallback), and the plain-json fallback
// path all execute for real.

// jsdom File needs arrayBuffer(); provide a fallback backed by the raw bytes.
if (!(File.prototype as { arrayBuffer?: unknown }).arrayBuffer) {
  (File.prototype as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = function (
    this: File & { __bytes?: Uint8Array }
  ) {
    return Promise.resolve((this.__bytes ?? new Uint8Array()).buffer);
  };
}

function makeSummary(overrides: Partial<ImportResultSummary> = {}): ImportResultSummary {
  return {
    totalItems: 1,
    folderCount: 0,
    typeCounts: [{ label: 'Login', count: 1 }],
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
  const folders: Folder[] = [{ id: 'f1', name: 'Personal', decName: 'Personal' }];
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
  return { onImport, onImportEncryptedRaw, onNotify, onExport, ...utils };
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

function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Wrap raw bytes as a File that also carries them for the arrayBuffer fallback.
function makeBytesFile(bytes: Uint8Array, name: string, type = 'application/zip'): File {
  const file = new File([bytes], name, { type }) as File & { __bytes?: Uint8Array };
  file.__bytes = bytes;
  return file;
}

function makeZip(files: Record<string, Uint8Array>, name = 'export.zip'): File {
  return makeBytesFile(zipSync(files), name);
}

const PROTON_JSON = JSON.stringify({
  vaults: {
    v1: { name: 'My Vault', items: [{ data: { type: 'login', metadata: { name: 'Login1' }, content: { password: 'pw' } } }] },
  },
});

const ONEPUX_JSON = JSON.stringify({
  accounts: [{ vaults: [{ attrs: { name: 'V' }, items: [{ categoryUuid: '001', title: 'Login1', overview: {}, details: {} }] }] }],
});

async function importFileForSource(source: string, file: File) {
  selectImportSource(source);
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  setFiles(fileInput, [file]);
  await waitFor(() => expect(fileInput.files?.[0]?.name).toBe(file.name));
  fireEvent.click(getImportButton());
}

describe('<ImportPage> 1pux / protonpass zip text extraction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('imports a ProtonPass zip by selecting the preferred protonpass.json entry', async () => {
    const { onImport } = setup();
    await importFileForSource('protonpass_json', makeZip({ 'protonpass.json': strToU8(PROTON_JSON) }, 'proton.zip'));
    await screen.findByText(t('txt_import_success'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('imports a 1Password 1pux zip by selecting the preferred export.data entry', async () => {
    const { onImport } = setup();
    await importFileForSource('onepassword_1pux', makeZip({ 'export.data': strToU8(ONEPUX_JSON) }, 'archive.1pux'));
    await screen.findByText(t('txt_import_success'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first .json entry when no preferred name matches', async () => {
    const { onImport } = setup();
    // "stuff.json" passes the candidate filter but is not in the preferred list,
    // exercising the first-json fallback branch of readZipText.
    await importFileForSource('protonpass_json', makeZip({ 'stuff.json': strToU8(PROTON_JSON) }, 'proton2.zip'));
    await screen.findByText(t('txt_import_success'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('reads a plain (non-zip) ProtonPass .json through the text-size branch', async () => {
    const { onImport } = setup();
    // A non-zip payload for a zip-capable source takes the assertImportTextFileSize
    // + TextDecoder branch of readImportText.
    await importFileForSource(
      'protonpass_json',
      makeBytesFile(strToU8(PROTON_JSON), 'proton.json', 'application/json')
    );
    await screen.findByText(t('txt_import_success'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('accepts 1pux candidate names across the sub-path/plain-json variants', async () => {
    const { onImport } = setup();
    // Multiple candidate-name shapes exercise the OR chain in
    // isImportTextZipCandidate for the 1pux source (export.data preferred wins).
    await importFileForSource(
      'onepassword_1pux',
      makeZip(
        {
          'export.data': strToU8(ONEPUX_JSON),
          'nested/export.json': strToU8(ONEPUX_JSON),
          'note.json': strToU8(ONEPUX_JSON),
        },
        'multi.1pux'
      )
    );
    await screen.findByText(t('txt_import_success'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('reports an empty archive when no zip entry is an importable candidate', async () => {
    const { onNotify, onImport } = setup();
    // A lone non-candidate entry is filtered out, leaving no files to import.
    await importFileForSource('protonpass_json', makeZip({ 'readme.txt': strToU8('nope') }, 'empty-ish.zip'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_import_empty_zip_archive')));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('rejects a zip that contains too many entries for the text-import filter', async () => {
    const { onNotify, onImport } = setup();
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= 10_000; i += 1) files[`f-${i}.json`] = strToU8('{}');
    await importFileForSource('protonpass_json', makeZip(files, 'many.zip'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_import_zip_too_many_files')));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('rejects a zip whose entry name escapes with a leading slash', async () => {
    const { onNotify, onImport } = setup();
    await importFileForSource('protonpass_json', makeZip({ '/evil.json': strToU8(PROTON_JSON) }, 'bad1.zip'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_import_zip_unsafe_file_name')));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('rejects a zip whose entry name contains a parent-directory traversal', async () => {
    const { onNotify, onImport } = setup();
    await importFileForSource('protonpass_json', makeZip({ '../evil.json': strToU8(PROTON_JSON) }, 'bad2.zip'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_import_zip_unsafe_file_name')));
    expect(onImport).not.toHaveBeenCalled();
  });
});
