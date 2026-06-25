import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import ImportPage, { type ImportResultSummary } from '@/components/ImportPage';
import { t } from '@/lib/i18n';
import type { Folder } from '@/lib/types';

// jsdom's File does not implement .text(); the component reads CSV/JSON files
// via File.text(), so provide a minimal polyfill returning per-file contents.
if (!(File.prototype as { text?: unknown }).text) {
  (File.prototype as unknown as { text: () => Promise<string> }).text = function (this: File & { __contents?: string }) {
    return Promise.resolve(this.__contents ?? '');
  };
}

// Driving an <input type="file"> change in jsdom requires defining `files`
// (read-only) and dispatching a native change event so Preact's handler reads
// the assigned FileList.
function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeCsvFile(contents: string, name = 'export.csv'): File {
  const file = new File([contents], name, { type: 'text/csv' }) as File & { __contents?: string };
  file.__contents = contents;
  return file;
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
    { id: 'f2', name: 'Work', decName: 'Work' },
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
  // The import section's primary button label includes txt_import.
  const button = screen
    .getAllByRole('button')
    .find((b) => new RegExp(t('txt_import')).test(b.textContent || ''));
  return button as HTMLButtonElement;
}

function selectImportSource(value: string) {
  const formatSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
  formatSelect.value = value;
  formatSelect.dispatchEvent(new Event('change', { bubbles: true }));
  return formatSelect;
}

// A minimal valid LastPass CSV (its parser reads these columns).
const LASTPASS_CSV = 'url,username,password,extra,name,grouping,totp\nhttps://example.com,me,pw,,Example,,';

describe('<ImportPage>', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the import format/source picker and a source-file input', () => {
    setup();
    expect(screen.getAllByText(t('txt_format')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(t('txt_source_file'))).toBeInTheDocument();
    // First option of the import format select.
    expect(screen.getByText('Bitwarden (json)')).toBeInTheDocument();
  });

  it('updates the format select value when a different source is selected', () => {
    setup();
    const formatSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(formatSelect.value).toBe('bitwarden_json');
    selectImportSource('lastpass');
    expect(formatSelect.value).toBe('lastpass');
  });

  it('notifies an error when import is clicked without selecting a file', async () => {
    const { onNotify, onImport } = setup();
    fireEvent.click(getImportButton());
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_please_select_a_file')));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('fires the import callback and renders the summary dialog after a successful CSV import', async () => {
    const { onImport } = setup();
    selectImportSource('lastpass');
    await waitFor(() =>
      expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('lastpass')
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeCsvFile(LASTPASS_CSV)]);
    // Let the controlled file state settle before clicking import.
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('export.csv'));

    fireEvent.click(getImportButton());

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    // Summary dialog renders the success heading.
    await screen.findByText(t('txt_import_success'));
  });

  it('renders an error notification when the import callback rejects', async () => {
    const onImport = vi.fn(async () => {
      throw new Error('boom-import');
    });
    const { onNotify } = setup({ onImport });
    selectImportSource('lastpass');
    await waitFor(() =>
      expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('lastpass')
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    setFiles(fileInput, [makeCsvFile(LASTPASS_CSV)]);
    await waitFor(() => expect(fileInput.files?.[0]?.name).toBe('export.csv'));

    fireEvent.click(getImportButton());

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'boom-import'));
    expect(screen.queryByText(t('txt_import_success'))).not.toBeInTheDocument();
  });
});
