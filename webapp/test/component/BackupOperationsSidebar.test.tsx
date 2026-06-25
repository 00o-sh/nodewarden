import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { BackupOperationsSidebar } from '@/components/backup-center/BackupOperationsSidebar';
import { RECOMMENDED_PROVIDERS } from '@/lib/backup-recommendations';

const webDavProviders = RECOMMENDED_PROVIDERS.filter((p) => p.protocol === 'webdav');

function setup(overrides: Record<string, unknown> = {}) {
  const onExport = vi.fn();
  const onImport = vi.fn();
  const onExportIncludeAttachmentsChange = vi.fn();
  const onSelectProvider = vi.fn();
  const props = {
    disableWhileBusy: false,
    exporting: false,
    importing: false,
    exportIncludeAttachments: false,
    selectedProviderId: null,
    recommendedWebDavProviders: webDavProviders,
    recommendedS3Providers: [],
    onExport,
    onImport,
    onExportIncludeAttachmentsChange,
    onSelectProvider,
    ...overrides,
  };
   
  render(<BackupOperationsSidebar {...(props as any)} />);
  return { onExport, onImport, onExportIncludeAttachmentsChange, onSelectProvider };
}

describe('<BackupOperationsSidebar>', () => {
  it('renders the manual backup heading and export/import buttons', () => {
    setup();
    expect(screen.getByText('Manual Backup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Backup/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore/ })).toBeInTheDocument();
  });

  it('shows in-progress labels when exporting/importing', () => {
    setup({ exporting: true, importing: true });
    expect(screen.getByRole('button', { name: /Exporting/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restoring/ })).toBeInTheDocument();
  });

  it('fires onExport and onImport', () => {
    const { onExport, onImport } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Export Backup/ }));
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('disables the actions while busy', () => {
    setup({ disableWhileBusy: true });
    expect(screen.getByRole('button', { name: /Export Backup/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Restore/ })).toBeDisabled();
  });

  it('forwards include-attachments toggles via the embedded field', () => {
    const { onExportIncludeAttachmentsChange } = setup({ exportIncludeAttachments: false });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onExportIncludeAttachmentsChange).toHaveBeenCalledWith(true);
  });

  it('renders the recommended WebDAV providers and fires onSelectProvider', () => {
    const { onSelectProvider } = setup();
    const koofr = screen.getByText('Koofr').closest('button')!;
    fireEvent.click(koofr);
    expect(onSelectProvider).toHaveBeenCalledWith('koofr');
  });

  it('marks the selected provider active', () => {
    setup({ selectedProviderId: 'koofr' });
    const koofr = screen.getByText('Koofr').closest('button')!;
    expect(koofr.className).toContain('active');
  });

  it('renders linked storages for Koofr (a provider that has them)', () => {
    setup();
    expect(screen.getByText('Google Drive')).toBeInTheDocument();
    expect(screen.getByText('Dropbox')).toBeInTheDocument();
  });

  it('shows the empty state when there are no S3 providers', () => {
    setup({ recommendedS3Providers: [] });
    expect(screen.getByText('No recommendations yet.')).toBeInTheDocument();
  });

  it('renders S3 providers when present', () => {
    setup({
      recommendedS3Providers: [
        { id: 'pcloud', name: 'S3 Provider', capacity: '5G', protocol: 's3', signupUrl: '#' },
      ],
    });
    expect(screen.getByText('S3 Provider')).toBeInTheDocument();
    expect(screen.queryByText('No recommendations yet.')).not.toBeInTheDocument();
  });
});
