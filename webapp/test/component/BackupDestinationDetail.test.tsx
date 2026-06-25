import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';

// The component's onUpdateDestination receives a mutator that closes over the
// live DOM event (it reads event.currentTarget). After the synthetic event
// finishes, currentTarget is nulled, so the mutator must be applied DURING the
// event dispatch — i.e. inside the mock's implementation, against a seed record.
// This helper wires a mock that applies the mutator immediately and returns the
// resulting record for assertions.
function captureUpdate(seed: BackupDestinationRecord) {
  let result: BackupDestinationRecord | null = null;
  const mock = vi.fn((mutator: (d: BackupDestinationRecord) => BackupDestinationRecord) => {
    result = mutator(seed);
  });
  return { mock, getResult: () => result };
}

function inputValue(el: Element, value: string) {
  fireEvent.input(el, { target: { value } });
}

function changeValue(el: Element, value: string) {
  fireEvent.change(el, { target: { value } });
}
import { BackupDestinationDetail } from '@/components/backup-center/BackupDestinationDetail';
import { createBackupDestinationRecord } from '@shared/backup-schema';
import type {
  BackupDestinationRecord,
  S3BackupDestination,
  WebDavBackupDestination,
} from '@/lib/api/backup';
import type { RecommendedProvider } from '@/lib/backup-recommendations';

function makeWebDav(): BackupDestinationRecord {
  return createBackupDestinationRecord('webdav', 1, {
    id: 'dest-webdav',
    name: 'Primary WebDAV',
    timezone: 'UTC',
  });
}

function makeS3(): BackupDestinationRecord {
  return createBackupDestinationRecord('s3', 1, {
    id: 'dest-s3',
    name: 'Bucket',
    timezone: 'UTC',
  });
}

function setup(overrides: Record<string, unknown> = {}) {
  const callbacks = {
    onSaveSettings: vi.fn(),
    onToggleSchedule: vi.fn(),
    onRunRemoteBackup: vi.fn(),
    onPromptDeleteDestination: vi.fn(),
    onUpdateDestination: vi.fn(),
    onRefreshRemoteBrowser: vi.fn(),
    onShowRemoteBrowserPath: vi.fn(),
    onDownloadRemoteBackup: vi.fn(),
    onRestoreRemoteBackup: vi.fn(),
    onPromptDeleteRemoteBackup: vi.fn(),
    onChangeRemoteBrowserPage: vi.fn(),
  };
  const props = {
    selectedRecommendedProvider: null,
    selectedDestination: makeWebDav(),
    selectedDestinationIsSaved: true,
    canRunSelectedDestination: true,
    canBrowseSelectedDestination: true,
    disableWhileBusy: false,
    loadingSettings: false,
    savingSettings: false,
    runningRemoteBackup: false,
    availableTimeZones: ['UTC'],
    remoteBrowser: null,
    remoteBrowserVisibleItems: [],
    remoteBrowserCurrentPage: 1,
    remoteBrowserTotalPages: 1,
    loadingRemoteBrowser: false,
    downloadingRemotePath: '',
    downloadingRemotePercent: null,
    restoringRemotePath: '',
    deletingRemotePath: '',
    ...callbacks,
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<BackupDestinationDetail {...(props as any)} />);
  return callbacks;
}

