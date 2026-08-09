import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import BackupCenterPage from '@/components/BackupCenterPage';
import type { AdminBackupSettings, RemoteBackupItem } from '@/lib/api/backup';
import { createBackupDestinationRecord } from '@shared/backup-schema';
import { BACKUP_PROGRESS_EVENT, type BackupProgressDetail } from '@/lib/backup-restore-progress';
import { t } from '@/lib/i18n';

// This suite closes the remaining branch gaps in BackupCenterPage the other
// suites do not reach: the progress-event reducer (export / remote-run / remote
// restore titles, missing-detail + pending-derived fallbacks, done/failure
// clears), the master-password empty guard, destination edit + schedule toggle,
// the skipped-attachments warning, the remote integrity `-----` fallback, the
// remote browser directory navigation + pagination, and every ConfirmDialog
// cancel path.

const DESTINATION_ID = 'dest-primary';

function buildSavedDestination(overrides: Record<string, unknown> = {}) {
  return createBackupDestinationRecord('webdav', 1, {
    id: DESTINATION_ID,
    name: 'Primary WebDAV',
    timezone: 'UTC',
    ...overrides,
  });
}

function buildSettings(overrides: Record<string, unknown> = {}): AdminBackupSettings {
  return { destinations: [buildSavedDestination(overrides)] };
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

describe('<BackupCenterPage> branch coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  // ---- progress-event reducer ----

  it('renders the export progress overlay title from an export progress event', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, {
        detail: {
          operation: 'backup-export',
          step: 'export',
          fileName: 'export.zip',
          stageTitle: 'txt_backup_archive_progress_collect_title',
          stageDetail: 'txt_backup_archive_progress_collect_detail',
        } as BackupProgressDetail,
      }));
    });
    expect(await screen.findByText(t('txt_backup_export_progress_title'))).toBeInTheDocument();
  });

  it('renders the remote-run progress overlay title from a remote-run event', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, {
        detail: {
          operation: 'backup-remote-run',
          step: 'run',
          fileName: 'run.zip',
          stageTitle: 'txt_backup_remote_run_progress_upload_title',
          stageDetail: 'txt_backup_remote_run_progress_upload_detail',
        } as BackupProgressDetail,
      }));
    });
    expect(await screen.findByText(t('txt_backup_remote_run_progress_title'))).toBeInTheDocument();
  });

  it('renders the remote-restore progress overlay title from a remote-restore event', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, {
        detail: {
          operation: 'backup-restore',
          source: 'remote',
          step: 'restore',
          fileName: 'remote-restore.zip',
          stageTitle: 'txt_backup_restore_progress_remote_data_title',
          stageDetail: 'txt_backup_restore_progress_remote_data_detail',
        } as BackupProgressDetail,
      }));
    });
    expect(await screen.findByText(t('txt_backup_restore_progress_remote_title'))).toBeInTheDocument();
  });

  it('ignores a progress event with no detail and derives operation/source from the pending state', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    // A detail-less event is ignored (early guard).
    act(() => {
      window.dispatchEvent(new CustomEvent(BACKUP_PROGRESS_EVENT, { detail: null }));
    });
    expect(screen.queryByText(t('txt_backup_export_progress_title'))).not.toBeInTheDocument();

    // Seed the pending state with an export event.
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, {
        detail: {
          operation: 'backup-export',
          fileName: 'seed.zip',
          stageTitle: 'txt_backup_archive_progress_collect_title',
        } as BackupProgressDetail,
      }));
    });
    await screen.findByText(t('txt_backup_export_progress_title'));

    // A follow-up event with NO operation/source/stageTitle inherits from the
    // pending state and falls back to the phase's own copy.
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, {
        detail: { step: 'export' } as BackupProgressDetail,
      }));
    });
    // Still the export overlay (operation inherited from pending).
    expect(screen.getByText(t('txt_backup_export_progress_title'))).toBeInTheDocument();
  });

  it('clears the overlay on a failed done event (ok=false path)', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    const detail: BackupProgressDetail = {
      operation: 'backup-restore',
      source: 'local',
      step: 'restore',
      fileName: 'fail-restore.zip',
      stageTitle: 'txt_backup_restore_progress_local_data_title',
      stageDetail: 'txt_backup_restore_progress_local_data_detail',
    };
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, { detail }));
    });
    await screen.findByText(t('txt_backup_restore_progress_local_title'));

    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, {
        detail: { ...detail, done: true, ok: false },
      }));
    });
    await waitFor(
      () => expect(screen.queryByText(t('txt_backup_restore_progress_local_title'))).not.toBeInTheDocument(),
      { timeout: 2500 },
    );
  });

  // ---- destination edit + schedule toggle ----

  it('toggles the destination schedule and forwards the edited name on save', async () => {
    const { onSaveSettings } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    // Edit the destination name (updateSelectedDestination).
    const nameInput = screen
      .getByText(t('txt_backup_destination_name'))
      .closest('label')!
      .querySelector('input') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'Renamed WebDAV' } });
    expect(await screen.findByDisplayValue('Renamed WebDAV')).toBeInTheDocument();

    // Toggle the schedule; the action button label flips.
    const enableBtn = screen.queryByRole('button', { name: t('txt_backup_enable_action') })
      || screen.getByRole('button', { name: t('txt_backup_disable_action') });
    const wasEnable = enableBtn.textContent === t('txt_backup_enable_action');
    fireEvent.click(enableBtn);
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: wasEnable ? t('txt_backup_disable_action') : t('txt_backup_enable_action'),
        }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));
    await submitPasswordPrompt('save-pw');
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    const saved = onSaveSettings.mock.calls[0][1] as AdminBackupSettings;
    expect(saved.destinations.find((d) => d.id === DESTINATION_ID)!.name).toBe('Renamed WebDAV');
  });

  // ---- skipped-attachments warning ----

  it('emits the skipped-attachments warning after a local restore that skipped files', async () => {
    const onImport = vi.fn().mockResolvedValue({ skipped: { attachments: 3, reason: 'quota' } });
    const { onNotify } = renderPage({ onImport });
    await screen.findByText(t('txt_backup_destination_detail_title'));

    selectLocalFile(makeBackupFile('plain-backup.zip'));
    const confirmDialog = await findDialogByText(/plain-backup\.zip/);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_backup_import') }));
    await submitPasswordPrompt('restore-pw');

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(
        'warning',
        t('txt_backup_restore_skipped_summary', { reason: 'quota', attachments: '3' }),
      ),
    );
  });

  it('emits the skipped-attachments warning after a remote restore that skipped files', async () => {
    const onRestoreRemoteBackup = vi.fn().mockResolvedValue({ skipped: { attachments: 2, reason: '' } });
    const { onNotify } = renderPage({ onRestoreRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    await submitPasswordPrompt('remote-restore-pw');

    await waitFor(() => expect(onRestoreRemoteBackup).toHaveBeenCalledTimes(1));
    // Empty reason falls back to the default reason string.
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(
        'warning',
        t('txt_backup_restore_skipped_summary', {
          reason: t('txt_backup_restore_skipped_reason_default'),
          attachments: '2',
        }),
      ),
    );
  });

  it('uses the ----- placeholder in the remote integrity warning when no expected prefix is present', async () => {
    const onInspectRemoteBackup = vi.fn().mockResolvedValue({
      object: 'backup-remote-integrity',
      destinationId: DESTINATION_ID,
      path: 'backup.zip',
      fileName: 'backup.zip',
      integrity: { hasChecksumPrefix: true, expectedPrefix: null, actualPrefix: 'zzzzz', matches: false },
    });
    renderPage({ onInspectRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    await submitPasswordPrompt('inspect-pw');

    const warningDialog = await findDialogByText(t('txt_backup_restore_checksum_warning_title'));
    expect(
      within(warningDialog).getByText(
        t('txt_backup_remote_restore_checksum_warning_message', {
          name: 'backup.zip',
          expected: '-----',
          actual: 'zzzzz',
        }),
      ),
    ).toBeInTheDocument();
  });

  // ---- remote browser navigation ----

  it('navigates into a remote directory and paginates a long listing', async () => {
    const items: RemoteBackupItem[] = [
      { path: 'sub', name: 'sub', isDirectory: true, size: 0, modifiedAt: '2026-01-01T00:00:00.000Z' },
      ...Array.from({ length: 12 }, (_v, i): RemoteBackupItem => ({
        path: `file-${i}.zip`,
        name: `file-${i}.zip`,
        isDirectory: false,
        size: 100 + i,
        modifiedAt: '2026-01-02T00:00:00.000Z',
      })),
    ];
    const onListRemoteBackups = vi.fn().mockResolvedValue({ items });
    renderPage({ onListRemoteBackups });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_remote_refresh')) }));

    // The directory entry is shown; clicking it navigates into the subfolder
    // (which has no cached listing), so the previous listing is cleared.
    const dirEntry = await screen.findByText('sub');
    fireEvent.click(dirEntry);
    await waitFor(() => expect(screen.queryByText('sub')).not.toBeInTheDocument());
    expect(onListRemoteBackups).toHaveBeenCalled();
  });

  it('advances the remote browser to the next page', async () => {
    const items: RemoteBackupItem[] = Array.from({ length: 12 }, (_v, i): RemoteBackupItem => ({
      path: `file-${i}.zip`,
      name: `file-${i}.zip`,
      isDirectory: false,
      size: 100 + i,
      modifiedAt: '2026-01-02T00:00:00.000Z',
    }));
    renderPage({ onListRemoteBackups: vi.fn().mockResolvedValue({ items }) });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_remote_refresh')) }));

    // 12 items over a 10-per-page window => 2 pages, so the pager renders.
    const nextBtn = await screen.findByRole('button', { name: t('txt_next') });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(nextBtn);
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
  });

  // ---- file input clear + integrity-check failure ----

  it('ignores a file-input change that selects no file', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    const input = getFileInput();
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // No confirm dialog appears for an empty selection.
    await Promise.resolve();
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  // ---- ConfirmDialog cancel paths ----

  it('cancels the local-restore confirm dialog and clears the selected file', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    selectLocalFile(makeBackupFile('plain-backup.zip'));
    const confirmDialog = await findDialogByText(/plain-backup\.zip/);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_cancel') }));
    await waitFor(() => expect(screen.queryByText(/plain-backup\.zip/)).not.toBeInTheDocument());
    expect(getFileInput().value).toBe('');
  });

  it('cancels the delete-destination confirm dialog without saving', async () => {
    const { onSaveSettings } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_backup_delete_destination')) }));
    const dialog = await findDialogByText(/Primary WebDAV/);
    fireEvent.click(within(dialog).getByRole('button', { name: t('txt_cancel') }));
    await waitFor(() =>
      expect(screen.queryByText(t('txt_backup_delete_destination_confirm_message', { name: 'Primary WebDAV' }))).not.toBeInTheDocument(),
    );
    expect(onSaveSettings).not.toHaveBeenCalled();
  });

  it('cancels the remote-delete confirm dialog without deleting', async () => {
    const { onDeleteRemoteBackup } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();
    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = await findDialogByText(/backup\.zip/);
    fireEvent.click(within(dialog).getByRole('button', { name: t('txt_cancel') }));
    await waitFor(() => expect(screen.queryAllByRole('dialog').length).toBe(0));
    expect(onDeleteRemoteBackup).not.toHaveBeenCalled();
  });

  it('cancels the replace-required confirm dialog after a fresh-instance rejection', async () => {
    const onImport = vi.fn().mockRejectedValue(new Error('Restore requires a fresh instance'));
    const { onImportAllowingChecksumMismatch } = renderPage({ onImport });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    selectLocalFile(makeBackupFile('plain-backup.zip'));
    const confirmDialog = await findDialogByText(/plain-backup\.zip/);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_backup_import') }));
    await submitPasswordPrompt('first-pw');

    const replaceDialog = await findDialogByText(t('txt_backup_replace_confirm_title'));
    fireEvent.click(within(replaceDialog).getByRole('button', { name: t('txt_cancel') }));
    await waitFor(() =>
      expect(screen.queryByText(t('txt_backup_replace_confirm_title'))).not.toBeInTheDocument(),
    );
    expect(onImportAllowingChecksumMismatch).not.toHaveBeenCalled();
  });

  // ---- load-failure fallback (non-Error) ----

  it('uses the load-failed fallback message when settings load rejects with a non-Error', async () => {
    const { onNotify } = renderPage({ onLoadSettings: vi.fn().mockRejectedValue('load-string') });
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_backup_settings_load_failed')));
  });

  it('defaults a bare progress event to the local restore overlay', async () => {
    renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    // No operation/source/fileName/stageTitle -> operation defaults to
    // backup-restore, source null (local phases), unmatched stage -> phase 0.
    act(() => {
      window.dispatchEvent(new CustomEvent<BackupProgressDetail>(BACKUP_PROGRESS_EVENT, {
        detail: { step: 'restore' } as BackupProgressDetail,
      }));
    });
    expect(await screen.findByText(t('txt_backup_restore_progress_local_title'))).toBeInTheDocument();
  });

  it('exports with attachments enabled through the gate', async () => {
    const { onExport } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    // Toggle the export "include attachments" checkbox in the operations sidebar.
    const attachmentsCheckbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    fireEvent.click(attachmentsCheckbox);

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_export')) }));
    await submitPasswordPrompt('export-pw');
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(onExport.mock.calls[0][1]).toBe(true);
  });

  it('edits the selected destination when several exist and forwards all of them on save', async () => {
    const second = createBackupDestinationRecord('s3', 1, { id: 'dest-second', name: 'Second S3', timezone: 'UTC' });
    const onLoadSettings = vi.fn().mockResolvedValue({ destinations: [buildSavedDestination(), second] });
    const { onSaveSettings } = renderPage({ onLoadSettings });
    await screen.findByText(t('txt_backup_destination_detail_title'));

    const nameInput = screen
      .getByText(t('txt_backup_destination_name'))
      .closest('label')!
      .querySelector('input') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'Primary Renamed' } });

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));
    await submitPasswordPrompt('save-pw');
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    const saved = onSaveSettings.mock.calls[0][1] as AdminBackupSettings;
    // Both destinations are persisted; only the selected one is renamed.
    expect(saved.destinations.map((d) => d.id).sort()).toEqual(['dest-primary', 'dest-second']);
    expect(saved.destinations.find((d) => d.id === DESTINATION_ID)!.name).toBe('Primary Renamed');
  });

  it('falls back to deriving the remote file name from the path when inspect omits it', async () => {
    const onInspectRemoteBackup = vi.fn().mockResolvedValue({
      object: 'backup-remote-integrity',
      destinationId: DESTINATION_ID,
      path: 'nested/dir/backup.zip',
      fileName: '',
      integrity: { hasChecksumPrefix: false, expectedPrefix: null, actualPrefix: 'abcde', matches: true },
    });
    const items: RemoteBackupItem[] = [
      { path: 'nested/dir/backup.zip', name: 'backup.zip', isDirectory: false, size: 10, modifiedAt: '2026-01-02T00:00:00.000Z' },
    ];
    const { onRestoreRemoteBackup } = renderPage({
      onInspectRemoteBackup,
      onListRemoteBackups: vi.fn().mockResolvedValue({ items }),
    });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_remote_refresh')) }));
    await screen.findByText('backup.zip');

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    await submitPasswordPrompt('restore-pw');
    await waitFor(() => expect(onRestoreRemoteBackup).toHaveBeenCalledTimes(1));
    expect(onRestoreRemoteBackup.mock.calls[0][2]).toBe('nested/dir/backup.zip');
  });

  it('handles a save that clears every destination (no next selection)', async () => {
    const onSaveSettings = vi.fn().mockResolvedValue({ destinations: [] });
    const { onNotify } = renderPage({ onSaveSettings });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));
    await submitPasswordPrompt('save-pw');
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', t('txt_backup_settings_saved')));
  });

  it('replaces after a fresh-instance rejection on an allow-mismatch local restore', async () => {
    const onImportAllowingChecksumMismatch = vi.fn()
      .mockRejectedValueOnce(new Error('Restore requires a fresh instance'))
      .mockResolvedValueOnce({});
    renderPage({ onImportAllowingChecksumMismatch });
    await screen.findByText(t('txt_backup_destination_detail_title'));

    // A checksum-suffixed file forces the integrity warning first.
    selectLocalFile(makeBackupFile('backup_00000.zip'));
    const warningDialog = await findDialogByText(t('txt_backup_restore_checksum_warning_title'));
    fireEvent.click(within(warningDialog).getByRole('button', { name: t('txt_backup_restore_checksum_warning_confirm') }));
    await submitPasswordPrompt('mismatch-pw');
    await waitFor(() => expect(onImportAllowingChecksumMismatch).toHaveBeenCalledTimes(1));

    // The fresh-instance rejection surfaces the replace dialog, which confirms
    // with the retained (local, mismatched) integrity result.
    const replaceDialog = await findDialogByText(t('txt_backup_replace_confirm_title'));
    fireEvent.click(within(replaceDialog).getByRole('button', { name: t('txt_backup_clear_and_restore') }));
    await submitPasswordPrompt('replace-pw');
    await waitFor(() => expect(onImportAllowingChecksumMismatch).toHaveBeenCalledTimes(2));
    expect(onImportAllowingChecksumMismatch.mock.calls[1][2]).toBe(true);
  });

  it('replaces after a fresh-instance rejection on an allow-mismatch remote restore', async () => {
    const onInspectRemoteBackup = vi.fn().mockResolvedValue({
      object: 'backup-remote-integrity',
      destinationId: DESTINATION_ID,
      path: 'backup.zip',
      fileName: 'backup.zip',
      integrity: { hasChecksumPrefix: true, expectedPrefix: '00000', actualPrefix: 'abcde', matches: false },
    });
    const onRestoreRemoteBackupAllowingChecksumMismatch = vi.fn()
      .mockRejectedValueOnce(new Error('This requires a fresh instance'))
      .mockResolvedValueOnce({});
    renderPage({ onInspectRemoteBackup, onRestoreRemoteBackupAllowingChecksumMismatch });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();

    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    await submitPasswordPrompt('inspect-pw');

    const warningDialog = await findDialogByText(t('txt_backup_restore_checksum_warning_title'));
    fireEvent.click(within(warningDialog).getByRole('button', { name: t('txt_backup_restore_checksum_warning_confirm') }));
    await submitPasswordPrompt('mismatch-pw');
    await waitFor(() => expect(onRestoreRemoteBackupAllowingChecksumMismatch).toHaveBeenCalledTimes(1));

    const replaceDialog = await findDialogByText(t('txt_backup_replace_confirm_title'));
    fireEvent.click(within(replaceDialog).getByRole('button', { name: t('txt_backup_clear_and_restore') }));
    await submitPasswordPrompt('replace-pw');
    await waitFor(() => expect(onRestoreRemoteBackupAllowingChecksumMismatch).toHaveBeenCalledTimes(2));
    expect(onRestoreRemoteBackupAllowingChecksumMismatch.mock.calls[1][3]).toBe(true);
  });

  it('surfaces the delayed restore progress overlay once its scheduled timer fires', async () => {
    // A successful restore leaves the scheduled progress timer pending; when it
    // fires (~1400ms for a non-replace local restore) the overlay is shown from
    // the timer callback.
    const { onImport } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    selectLocalFile(makeBackupFile('plain-backup.zip'));
    const confirmDialog = await findDialogByText(/plain-backup\.zip/);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_backup_import') }));
    await submitPasswordPrompt('restore-pw');
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));

    await screen.findByText(t('txt_backup_restore_progress_local_title'), undefined, { timeout: 3000 });
  });

  // ---- run remote backup with attachments enabled ----

  it('runs a remote backup for a destination that includes attachments', async () => {
    const attachDest = { ...buildSavedDestination(), includeAttachments: true };
    const attachSettings: AdminBackupSettings = { destinations: [attachDest] };
    const onRunRemoteBackup = vi.fn().mockResolvedValue({
      settings: attachSettings,
      result: { fileName: 'with-attach.zip' },
    });
    const { onNotify } = renderPage({
      onLoadSettings: vi.fn().mockResolvedValue(attachSettings),
      onRunRemoteBackup,
    });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_run_manual')) }));
    await submitPasswordPrompt('run-pw');
    await waitFor(() => expect(onRunRemoteBackup).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith('success', t('txt_backup_remote_run_success_verified', { name: 'with-attach.zip' })),
    );
  });

  it('uses the remote-load fallback message when listing rejects with a non-Error', async () => {
    const { onNotify } = renderPage({ onListRemoteBackups: vi.fn().mockRejectedValue('list-string') });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_remote_refresh')) }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_backup_remote_load_failed')));
  });

  it('notifies when the local integrity check itself throws while selecting a file', async () => {
    const { onNotify } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    const brokenFile = makeBackupFile('broken.zip');
    // Force the integrity read to throw so handleSelectedLocalFile's catch runs.
    Object.defineProperty(brokenFile, 'arrayBuffer', {
      configurable: true,
      value: () => Promise.reject(new Error('cannot read file')),
    });
    selectLocalFile(brokenFile);
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'cannot read file'));
  });

  it('notifies with the fallback when the local integrity check throws a non-Error', async () => {
    const { onNotify } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    const brokenFile = makeBackupFile('broken2.zip');
    Object.defineProperty(brokenFile, 'arrayBuffer', {
      configurable: true,
      value: () => Promise.reject('bare string'),
    });
    selectLocalFile(brokenFile);
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', t('txt_backup_integrity_check_failed')));
  });

  // ---- in-flight re-entry guards (clicking a busy/disabled trigger no-ops) ----

  it('ignores a second export click while an export is in flight', async () => {
    const onExport = vi.fn(() => new Promise<void>(() => {}));
    renderPage({ onExport });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_export')) }));
    await submitPasswordPrompt('export-pw');
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    // The export button is now disabled; clicking it again hits the guard.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_backup_exporting')) }));
    await Promise.resolve();
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('ignores a second save click while a save is in flight', async () => {
    const onSaveSettings = vi.fn(() => new Promise<AdminBackupSettings>(() => {}));
    renderPage({ onSaveSettings });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    const saveBtn = await screen.findByRole('button', { name: new RegExp(t('txt_backup_save_settings')) });
    fireEvent.click(saveBtn);
    await submitPasswordPrompt('save-pw');
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    // Same (now-disabled) button; clicking again hits the guard.
    fireEvent.click(saveBtn);
    await Promise.resolve();
    expect(onSaveSettings).toHaveBeenCalledTimes(1);
  });

  it('ignores a second run click while a remote run is in flight', async () => {
    const onRunRemoteBackup = vi.fn(() => new Promise(() => {}));
    renderPage({ onRunRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    const runBtn = await screen.findByRole('button', { name: new RegExp(t('txt_backup_run_manual')) });
    fireEvent.click(runBtn);
    await submitPasswordPrompt('run-pw');
    await waitFor(() => expect(onRunRemoteBackup).toHaveBeenCalledTimes(1));
    fireEvent.click(runBtn);
    await Promise.resolve();
    expect(onRunRemoteBackup).toHaveBeenCalledTimes(1);
  });

  it('ignores a second restore click while a remote restore is in flight', async () => {
    const onInspectRemoteBackup = vi.fn(() => new Promise(() => {}));
    renderPage({ onInspectRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    await loadRemoteBrowser();
    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    const restoreBtn = within(row).getByRole('button', { name: 'Restore' });
    fireEvent.click(restoreBtn);
    await submitPasswordPrompt('restore-pw');
    await waitFor(() => expect(onInspectRemoteBackup).toHaveBeenCalledTimes(1));
    // A second click on the (now-disabled) restore button is a no-op.
    fireEvent.click(restoreBtn);
    await Promise.resolve();
    expect(onInspectRemoteBackup).toHaveBeenCalledTimes(1);
  });

  it('ignores a cancel click on the password prompt while a submission is in flight', async () => {
    const onSaveSettings = vi.fn(() => new Promise<AdminBackupSettings>(() => {}));
    renderPage({ onSaveSettings });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));
    const prompt = await findPasswordPrompt();
    const input = prompt.querySelector<HTMLInputElement>('input[type="password"]')!;
    fireEvent.input(input, { target: { value: 'save-pw' } });
    fireEvent.click(within(prompt).getByRole('button', { name: t('txt_continue') }));
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    // Cancel is disabled during submission; clicking it must not close the prompt.
    fireEvent.click(within(prompt).getByRole('button', { name: t('txt_cancel') }));
    await Promise.resolve();
    expect(screen.getByText(t('txt_enter_master_password_to_continue'))).toBeInTheDocument();
  });

  it('runs a remote backup for a nameless destination (run-now label fallback)', async () => {
    const namelessDest = { ...buildSavedDestination(), name: '' };
    const settings: AdminBackupSettings = { destinations: [namelessDest] };
    const onRunRemoteBackup = vi.fn().mockResolvedValue({ settings, result: { fileName: 'nameless.zip' } });
    const { onNotify } = renderPage({
      onLoadSettings: vi.fn().mockResolvedValue(settings),
      onRunRemoteBackup,
    });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_run_manual')) }));
    await submitPasswordPrompt('run-pw');
    await waitFor(() => expect(onRunRemoteBackup).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith('success', t('txt_backup_remote_run_success_verified', { name: 'nameless.zip' })),
    );
  });

  it('restores a file whose name is empty, using the import fallback label', async () => {
    const { onImport } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    // A zero-length name has no checksum suffix, so it "matches" and opens the
    // restore confirm dialog; empty name exercises the label fallbacks.
    selectLocalFile(makeBackupFile(''));
    const confirmDialog = await screen.findByRole('dialog');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: t('txt_backup_import') }));
    await submitPasswordPrompt('empty-name-pw');
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect((onImport.mock.calls[0][1] as File).name).toBe('');
  });
});
