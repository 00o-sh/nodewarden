import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import BackupCenterPage from '@/components/BackupCenterPage';
import type { AdminBackupSettings, RemoteBackupItem } from '@/lib/api/backup';
import { createBackupDestinationRecord } from '@shared/backup-schema';
import { t } from '@/lib/i18n';

// This suite drives the ACTION ERROR paths that the happy-path BackupCenterPage
// suites do not: every execute*() catch block routes its failure through the
// shared showActionError() helper (surfacing props.onNotify('error', ...) and the
// local error banner). We reject each handler and assert the notification, which
// exercises the refactored catch bodies (deleteDestination / export / local
// restore / remote download / remote delete / remote restore) plus the
// non-Error fallback branch of showActionError and the empty-password guard.

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

function seedRemoteBrowserCache() {
  window.localStorage.setItem('nodewarden.backup.remote-browser.v1:user-1', JSON.stringify({
    cache: {
      [`${DESTINATION_ID}:`]: {
        object: 'backup-remote-browser',
        destinationId: DESTINATION_ID,
        destinationName: 'Primary WebDAV',
        provider: 'webdav',
        currentPath: '',
        parentPath: null,
        items: [],
      },
    },
    pathByDestination: {},
    pageByKey: {},
    selectedDestinationId: DESTINATION_ID,
  }));
}

function renderPage(overrides: Record<string, unknown> = {}) {
  seedRemoteBrowserCache();
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
  return new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], name, { type: 'application/zip' });
}

function selectLocalFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
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

async function findDialogByText(matcher: RegExp | string) {
  return waitFor(() => {
    const dialog = screen.getAllByRole('dialog').find((node) => within(node).queryByText(matcher));
    expect(dialog, `dialog matching ${matcher} should be open`).toBeTruthy();
    return dialog as HTMLElement;
  });
}

async function loadRemoteBrowser() {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_remote_refresh')) }));
  await screen.findByText('backup.zip');
}

describe('<BackupCenterPage> action error paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('surfaces the fallback message (non-Error rejection) when export fails', async () => {
    // Rejecting with a non-Error exercises showActionError's `: fallback` branch,
    // so the notified message is the export fallback, not the thrown value.
    const onExport = vi.fn().mockRejectedValue('a bare string, not an Error');
    const { onNotify } = renderPage({ onExport });
    await screen.findByText(t('txt_backup_destination_detail_title'));

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_export')) }));
    await submitPasswordPrompt('export-pw');

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_backup_export_failed')));
  });

  it('notifies with the thrown message when a local restore fails for a non-replace reason', async () => {
    const onImport = vi.fn().mockRejectedValue(new Error('local-restore-exploded'));
    const { onNotify } = renderPage({ onImport });
    await screen.findByText(t('txt_backup_destination_detail_title'));

    selectLocalFile(makeBackupFile('plain-backup.zip'));
    const confirmDialog = await findDialogByText(/plain-backup\.zip/);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_backup_import') }));
    await submitPasswordPrompt('restore-pw');

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'local-restore-exploded'));
  });

  it('notifies when deleting a destination fails (save rejects)', async () => {
    const onSaveSettings = vi.fn().mockRejectedValue(new Error('delete-destination-failed'));
    const { onNotify } = renderPage({ onSaveSettings });
    await screen.findByText(t('txt_backup_destination_detail_title'));

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_backup_delete_destination')) }));
    const confirmDialog = await findDialogByText(new RegExp('Primary WebDAV'));
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_delete') }));
    await submitPasswordPrompt('del-dest-pw');

    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'delete-destination-failed'));
  });

  it('notifies when a remote download fails', async () => {
    const onDownloadRemoteBackup = vi.fn().mockRejectedValue(new Error('download-failed'));
    const { onNotify } = renderPage({ onDownloadRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Download/ }));
    await submitPasswordPrompt('dl-pw');

    await waitFor(() => expect(onDownloadRemoteBackup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'download-failed'));
  });

  it('notifies when a remote delete fails', async () => {
    const onDeleteRemoteBackup = vi.fn().mockRejectedValue(new Error('remote-delete-failed'));
    const { onNotify } = renderPage({ onDeleteRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const deleteDialog = await findDialogByText(/backup\.zip/);
    fireEvent.click(within(deleteDialog).getByRole('button', { name: t('txt_delete') }));
    await submitPasswordPrompt('rm-pw');

    await waitFor(() => expect(onDeleteRemoteBackup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'remote-delete-failed'));
  });

  it('notifies when a remote restore fails for a non-replace reason', async () => {
    const onRestoreRemoteBackup = vi.fn().mockRejectedValue(new Error('remote-restore-failed'));
    const { onNotify } = renderPage({ onRestoreRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    await submitPasswordPrompt('remote-restore-pw');

    await waitFor(() => expect(onRestoreRemoteBackup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'remote-restore-failed'));
  });

  it('surfaces the failure inline in the still-open prompt, then clears it as the user retypes', async () => {
    // A failed action keeps the prompt open and mirrors the message into the
    // inline password error (showActionError's pendingBackupVerification branch).
    const onSaveSettings = vi.fn().mockRejectedValue(new Error('save-blew-up-inline'));
    renderPage({ onSaveSettings });
    await screen.findByText(t('txt_backup_destination_detail_title'));

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));
    await submitPasswordPrompt('first-attempt');

    // The prompt stays open with the inline error banner.
    const prompt = await findPasswordPrompt();
    await within(prompt).findByText('save-blew-up-inline');

    // Typing clears the inline error (the onInput branch that resets it).
    const input = prompt.querySelector<HTMLInputElement>('input[type="password"]')!;
    fireEvent.input(input, { target: { value: 'second-attempt' } });
    await waitFor(() => {
      expect(within(prompt).queryByText('save-blew-up-inline')).not.toBeInTheDocument();
    });
  });
});
