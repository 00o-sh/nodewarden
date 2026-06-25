import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { BackupDestinationSidebar } from '@/components/backup-center/BackupDestinationSidebar';
import { createBackupDestinationRecord } from '@shared/backup-schema';
import type { BackupDestinationRecord } from '@/lib/api/backup';

function makeDestination(overrides: Partial<BackupDestinationRecord> = {}): BackupDestinationRecord {
  const base = createBackupDestinationRecord('webdav', 1, {
    id: 'dest-1',
    name: 'Primary WebDAV',
    timezone: 'UTC',
  });
  return { ...base, ...overrides } as BackupDestinationRecord;
}

function setup(overrides: Record<string, unknown> = {}) {
  const onSelectDestination = vi.fn();
  const onToggleAddChooser = vi.fn();
  const onAddDestination = vi.fn();
  const props = {
    destinations: [makeDestination()],
    selectedDestinationId: null,
    disableWhileBusy: false,
    showAddChooser: false,
    onSelectDestination,
    onToggleAddChooser,
    onAddDestination,
    ...overrides,
  };
   
  render(<BackupDestinationSidebar {...(props as any)} />);
  return { onSelectDestination, onToggleAddChooser, onAddDestination };
}

describe('<BackupDestinationSidebar>', () => {
  it('renders the title and one entry per destination', () => {
    setup({
      destinations: [
        makeDestination({ id: 'a', name: 'Primary WebDAV' }),
        makeDestination({ id: 'b', name: 'Secondary' }),
      ],
    });
    expect(screen.getByText('Backup Destinations')).toBeInTheDocument();
    expect(screen.getByText('Primary WebDAV')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
  });

  it('falls back to the type label when a destination has no name', () => {
    setup({ destinations: [makeDestination({ id: 'a', name: '' })] });
    // Name span and type span both render the type label "WebDAV".
    expect(screen.getAllByText('WebDAV').length).toBeGreaterThanOrEqual(2);
  });

  it('marks the selected destination active', () => {
    setup({
      destinations: [makeDestination({ id: 'a', name: 'Alpha' })],
      selectedDestinationId: 'a',
    });
    const item = screen.getByText('Alpha').closest('button')!;
    expect(item.className).toContain('active');
  });

  it('shows the idle badge when schedule is disabled and never-run meta', () => {
    setup();
    expect(screen.getByText('Auto Off')).toBeInTheDocument();
    expect(screen.getByText('No successful run yet')).toBeInTheDocument();
  });

  it('shows the active badge when scheduled and last-success meta when present', () => {
    const scheduled = makeDestination({ id: 's', name: 'Scheduled' });
    scheduled.schedule = { ...scheduled.schedule, enabled: true };
    scheduled.runtime = { ...scheduled.runtime, lastSuccessAt: '2024-01-01T00:00:00.000Z' };
    setup({ destinations: [scheduled] });
    expect(screen.getByText('Auto On')).toBeInTheDocument();
    expect(screen.getByText(/Last success:/)).toBeInTheDocument();
  });

  it('fires onSelectDestination with the id when an entry is clicked', () => {
    const { onSelectDestination } = setup({
      destinations: [makeDestination({ id: 'dest-1', name: 'Primary WebDAV' })],
    });
    fireEvent.click(screen.getByText('Primary WebDAV').closest('button')!);
    expect(onSelectDestination).toHaveBeenCalledTimes(1);
    expect(onSelectDestination).toHaveBeenCalledWith('dest-1');
  });

  it('fires onToggleAddChooser when the add button is clicked', () => {
    const { onToggleAddChooser } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Add Destination/ }));
    expect(onToggleAddChooser).toHaveBeenCalledTimes(1);
  });

  it('disables the add button while busy', () => {
    setup({ disableWhileBusy: true });
    expect(screen.getByRole('button', { name: /Add Destination/ })).toBeDisabled();
  });

  it('hides the protocol chooser by default and shows it when enabled', () => {
    const { onAddDestination } = setup({ showAddChooser: false });
    // Only the destination type label exists; no chooser buttons yet.
    expect(screen.queryByRole('button', { name: 'S3' })).not.toBeInTheDocument();

    // Re-render with the chooser open.
    const chooser = setup({ showAddChooser: true });
    const webdavButton = screen.getByRole('button', { name: 'WebDAV' });
    const s3Button = screen.getByRole('button', { name: 'S3' });
    fireEvent.click(webdavButton);
    fireEvent.click(s3Button);
    expect(chooser.onAddDestination).toHaveBeenNthCalledWith(1, 'webdav');
    expect(chooser.onAddDestination).toHaveBeenNthCalledWith(2, 's3');
    // First render's callback never fired.
    expect(onAddDestination).not.toHaveBeenCalled();
  });
});
