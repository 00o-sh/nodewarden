import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/preact';

// Richer child mocks than VaultPage.test.tsx: these surface the orchestration
// wiring we want to cover — bulk-selection state, the sidebar filter changes
// (archive / trash / folder), loading & error panes, and the dialog-open flows
// plumbed through VaultDialogs.

vi.mock('@/components/vault/VaultSidebar', () => ({
  default: (props: any) => (
    <div data-testid="sidebar">
      <span data-testid="sidebar-filter">{JSON.stringify(props.sidebarFilter)}</span>
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'archive' })}>filter-archive</button>
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'trash' })}>filter-trash</button>
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'favorite' })}>filter-favorite</button>
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'folder', folderId: 'f1' })}>filter-folder</button>
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'folder', folderId: null })}>filter-no-folder</button>
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'type', value: 'card' })}>filter-cards</button>
      <button type="button" onClick={props.onOpenCreateFolder}>open-create-folder</button>
      <button type="button" onClick={() => props.onOpenDeleteFolder({ id: 'f1', name: 'Work', decName: 'Work' })}>open-delete-folder</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultListPanel', () => ({
  default: (props: any) => (
    <div data-testid="list-panel">
      <span data-testid="selected-count">{props.selectedCount}</span>
      <span data-testid="total-count">{props.totalCipherCount}</span>
      <span data-testid="list-error">{props.error}</span>
      <span data-testid="list-loading">{String(props.loading)}</span>
      <ul>
        {props.filteredCiphers.map((cipher: any) => (
          <li key={cipher.id}>
            <button type="button" data-testid={`select-${cipher.id}`} onClick={() => props.onSelectCipher(cipher.id)}>
              {cipher.decName}
            </button>
            <button
              type="button"
              data-testid={`check-${cipher.id}`}
              onClick={() => props.onToggleSelected(cipher.id, !props.selectedMap[cipher.id])}
            >
              toggle-{cipher.id}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" data-testid="select-all" onClick={props.onSelectAll}>select-all</button>
      <button type="button" data-testid="clear-selection" onClick={props.onClearSelection}>clear-selection</button>
      <button type="button" data-testid="open-bulk-delete" onClick={props.onOpenBulkDelete}>open-bulk-delete</button>
      <button type="button" data-testid="open-bulk-archive" onClick={props.onBulkArchive}>open-bulk-archive</button>
      <button type="button" data-testid="open-move" onClick={props.onOpenMove}>open-move</button>
      <button type="button" data-testid="bulk-restore" onClick={props.onBulkRestore}>bulk-restore</button>
      <button type="button" data-testid="bulk-unarchive" onClick={props.onBulkUnarchive}>bulk-unarchive</button>
      <button type="button" data-testid="start-create" onClick={() => props.onStartCreate(3)}>start-create-card</button>
      <button type="button" data-testid="sync" onClick={props.onSyncVault}>sync</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultDetailView', () => ({
  default: (props: any) => (
    <div data-testid="detail-view">
      <span data-testid="detail-name">{props.selectedCipher?.decName}</span>
      <button type="button" onClick={props.onStartEdit}>start-edit</button>
      <button type="button" onClick={() => props.onArchive(props.selectedCipher)}>detail-archive</button>
      <button type="button" onClick={() => props.onDelete(props.selectedCipher)}>detail-delete</button>
      <button type="button" onClick={() => props.onUnarchive(props.selectedCipher)}>detail-unarchive</button>
      <button type="button" onClick={() => props.onRestore(props.selectedCipher)}>detail-restore</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultEditor', () => ({
  default: (props: any) => (
    <div data-testid="editor">
      <span data-testid="editor-mode">{props.isCreating ? 'create' : 'edit'}</span>
      <button type="button" onClick={props.onCancel}>editor-cancel</button>
      <button type="button" onClick={props.onDeleteSelected}>editor-delete</button>
      <button type="button" onClick={props.onOpenFieldModal}>editor-open-field</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultDialogs', () => ({
  default: (props: any) => (
    <div data-testid="dialogs">
      <span data-testid="dlg-bulk-delete-open">{String(props.bulkDeleteOpen)}</span>
      <span data-testid="dlg-bulk-archive-open">{String(props.bulkArchiveOpen)}</span>
      <span data-testid="dlg-move-open">{String(props.moveOpen)}</span>
      <span data-testid="dlg-archive-confirm-open">{String(props.archiveConfirmOpen)}</span>
      <span data-testid="dlg-delete-open">{String(props.pendingDeleteOpen)}</span>
      <span data-testid="dlg-field-open">{String(props.fieldModalOpen)}</span>
      <span data-testid="dlg-create-folder-open">{String(props.createFolderOpen)}</span>
      <span data-testid="dlg-delete-folder">{String(!!props.pendingDeleteFolder)}</span>
      <span data-testid="dlg-trash-mode">{String(props.sidebarTrashMode)}</span>
      <span data-testid="dlg-selected-count">{props.selectedCount}</span>
      <button type="button" data-testid="confirm-bulk-delete" onClick={props.onConfirmBulkDelete}>confirm-bulk-delete</button>
      <button type="button" data-testid="confirm-bulk-archive" onClick={props.onConfirmBulkArchive}>confirm-bulk-archive</button>
      <button type="button" data-testid="confirm-move" onClick={props.onConfirmMove}>confirm-move</button>
      <button type="button" data-testid="confirm-archive" onClick={props.onConfirmArchive}>confirm-archive</button>
      <button type="button" data-testid="confirm-delete" onClick={props.onConfirmDelete}>confirm-delete</button>
      <button type="button" data-testid="confirm-create-folder" onClick={props.onConfirmCreateFolder}>confirm-create-folder</button>
      <button type="button" data-testid="confirm-delete-folder" onClick={props.onConfirmDeleteFolder}>confirm-delete-folder</button>
      <button type="button" data-testid="set-folder-name" onClick={() => props.onNewFolderNameChange('Personal')}>set-folder-name</button>
    </div>
  ),
}));

import VaultPage from '@/components/VaultPage';
import type { Cipher, Folder } from '@/lib/types';

function makeCipher(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'c1',
    type: 1,
    decName: 'GitHub',
    folderId: 'f1',
    revisionDate: '2024-01-02T00:00:00Z',
    creationDate: '2024-01-01T00:00:00Z',
    login: { decUsername: 'octocat', decPassword: 'pw', uris: [] },
    ...overrides,
  } as Cipher;
}

function setup(overrides: Partial<Parameters<typeof VaultPage>[0]> = {}) {
  const ciphers: Cipher[] = overrides.ciphers ?? [
    makeCipher({ id: 'c1', decName: 'GitHub' }),
    makeCipher({ id: 'c2', decName: 'GitLab', folderId: '' }),
    makeCipher({ id: 'c3', decName: 'Archived', archivedDate: '2024-01-01T00:00:00Z' }),
    makeCipher({ id: 'c4', decName: 'Trashed', deletedDate: '2024-01-01T00:00:00Z' }),
    makeCipher({ id: 'c5', decName: 'A Card', type: 3, card: { decBrand: 'visa', decNumber: '4111111111111234' } }),
  ];
  const folders: Folder[] = [{ id: 'f1', name: 'Work', decName: 'Work' }];
  const props: Parameters<typeof VaultPage>[0] = {
    ciphers,
    folders,
    loading: false,
    error: '',
    emailForReprompt: 'user@example.com',
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onArchive: vi.fn().mockResolvedValue(undefined),
    onUnarchive: vi.fn().mockResolvedValue(undefined),
    onRestore: vi.fn().mockResolvedValue(undefined),
    onBulkDelete: vi.fn().mockResolvedValue(undefined),
    onBulkPermanentDelete: vi.fn().mockResolvedValue(undefined),
    onBulkRestore: vi.fn().mockResolvedValue(undefined),
    onBulkArchive: vi.fn().mockResolvedValue(undefined),
    onBulkUnarchive: vi.fn().mockResolvedValue(undefined),
    onBulkMove: vi.fn().mockResolvedValue(undefined),
    onVerifyMasterPassword: vi.fn().mockResolvedValue(undefined),
    onNotify: vi.fn(),
    onCreateFolder: vi.fn().mockResolvedValue(undefined),
    onRenameFolder: vi.fn().mockResolvedValue(undefined),
    onDeleteFolder: vi.fn().mockResolvedValue(undefined),
    onBulkDeleteFolders: vi.fn().mockResolvedValue(undefined),
    onDownloadAttachment: vi.fn().mockResolvedValue(undefined),
    downloadingAttachmentKey: '',
    attachmentDownloadPercent: null,
    uploadingAttachmentName: '',
    attachmentUploadPercent: null,
    mobileSidebarToggleKey: 0,
    ...overrides,
  };
  const utils = render(<VaultPage {...props} />);
  return { ...utils, props };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('<VaultPage> extra coverage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hides archived and trashed ciphers from the default (all) view', () => {
    setup();
    expect(screen.getByTestId('select-c1')).toBeInTheDocument();
    expect(screen.getByTestId('select-c2')).toBeInTheDocument();
    expect(screen.getByTestId('select-c5')).toBeInTheDocument();
    expect(screen.queryByTestId('select-c3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('select-c4')).not.toBeInTheDocument();
  });

  it('shows only archived ciphers under the archive filter', () => {
    setup();
    fireEvent.click(screen.getByText('filter-archive'));
    expect(screen.getByTestId('select-c3')).toBeInTheDocument();
    expect(screen.queryByTestId('select-c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('dlg-trash-mode')).toHaveTextContent('false');
  });

  it('shows only trashed ciphers under the trash filter and reports trash mode', () => {
    setup();
    fireEvent.click(screen.getByText('filter-trash'));
    expect(screen.getByTestId('select-c4')).toBeInTheDocument();
    expect(screen.queryByTestId('select-c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('dlg-trash-mode')).toHaveTextContent('true');
  });

  it('filters by folder id and by no-folder', () => {
    setup();
    fireEvent.click(screen.getByText('filter-folder'));
    // f1 contains c1 and c5; c2 has no folder.
    expect(screen.getByTestId('select-c1')).toBeInTheDocument();
    expect(screen.getByTestId('select-c5')).toBeInTheDocument();
    expect(screen.queryByTestId('select-c2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('filter-no-folder'));
    expect(screen.getByTestId('select-c2')).toBeInTheDocument();
    expect(screen.queryByTestId('select-c1')).not.toBeInTheDocument();
  });

  it('filters by type (cards only)', () => {
    setup();
    fireEvent.click(screen.getByText('filter-cards'));
    expect(screen.getByTestId('select-c5')).toBeInTheDocument();
    expect(screen.queryByTestId('select-c1')).not.toBeInTheDocument();
  });

  it('filters by favorite (none favorited yields an empty list)', () => {
    setup();
    fireEvent.click(screen.getByText('filter-favorite'));
    expect(screen.queryByTestId('select-c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('total-count')).toHaveTextContent('0');
  });

  it('tracks bulk selection counts via toggle and select-all', () => {
    setup();
    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
    fireEvent.click(screen.getByTestId('check-c1'));
    expect(screen.getByTestId('selected-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('check-c2'));
    expect(screen.getByTestId('selected-count')).toHaveTextContent('2');
    // Toggling c1 off drops the count.
    fireEvent.click(screen.getByTestId('check-c1'));
    expect(screen.getByTestId('selected-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('select-all'));
    // All visible (non-archived/non-trashed) ciphers: c1, c2, c5.
    expect(screen.getByTestId('selected-count')).toHaveTextContent('3');
    fireEvent.click(screen.getByTestId('clear-selection'));
    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
  });

  it('opens and confirms the bulk-delete dialog (normal mode → onBulkDelete)', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('check-c1'));
    fireEvent.click(screen.getByTestId('check-c2'));
    fireEvent.click(screen.getByTestId('open-bulk-delete'));
    expect(screen.getByTestId('dlg-bulk-delete-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('confirm-bulk-delete'));
    await act(flush);
    expect(props.onBulkDelete).toHaveBeenCalledTimes(1);
    expect(props.onBulkDelete.mock.calls[0][0].sort()).toEqual(['c1', 'c2']);
    // Selection is cleared after a successful bulk delete.
    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
  });

  it('routes bulk delete to permanent delete inside the trash filter', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('filter-trash'));
    fireEvent.click(screen.getByTestId('check-c4'));
    fireEvent.click(screen.getByTestId('open-bulk-delete'));
    fireEvent.click(screen.getByTestId('confirm-bulk-delete'));
    await act(flush);
    expect(props.onBulkPermanentDelete).toHaveBeenCalledWith(['c4']);
    expect(props.onBulkDelete).not.toHaveBeenCalled();
  });

  it('opens and confirms the bulk-archive dialog', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('check-c1'));
    fireEvent.click(screen.getByTestId('open-bulk-archive'));
    expect(screen.getByTestId('dlg-bulk-archive-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('confirm-bulk-archive'));
    await act(flush);
    expect(props.onBulkArchive).toHaveBeenCalledWith(['c1']);
  });

  it('opens and confirms the bulk-move dialog', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('check-c1'));
    fireEvent.click(screen.getByTestId('open-move'));
    expect(screen.getByTestId('dlg-move-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('confirm-move'));
    await act(flush);
    // Default move target is "__none__" → null folderId.
    expect(props.onBulkMove).toHaveBeenCalledWith(['c1'], null);
  });

  it('runs bulk restore directly from the list panel', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('filter-trash'));
    fireEvent.click(screen.getByTestId('check-c4'));
    fireEvent.click(screen.getByTestId('bulk-restore'));
    await act(flush);
    expect(props.onBulkRestore).toHaveBeenCalledWith(['c4']);
  });

  it('runs bulk unarchive directly from the list panel', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('filter-archive'));
    fireEvent.click(screen.getByTestId('check-c3'));
    fireEvent.click(screen.getByTestId('bulk-unarchive'));
    await act(flush);
    expect(props.onBulkUnarchive).toHaveBeenCalledWith(['c3']);
  });

  it('archives a single item through the detail confirm dialog', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('detail-archive'));
    expect(screen.getByTestId('dlg-archive-confirm-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('confirm-archive'));
    await act(flush);
    expect(props.onArchive).toHaveBeenCalledTimes(1);
  });

  it('deletes a single item through the detail confirm dialog', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('detail-delete'));
    expect(screen.getByTestId('dlg-delete-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('confirm-delete'));
    await act(flush);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('unarchives and restores a single item directly', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('detail-unarchive'));
    await act(flush);
    expect(props.onBulkUnarchive).toHaveBeenCalledWith(['c1']);
    fireEvent.click(screen.getByText('detail-restore'));
    await act(flush);
    expect(props.onRestore).toHaveBeenCalledWith(['c1']);
  });

  it('opens the add-field modal from the editor', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByText('editor-open-field'));
    expect(screen.getByTestId('dlg-field-open')).toHaveTextContent('true');
  });

  it('opens the delete dialog from the editor delete button', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByText('editor-delete'));
    expect(screen.getByTestId('dlg-delete-open')).toHaveTextContent('true');
  });

  it('starts a create flow for a chosen type from the list panel', () => {
    setup();
    fireEvent.click(screen.getByTestId('start-create'));
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.getByTestId('editor-mode')).toHaveTextContent('create');
  });

  it('creates a folder through the create-folder dialog', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('open-create-folder'));
    expect(screen.getByTestId('dlg-create-folder-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('set-folder-name'));
    fireEvent.click(screen.getByTestId('confirm-create-folder'));
    await act(flush);
    expect(props.onCreateFolder).toHaveBeenCalledWith('Personal');
  });

  it('deletes a folder and resets a folder filter back to all', async () => {
    const { props } = setup();
    // Move to the folder filter for f1, then delete it.
    fireEvent.click(screen.getByText('filter-folder'));
    expect(screen.getByTestId('sidebar-filter')).toHaveTextContent('"folder"');
    fireEvent.click(screen.getByText('open-delete-folder'));
    expect(screen.getByTestId('dlg-delete-folder')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('confirm-delete-folder'));
    await act(flush);
    expect(props.onDeleteFolder).toHaveBeenCalledWith('f1');
    expect(screen.getByTestId('sidebar-filter')).toHaveTextContent('"all"');
  });

  it('syncs the vault through the refresh callback', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('sync'));
    await act(flush);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows the loading pane when loading with no selection', () => {
    setup({ ciphers: [], loading: true });
    expect(screen.queryByText('Select an item')).not.toBeInTheDocument();
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument();
  });

  it('shows the error pane with a retry button when there is an error and no ciphers', async () => {
    const { props } = setup({ ciphers: [], error: 'Sync failed' });
    const errorPane = document.querySelector('.detail-col .vault-error-state') as HTMLElement;
    expect(errorPane).not.toBeNull();
    expect(errorPane).toHaveTextContent('Sync failed');
    fireEvent.click(within(errorPane).getByRole('button', { name: 'Retry sync' }));
    await act(flush);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('passes the error string into the list panel', () => {
    setup({ error: 'boom' });
    expect(screen.getByTestId('list-error')).toHaveTextContent('boom');
  });
});
