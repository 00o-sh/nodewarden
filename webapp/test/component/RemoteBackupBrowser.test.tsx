import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { RemoteBackupBrowser } from '@/components/backup-center/RemoteBackupBrowser';
import type { RemoteBackupBrowserResponse, RemoteBackupItem } from '@/lib/api/backup';

function makeBrowser(overrides: Partial<RemoteBackupBrowserResponse> = {}): RemoteBackupBrowserResponse {
  return {
    object: 'backup-remote-browser',
    destinationId: 'dest-1',
    destinationName: 'Primary',
    provider: 'webdav',
    currentPath: '',
    parentPath: null,
    items: [],
    ...overrides,
  };
}

const dirItem: RemoteBackupItem = {
  path: 'folder',
  name: 'folder',
  isDirectory: true,
  size: null,
  modifiedAt: '2024-01-01T00:00:00.000Z',
};

const zipItem: RemoteBackupItem = {
  path: 'backup.zip',
  name: 'backup.zip',
  isDirectory: false,
  size: 2048,
  modifiedAt: '2024-01-02T00:00:00.000Z',
};

function setup(overrides: Record<string, unknown> = {}) {
  const callbacks = {
    onRefresh: vi.fn(),
    onShowPath: vi.fn(),
    onDownload: vi.fn(),
    onRestore: vi.fn(),
    onPromptDelete: vi.fn(),
    onChangePage: vi.fn(),
  };
  const browser = overrides.remoteBrowser !== undefined
    ? (overrides.remoteBrowser as RemoteBackupBrowserResponse | null)
    : makeBrowser({ items: [dirItem, zipItem] });
  const props = {
    canBrowse: true,
    destinationIsSaved: true,
    disableWhileBusy: false,
    loadingRemoteBrowser: false,
    remoteBrowser: browser,
    visibleItems: browser ? browser.items : [],
    currentPage: 1,
    totalPages: 1,
    downloadingRemotePath: '',
    downloadingRemotePercent: null,
    restoringRemotePath: '',
    deletingRemotePath: '',
    ...callbacks,
    ...overrides,
  };
   
  render(<RemoteBackupBrowser {...(props as any)} />);
  return callbacks;
}

describe('<RemoteBackupBrowser>', () => {
  it('shows the save-first message when the destination is not saved', () => {
    setup({ destinationIsSaved: false, remoteBrowser: null });
    expect(screen.getByText('Save this destination first before browsing its remote backup files.')).toBeInTheDocument();
  });

  it('shows the cached-empty message when saved but no browser loaded', () => {
    setup({ destinationIsSaved: true, remoteBrowser: null });
    expect(screen.getByText('Click Refresh to load this destination.')).toBeInTheDocument();
  });

  it('hides the refresh button when browsing is not allowed', () => {
    setup({ canBrowse: false });
    expect(screen.queryByRole('button', { name: /Refresh/ })).not.toBeInTheDocument();
  });

  it('fires onRefresh when the refresh button is clicked', () => {
    const { onRefresh } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders the current path and a loading state', () => {
    setup({ loadingRemoteBrowser: true });
    expect(screen.getByText('Loading remote backups...')).toBeInTheDocument();
    // Root displayed as "/" when currentPath is empty.
    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('navigates to root and disables Up when at the top level', () => {
    const { onShowPath } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Root/ }));
    expect(onShowPath).toHaveBeenCalledWith('');
    expect(screen.getByRole('button', { name: /Up/ })).toBeDisabled();
  });

  it('navigates up to the parent path when available', () => {
    const { onShowPath } = setup({
      remoteBrowser: makeBrowser({ currentPath: 'a/b', parentPath: 'a', items: [zipItem] }),
      visibleItems: [zipItem],
    });
    const upButton = screen.getByRole('button', { name: /Up/ });
    expect(upButton).not.toBeDisabled();
    fireEvent.click(upButton);
    expect(onShowPath).toHaveBeenCalledWith('a');
  });

  it('opens a directory via the entry and the Open action', () => {
    const { onShowPath } = setup();
    // The entry button is labeled with the folder name.
    fireEvent.click(screen.getByText('folder').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /Open/ }));
    expect(onShowPath).toHaveBeenNthCalledWith(1, 'folder');
    expect(onShowPath).toHaveBeenNthCalledWith(2, 'folder');
  });

  it('fires download/restore/delete callbacks for a zip file', () => {
    const { onDownload, onRestore, onPromptDelete } = setup();
    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Download/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(onDownload).toHaveBeenCalledWith('backup.zip');
    expect(onRestore).toHaveBeenCalledWith('backup.zip');
    expect(onPromptDelete).toHaveBeenCalledWith('backup.zip');
  });

  it('reflects in-progress download percent, restoring, and deleting labels', () => {
    setup({
      downloadingRemotePath: 'backup.zip',
      downloadingRemotePercent: 42,
      restoringRemotePath: 'backup.zip',
      deletingRemotePath: 'backup.zip',
    });
    const row = screen.getByText('backup.zip').closest('.backup-browser-row') as HTMLElement;
    expect(within(row).getByText('Downloading 42%')).toBeInTheDocument();
    expect(within(row).getByText('Restoring...')).toBeInTheDocument();
    expect(within(row).getByText('Deleting...')).toBeInTheDocument();
  });

  it('shows the empty-folder message when there are no items', () => {
    setup({ remoteBrowser: makeBrowser({ items: [] }), visibleItems: [] });
    expect(screen.getByText('No backup files found in this folder.')).toBeInTheDocument();
  });

  it('renders pagination only when there is more than one page and changes page', () => {
    const { onChangePage } = setup({
      remoteBrowser: makeBrowser({ items: [zipItem] }),
      visibleItems: [zipItem],
      currentPage: 2,
      totalPages: 3,
    });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    const prev = screen.getByRole('button', { name: 'Prev' });
    const next = screen.getByRole('button', { name: 'Next' });
    expect(prev).not.toBeDisabled();
    fireEvent.click(prev);
    expect(onChangePage).toHaveBeenCalledWith(1);
    fireEvent.click(next);
    expect(onChangePage).toHaveBeenCalledWith(3);
  });

  it('does not render pagination for a single page', () => {
    setup({ totalPages: 1 });
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });
});