describe('<BackupDestinationDetail>', () => {
  it('shows a placeholder prompt when no destination is selected', () => {
    setup({ selectedDestination: null });
    expect(screen.getByText('Select a backup destination from the list first.')).toBeInTheDocument();
    // Action buttons are not rendered without a destination.
    expect(screen.queryByRole('button', { name: /Save Settings/ })).not.toBeInTheDocument();
  });

  it('renders the action buttons and destination form for a selected destination', () => {
    setup();
    expect(screen.getByText('Destination Details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Settings/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run Manually/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Primary WebDAV')).toBeInTheDocument();
  });

  it('fires save / delete / run callbacks', () => {
    const { onSaveSettings, onPromptDeleteDestination, onRunRemoteBackup } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Save Settings/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: /Run Manually/ }));
    expect(onSaveSettings).toHaveBeenCalledTimes(1);
    expect(onPromptDeleteDestination).toHaveBeenCalledTimes(1);
    expect(onRunRemoteBackup).toHaveBeenCalledTimes(1);
  });

  it('shows Enable when schedule disabled and Disable when enabled, both wired to onToggleSchedule', () => {
    const off = setup();
    const enableBtn = screen.getByRole('button', { name: 'Enable' });
    fireEvent.click(enableBtn);
    expect(off.onToggleSchedule).toHaveBeenCalledTimes(1);

    const scheduled = makeWebDav();
    scheduled.schedule = { ...scheduled.schedule, enabled: true };
    setup({ selectedDestination: scheduled });
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('shows the saving label while saving', () => {
    setup({ savingSettings: true });
    expect(screen.getByRole('button', { name: /Saving/ })).toBeInTheDocument();
  });

  it('disables Run Manually when the destination cannot run', () => {
    setup({ canRunSelectedDestination: false });
    expect(screen.getByRole('button', { name: /Run Manually/ })).toBeDisabled();
  });

  it('updates the destination name via onUpdateDestination mutator', () => {
    const { mock, getResult } = captureUpdate(makeWebDav());
    setup({ onUpdateDestination: mock });
    inputValue(screen.getByDisplayValue('Primary WebDAV'), 'Renamed');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(getResult()!.name).toBe('Renamed');
  });

  it('updates the interval via the text input', () => {
    const { mock, getResult } = captureUpdate(makeWebDav());
    setup({ onUpdateDestination: mock });
    inputValue(screen.getByDisplayValue('24'), '6');
    expect(getResult()!.schedule.intervalHours).toBe(6);
  });

  it('updates the interval via a preset button', () => {
    const { mock, getResult } = captureUpdate(makeWebDav());
    setup({ onUpdateDestination: mock });
    fireEvent.click(screen.getByRole('button', { name: '12' }));
    expect(getResult()!.schedule.intervalHours).toBe(12);
  });

  it('updates the timezone via the select', () => {
    const { mock, getResult } = captureUpdate(makeWebDav());
    setup({ onUpdateDestination: mock });
    const tzSelect = screen.getByRole('combobox') as HTMLSelectElement;
    changeValue(tzSelect, 'Europe/London');
    expect(getResult()!.schedule.timezone).toBe('Europe/London');
  });

  it('clamps the interval input between 1 and 99', () => {
    const { mock, getResult } = captureUpdate(makeWebDav());
    setup({ onUpdateDestination: mock });
    inputValue(screen.getByDisplayValue('24'), '999');
    expect(getResult()!.schedule.intervalHours).toBe(99);
  });

  it('renders WebDAV-specific fields and updates the base URL', () => {
    const { mock, getResult } = captureUpdate(makeWebDav());
    setup({ onUpdateDestination: mock });
    inputValue(screen.getByPlaceholderText('https://dav.example.com/remote.php/dav/files/admin'), 'https://dav.test');
    expect((getResult()!.destination as WebDavBackupDestination).baseUrl).toBe('https://dav.test');
  });

  it('renders S3-specific fields and updates the endpoint', () => {
    const { mock, getResult } = captureUpdate(makeS3());
    setup({ selectedDestination: makeS3(), onUpdateDestination: mock });
    expect(screen.getByText('Destination Details')).toBeInTheDocument();
    inputValue(screen.getByPlaceholderText('https://s3.example.com'), 'https://s3.test');
    expect((getResult()!.destination as S3BackupDestination).endpoint).toBe('https://s3.test');
  });

  it('updates the S3 addressing style via the select', () => {
    const { mock, getResult } = captureUpdate(makeS3());
    setup({ selectedDestination: makeS3(), onUpdateDestination: mock });
    // The S3 addressing-style select is the second combobox (after timezone).
    const selects = screen.getAllByRole('combobox');
    const addressingSelect = selects[selects.length - 1] as HTMLSelectElement;
    changeValue(addressingSelect, 'virtual-hosted-style');
    expect((getResult()!.destination as S3BackupDestination).addressingStyle).toBe('virtual-hosted-style');
  });

  it('does not render WebDAV fields when an S3 destination is selected', () => {
    setup({ selectedDestination: makeS3() });
    expect(screen.queryByPlaceholderText('https://dav.example.com/remote.php/dav/files/admin')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://s3.example.com')).toBeInTheDocument();
  });

  it('renders a recommended-provider card instead of the form when one is selected', () => {
    const provider: RecommendedProvider = {
      id: 'pcloud',
      name: 'pCloud',
      capacity: '10G',
      protocol: 'webdav',
      signupUrl: 'https://example.com/signup',
      hasAffiliateLink: true,
    };
    setup({ selectedRecommendedProvider: provider });
    expect(screen.getByText('pCloud')).toBeInTheDocument();
    expect(screen.getByText('10G')).toBeInTheDocument();
    // No destination form / save button in the recommendation view.
    expect(screen.queryByRole('button', { name: /Save Settings/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Destination Details')).not.toBeInTheDocument();
  });

  it('forwards remote-browser save-first state through to the embedded browser', () => {
    setup({ selectedDestinationIsSaved: false, remoteBrowser: null });
    expect(screen.getByText('Save this destination first before browsing its remote backup files.')).toBeInTheDocument();
  });
});
