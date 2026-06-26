import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import BackupCenterPage from '@/components/BackupCenterPage';
import type { AdminBackupSettings, RemoteBackupItem } from '@/lib/api/backup';
import { createBackupDestinationRecord } from '@shared/backup-schema';
import { BACKUP_PROGRESS_EVENT, type BackupProgressDetail } from '@/lib/backup-restore-progress';
import { t } from '@/lib/i18n';

// This suite covers the restore flows the existing BackupCenterPage suites do
// not: local-file selection + the confirm dialog, the integrity-mismatch
// warning (proceed / cancel), the replace-required confirm flow, the remote
// browser download / restore / delete password-prompt paths, and the live
// progress-overlay event handling.
//
// jsdom's File supports .arrayBuffer() and crypto.subtle (verified), so the
// component's real integrity check (api/backup verifyBackupFileIntegrity) runs.
// A file named "*.zip" with no _<5 hex>.zip suffix has no checksum prefix and
// therefore "matches"; a name like "backup_00000.zip" carries an expected
// prefix that (essentially) never equals the real SHA-256 prefix, forcing the
// mismatch branch.

const DESTINATION_ID = 'dest-primary';

function buildSavedDestination() {
  return createBackupDestinationRecord('webdav', 1, {
    id: DESTINATION_ID,
    name: 'Primary WebDAV',
    timezone: 'UTC',
  });
}

function buildSettings(): AdminBackupSettings {
  return { destinations: [buildSavedDestination()] };
}

const ZIP_ITEM: RemoteBackupItem = {
  path: 'backup.zip',
  name: 'backup.zip',
  isDirectory: false,
  size: 2048,
  modifiedAt: '2026-01-02T00:00:00.000Z',
};

function renderPage(overrides: Record<string, unknown> = {}) {
  const onLoadSettings = vi.fn().mockResolvedValue(buildSettings());
  const onSaveSettings = vi.fn().mockImplementation(
    (_password: string, settings: AdminBackupSettings) => Promise.resolve(settings)
  );
  const props = {
    currentUserId: 'user-1',
    onExport: vi.fn().mockResolvedValue(undefined),
    onImport: vi.fn().mockResolvedValue({}),
    onImportAllowingChecksumMismatch: vi.fn().mockResolvedValue({}),
    onLoadSettings,
    onSaveSettings,
    onRunRemoteBackup: vi.fn().mockResolvedValue({ settings: buildSettings(), result: { fileName: 'b.zip' } }),
    onListRemoteBackups: vi.fn().mockResolvedValue({ items: [ZIP_ITEM] }),
    onDownloadRemoteBackup: vi.fn().mockResolvedValue(undefined),
    onInspectRemoteBackup: vi.fn().mockResolvedValue({
      object: 'backup-remote-integrity',
      destinationId: DESTINATION_ID,
      path: 'backup.zip',
      fileName: 'backup.zip',
      integrity: { hasChecksumPrefix: false, expectedPrefix: null, actualPrefix: 'abcde', matches: true },
    }),
    onDeleteRemoteBackup: vi.fn().mockResolvedValue(undefined),
    onRestoreRemoteBackup: vi.fn().mockResolvedValue({}),
    onRestoreRemoteBackupAllowingChecksumMismatch: vi.fn().mockResolvedValue({}),
    onNotify: vi.fn(),
    ...overrides,
  };

  render(<BackupCenterPage {...(props as any)} />);
  return props;
}

function makeBackupFile(name: string): File {
  // Distinct bytes so the SHA-256 is stable and not all-zero.
  return new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], name, { type: 'application/zip' });
}

function getFileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function selectLocalFile(file: File) {
  const input = getFileInput();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function findPasswordPrompt() {
  return waitFor(() => {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
    const prompt = dialogs.find((dialog) => (
      within(dialog).queryByText(t('txt_enter_master_password_to_continue'))
      && dialog.querySelector('input[type="password"]')
    ));
    expect(prompt, 'master-password prompt dialog should be open').toBeTruthy();
    return prompt!;
  });
}

async function submitPasswordPrompt(password: string) {
  const prompt = await findPasswordPrompt();
  const input = prompt.querySelector<HTMLInputElement>('input[type="password"]')!;
  fireEvent.input(input, { target: { value: password } });
  fireEvent.click(within(prompt).getByRole('button', { name: t('txt_continue') }));
}

// Locate an open ConfirmDialog by a substring of its visible text.
async function findDialogByText(matcher: RegExp | string) {
  return waitFor(() => {
    const dialog = screen
      .getAllByRole('dialog')
      .find((node) => within(node).queryByText(matcher));
    expect(dialog, `dialog matching ${matcher} should be open`).toBeTruthy();
    return dialog as HTMLElement;
  });
}

async function loadRemoteBrowser() {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_remote_refresh')) }));
  await screen.findByText('backup.zip');
}

describe('<BackupCenterPage> restore flows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('opens the local-restore confirm dialog after a checksum-matching file is selected, then restores through the gate', async () => {
    const { onImport } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    // A file with no checksum suffix "matches" => the restore confirm dialog.
    selectLocalFile(makeBackupFile('plain-backup.zip'));
    const confirmDialog = await findDialogByText(/plain-backup\.zip/);
    expect(within(confirmDialog).getByText(t('txt_backup_selected_file_name', { name: 'plain-backup.zip' }))).toBeInTheDocument();

    // Confirm => master-password gate (onImport not yet called).
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_backup_import') }));
    await findPasswordPrompt();
    expect(onImport).not.toHaveBeenCalled();

    await submitPasswordPrompt('restore-pw');
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toBe('restore-pw');
    // Selected file forwarded, replaceExisting = false on the first attempt.
    expect((onImport.mock.calls[0][1] as File).name).toBe('plain-backup.zip');
    expect(onImport.mock.calls[0][2]).toBe(false);
  });

  it('shows the integrity-mismatch warning for a checksum-suffixed file and proceeds with allow-mismatch', async () => {
    const { onImport, onImportAllowingChecksumMismatch } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    // "00000" is a valid-format hex prefix that will not equal the real hash.
    selectLocalFile(makeBackupFile('backup_00000.zip'));
    const warningDialog = await findDialogByText(t('txt_backup_restore_checksum_warning_title'));

    // Proceed => master-password gate => the allow-mismatch import runs.
    fireEvent.click(within(warningDialog).getByRole('button', { name: t('txt_backup_restore_checksum_warning_confirm') }));
    await submitPasswordPrompt('mismatch-pw');

    await waitFor(() => expect(onImportAllowingChecksumMismatch).toHaveBeenCalledTimes(1));
    expect(onImportAllowingChecksumMismatch.mock.calls[0][0]).toBe('mismatch-pw');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('cancels the integrity-mismatch warning without importing', async () => {
    const { onImport, onImportAllowingChecksumMismatch } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    selectLocalFile(makeBackupFile('backup_00000.zip'));
    const warningDialog = await findDialogByText(t('txt_backup_restore_checksum_warning_title'));
    fireEvent.click(within(warningDialog).getByRole('button', { name: t('txt_cancel') }));

    await waitFor(() => {
      expect(screen.queryByText(t('txt_backup_restore_checksum_warning_title'))).not.toBeInTheDocument();
    });
    expect(onImport).not.toHaveBeenCalled();
    expect(onImportAllowingChecksumMismatch).not.toHaveBeenCalled();
  });

  it('surfaces the replace-required confirm dialog when the import demands a fresh instance, then replaces', async () => {
    // First import attempt rejects with the "fresh instance" sentinel => the
    // component opens the replace-confirm dialog instead of erroring.
    const onImport = vi.fn()
      .mockRejectedValueOnce(new Error('Restore requires a fresh instance'))
      .mockResolvedValueOnce({});
    const { onNotify } = renderPage({ onImport });
    await screen.findByText(t('txt_backup_destination_detail_title'));

    selectLocalFile(makeBackupFile('plain-backup.zip'));
    const confirmDialog = await findDialogByText(/plain-backup\.zip/);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_backup_import') }));
    await submitPasswordPrompt('first-pw');

    // First call ran and rejected => replace dialog appears.
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const replaceDialog = await findDialogByText(t('txt_backup_replace_confirm_title'));

    // Confirm replace => password gate again => second import with replace=true.
    fireEvent.click(within(replaceDialog).getByRole('button', { name: t('txt_backup_clear_and_restore') }));
    await submitPasswordPrompt('replace-pw');

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    expect(onImport.mock.calls[1][2]).toBe(true);
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', expect.stringContaining(t('txt_backup_restore_success_relogin'))));
  });

  it('downloads a remote backup through the master-password gate', async () => {
    const { onDownloadRemoteBackup } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Download/ }));

    await findPasswordPrompt();
    expect(onDownloadRemoteBackup).not.toHaveBeenCalled();

    await submitPasswordPrompt('dl-pw');
    await waitFor(() => expect(onDownloadRemoteBackup).toHaveBeenCalledTimes(1));
    expect(onDownloadRemoteBackup.mock.calls[0][0]).toBe('dl-pw');
    expect(onDownloadRemoteBackup.mock.calls[0][1]).toBe(DESTINATION_ID);
    expect(onDownloadRemoteBackup.mock.calls[0][2]).toBe('backup.zip');
  });

  it('restores a remote backup (checksum-matching) through the gate after inspecting integrity', async () => {
    const { onRestoreRemoteBackup, onInspectRemoteBackup } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));

    // The component inspects integrity first; matching => straight to the gate.
    await waitFor(() => expect(onInspectRemoteBackup).toHaveBeenCalled());
    await findPasswordPrompt();
    expect(onRestoreRemoteBackup).not.toHaveBeenCalled();

    await submitPasswordPrompt('remote-restore-pw');
    await waitFor(() => expect(onRestoreRemoteBackup).toHaveBeenCalledTimes(1));
    expect(onRestoreRemoteBackup.mock.calls[0][0]).toBe('remote-restore-pw');
    expect(onRestoreRemoteBackup.mock.calls[0][1]).toBe(DESTINATION_ID);
    expect(onRestoreRemoteBackup.mock.calls[0][2]).toBe('backup.zip');
    expect(onRestoreRemoteBackup.mock.calls[0][3]).toBe(false);
  });

  it('opens the integrity warning for a checksum-mismatched remote backup and proceeds with allow-mismatch', async () => {
    const onInspectRemoteBackup = vi.fn().mockResolvedValue({
      object: 'backup-remote-integrity',
      destinationId: DESTINATION_ID,
      path: 'backup.zip',
      fileName: 'backup.zip',
      integrity: { hasChecksumPrefix: true, expectedPrefix: '00000', actualPrefix: 'abcde', matches: false },
    });
    const { onRestoreRemoteBackupAllowingChecksumMismatch } = renderPage({ onInspectRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));

    const warningDialog = await findDialogByText(t('txt_backup_restore_checksum_warning_title'));
    fireEvent.click(within(warningDialog).getByRole('button', { name: t('txt_backup_restore_checksum_warning_confirm') }));
    await submitPasswordPrompt('remote-mismatch-pw');

    await waitFor(() => expect(onRestoreRemoteBackupAllowingChecksumMismatch).toHaveBeenCalledTimes(1));
    expect(onRestoreRemoteBackupAllowingChecksumMismatch.mock.calls[0][0]).toBe('remote-mismatch-pw');
  });

  it('runs the remote replace-required flow then restores with replace=true', async () => {
    const onRestoreRemoteBackup = vi.fn()
      .mockRejectedValueOnce(new Error('This requires a fresh instance'))
      .mockResolvedValueOnce({});
    const { } = renderPage({ onRestoreRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    await submitPasswordPrompt('first-remote-pw');
    await waitFor(() => expect(onRestoreRemoteBackup).toHaveBeenCalledTimes(1));

    const replaceDialog = await findDialogByText(t('txt_backup_replace_confirm_title'));
    fireEvent.click(within(replaceDialog).getByRole('button', { name: t('txt_backup_clear_and_restore') }));
    await submitPasswordPrompt('replace-remote-pw');

    await waitFor(() => expect(onRestoreRemoteBackup).toHaveBeenCalledTimes(2));
    expect(onRestoreRemoteBackup.mock.calls[1][3]).toBe(true);
  });

  it('deletes a remote backup via the confirm dialog', async () => {
    const { onDeleteRemoteBackup, onNotify } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    const deleteDialog = await findDialogByText(/backup\.zip/);
    // The delete confirm dialog has a "Delete" confirm button.
    fireEvent.click(within(deleteDialog).getByRole('button', { name: t('txt_delete') }));

    await waitFor(() => expect(onDeleteRemoteBackup).toHaveBeenCalledTimes(1));
    expect(onDeleteRemoteBackup.mock.calls[0][0]).toBe(DESTINATION_ID);
    expect(onDeleteRemoteBackup.mock.calls[0][1]).toBe('backup.zip');
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', t('txt_backup_remote_delete_success')));
  });

  it('renders the live progress overlay from a backup-progress event and clears it on done', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    const detail: BackupProgressDetail = {
      operation: 'backup-restore',
      source: 'local',
      step: 'restore',
      fileName: 'live-restore.zip',
      stageTitle: 'txt_backup_restore_progress_local_data_title',
      stageDetail: 'txt_backup_restore_progress_local_data_detail',
    };
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, { detail }));
    });

    // Overlay shows the local-restore title and the subject file label.
    await screen.findByText(t('txt_backup_restore_progress_local_title'));
    expect(screen.getByText(t('txt_backup_progress_subject', { name: 'live-restore.zip' }))).toBeInTheDocument();
    // The matched phase's current detail copy renders.
    expect(screen.getByText(t('txt_backup_restore_progress_local_data_detail'))).toBeInTheDocument();

    // A done event clears the overlay (after the component's short timeout).
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, {
        detail: { ...detail, done: true, ok: true },
      }));
    });
    await waitFor(
      () => expect(screen.queryByText(t('txt_backup_restore_progress_local_title'))).not.toBeInTheDocument(),
      { timeout: 2500 }
    );
  });
});
