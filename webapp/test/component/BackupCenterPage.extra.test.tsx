import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import BackupCenterPage from '@/components/BackupCenterPage';
import type { AdminBackupSettings } from '@/lib/api/backup';
import { createBackupDestinationRecord } from '@shared/backup-schema';
import { t } from '@/lib/i18n';

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
    onRunRemoteBackup: vi.fn().mockResolvedValue({
      settings: buildSettings(),
      result: { fileName: 'backup-2026.zip' },
    }),
    onListRemoteBackups: vi.fn().mockResolvedValue({ items: [] }),
    onDownloadRemoteBackup: vi.fn().mockResolvedValue(undefined),
    onInspectRemoteBackup: vi.fn().mockResolvedValue({}),
    onDeleteRemoteBackup: vi.fn().mockResolvedValue(undefined),
    onRestoreRemoteBackup: vi.fn().mockResolvedValue({}),
    onRestoreRemoteBackupAllowingChecksumMismatch: vi.fn().mockResolvedValue({}),
    onNotify: vi.fn(),
    ...overrides,
  };
   
  render(<BackupCenterPage {...(props as any)} />);
  return props;
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

describe('<BackupCenterPage> extra', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('routes save-settings through the master-password gate then forwards the password', async () => {
    const { onSaveSettings } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));

    // Gate holds before the password is supplied.
    await findPasswordPrompt();
    expect(onSaveSettings).not.toHaveBeenCalled();

    await submitPasswordPrompt('save-pw');
    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));
    expect(onSaveSettings.mock.calls[0][0]).toBe('save-pw');
  });

  it('notifies success after saving settings', async () => {
    const { onNotify } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));
    await submitPasswordPrompt('save-pw');
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', t('txt_backup_settings_saved')));
  });

  it('surfaces an error when saving settings fails', async () => {
    const onSaveSettings = vi.fn().mockRejectedValue(new Error('save-blew-up'));
    const { onNotify } = renderPage({ onSaveSettings });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));
    await submitPasswordPrompt('save-pw');
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'save-blew-up'));
  });

  it('cancels the master-password prompt without invoking any action', async () => {
    const { onSaveSettings } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_save_settings')) }));
    const prompt = await findPasswordPrompt();
    fireEvent.click(within(prompt).getByRole('button', { name: t('txt_cancel') }));
    await waitFor(() => {
      expect(screen.queryByText(t('txt_enter_master_password_to_continue'))).not.toBeInTheDocument();
    });
    expect(onSaveSettings).not.toHaveBeenCalled();
  });

  it('adds a new WebDAV destination via the add-destination chooser', async () => {
    renderPage();
    await screen.findByText('Primary WebDAV');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_backup_add_destination')) }));
    // The protocol chooser appears with WebDAV / S3 options.
    const webdavBtn = await screen.findByRole('button', { name: t('txt_backup_protocol_webdav') });
    fireEvent.click(webdavBtn);

    // A second WebDAV destination is created and auto-selected (default name "WebDAV 2").
    await waitFor(() => expect(screen.getByText('WebDAV 2')).toBeInTheDocument());
  });

  it('adds a new S3 destination via the add-destination chooser', async () => {
    renderPage();
    await screen.findByText('Primary WebDAV');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('txt_backup_add_destination')) }));
    fireEvent.click(await screen.findByRole('button', { name: t('txt_backup_protocol_s3') }));
    await waitFor(() => expect(screen.getByText('S3 1')).toBeInTheDocument());
  });

  it('runs a remote backup through the gate and notifies the verified result', async () => {
    const { onRunRemoteBackup, onNotify } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_run_manual')) }));
    await findPasswordPrompt();
    expect(onRunRemoteBackup).not.toHaveBeenCalled();

    await submitPasswordPrompt('run-pw');
    await waitFor(() => expect(onRunRemoteBackup).toHaveBeenCalledTimes(1));
    expect(onRunRemoteBackup.mock.calls[0][0]).toBe('run-pw');
    expect(onRunRemoteBackup.mock.calls[0][1]).toBe(DESTINATION_ID);
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith('success', t('txt_backup_remote_run_success_verified', { name: 'backup-2026.zip' }))
    );
  });

  it('notifies an error when a remote backup run fails', async () => {
    const onRunRemoteBackup = vi.fn().mockRejectedValue(new Error('remote-run-failed'));
    const { onNotify } = renderPage({ onRunRemoteBackup });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_run_manual')) }));
    await submitPasswordPrompt('run-pw');
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'remote-run-failed'));
  });

  it('lists remote backups for the saved destination when refresh is clicked', async () => {
    const { onListRemoteBackups } = renderPage();
    await screen.findByText(t('txt_backup_destination_detail_title'));
    // The browser refresh button drives onListRemoteBackups for the saved
    // destination at the current (empty) path.
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_remote_refresh')) }));
    await waitFor(() => expect(onListRemoteBackups).toHaveBeenCalled());
    expect(onListRemoteBackups.mock.calls[0][0]).toBe(DESTINATION_ID);
  });

  it('notifies an error when listing remote backups fails', async () => {
    const onListRemoteBackups = vi.fn().mockRejectedValue(new Error('list-failed'));
    const { onNotify } = renderPage({ onListRemoteBackups });
    await screen.findByText(t('txt_backup_destination_detail_title'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('txt_backup_remote_refresh')) }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'list-failed'));
  });

  it('reports an error and notifies when the settings load fails', async () => {
    const onLoadSettings = vi.fn().mockRejectedValue(new Error('load-failed'));
    const { onNotify } = renderPage({ onLoadSettings });
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', 'load-failed'));
  });
});
