import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import BackupCenterPage from '@/components/BackupCenterPage';
import type { AdminBackupSettings } from '@/lib/api/backup';
import { createBackupDestinationRecord } from '@shared/backup-schema';

// A behavioral regression guard for a security fix: deleting a backup
// destination persists a mutated settings payload, so it MUST go through the
// same master-password verification gate as saving settings. A prior bug let
// the delete skip the gate / pass the wrong args. These tests pin the gate.

const DESTINATION_ID = 'dest-to-delete';

function buildSavedDestination() {
  // createBackupDestinationRecord produces a valid SAVED destination fixture
  // with the schedule + runtime fields the detail panel needs to render.
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
  // onSaveSettings echoes back whatever it is handed, mimicking the real API
  // which returns the persisted settings.
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
    onRunRemoteBackup: vi.fn().mockResolvedValue({}),
    onListRemoteBackups: vi.fn().mockResolvedValue({ items: [] }),
    onDownloadRemoteBackup: vi.fn().mockResolvedValue(undefined),
    onInspectRemoteBackup: vi.fn().mockResolvedValue({}),
    onDeleteRemoteBackup: vi.fn().mockResolvedValue(undefined),
    onRestoreRemoteBackup: vi.fn().mockResolvedValue({}),
    onRestoreRemoteBackupAllowingChecksumMismatch: vi.fn().mockResolvedValue({}),
    onNotify: vi.fn(),
    ...overrides,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<BackupCenterPage {...(props as any)} />);
  return props;
}

// Returns the open master-password prompt dialog (the one containing the
// master-password input). Other ConfirmDialogs may linger briefly while their
// close animation runs, so we identify the prompt by its password field.
async function findPasswordPrompt() {
  return waitFor(() => {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
    const prompt = dialogs.find((dialog) => (
      within(dialog).queryByText('Enter your master password to continue.')
      && dialog.querySelector('input[type="password"]')
    ));
    expect(prompt, 'master-password prompt dialog should be open').toBeTruthy();
    return prompt!;
  });
}

describe('<BackupCenterPage> delete password gate', () => {
  it('shows the loaded destination after settings load', async () => {
    renderPage();
    expect(await screen.findByText('Primary WebDAV')).toBeInTheDocument();
  });

  it('blocks the destructive save until the master password is entered, then forwards it', async () => {
    const { onSaveSettings } = renderPage();

    // 1. Wait for settings to load; the single destination is auto-selected,
    //    so the detail panel (and its Delete trigger) renders.
    await screen.findByText('Destination Details');

    // 2. Trigger delete via the danger button in the detail panel actions.
    const deleteTrigger = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(deleteTrigger);

    // The confirm dialog appears (title "Delete", confirm button "Delete").
    const confirmDialog = await waitFor(() => {
      const dialog = screen
        .getAllByRole('dialog')
        .find((node) => within(node).queryByText(/Delete this destination|delete the destination|Primary WebDAV/i));
      expect(dialog).toBeTruthy();
      return dialog as HTMLElement;
    });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));

    // 3. The master-password prompt must appear AND no save may have happened.
    const passwordPrompt = await findPasswordPrompt();
    expect(within(passwordPrompt).getByText('Enter your master password to continue.')).toBeInTheDocument();
    expect(onSaveSettings).not.toHaveBeenCalled();

    // 4. Enter the password and submit; only now does the destructive save run.
    const passwordInput = passwordPrompt.querySelector<HTMLInputElement>('input[type="password"]')!;
    fireEvent.input(passwordInput, { target: { value: 'hunter2' } });
    fireEvent.click(within(passwordPrompt).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onSaveSettings).toHaveBeenCalledTimes(1));

    const [password, savedSettings] = onSaveSettings.mock.calls[0];
    expect(password).toBe('hunter2');
    expect(savedSettings.destinations.some((d: { id: string }) => d.id === DESTINATION_ID)).toBe(false);
    expect(savedSettings.destinations).toHaveLength(0);
  });

  it('routes the export action through the same master-password prompt', async () => {
    const { onExport } = renderPage();
    await screen.findByText('Destination Details');

    fireEvent.click(await screen.findByRole('button', { name: 'Export Backup' }));

    const passwordPrompt = await findPasswordPrompt();
    expect(within(passwordPrompt).getByText('Enter your master password to continue.')).toBeInTheDocument();
    // Gate holds before the password is supplied.
    expect(onExport).not.toHaveBeenCalled();

    const passwordInput = passwordPrompt.querySelector<HTMLInputElement>('input[type="password"]')!;
    fireEvent.input(passwordInput, { target: { value: 'export-pw' } });
    fireEvent.click(within(passwordPrompt).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    expect(onExport.mock.calls[0][0]).toBe('export-pw');
  });
});
