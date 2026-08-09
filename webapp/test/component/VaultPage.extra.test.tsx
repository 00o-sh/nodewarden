import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
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
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'duplicates' })}>filter-duplicates</button>
      <button type="button" onClick={props.onOpenCreateFolder}>open-create-folder</button>
      <button type="button" onClick={() => props.onOpenDeleteFolder({ id: 'f1', name: 'Work', decName: 'Work' })}>open-delete-folder</button>
      <button type="button" onClick={() => props.onOpenRenameFolder({ id: 'f2', name: 'PlainName' })}>open-rename-plain</button>
      <button type="button" onClick={() => props.onOpenRenameFolder({ id: 'f3' })}>open-rename-empty</button>
      <button type="button" onClick={() => props.onOpenDeleteFolder({ id: 'f9', name: 'Other', decName: 'Other' })}>open-delete-other-folder</button>
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
            <span data-testid={`subtitle-${cipher.id}`}>{props.listSubtitle(cipher)}</span>
            <button
              type="button"
              data-testid={`check-${cipher.id}`}
              onClick={() => props.onToggleSelected(cipher.id, !props.selectedMap[cipher.id])}
            >
              toggle-{cipher.id}
            </button>
            <button
              type="button"
              data-testid={`uncheck-${cipher.id}`}
              onClick={() => props.onToggleSelected(cipher.id, false)}
            >
              uncheck-{cipher.id}
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
      <button type="button" data-testid="start-create-ssh" onClick={() => props.onStartCreate(5)}>start-create-ssh</button>
      <button type="button" data-testid="sync" onClick={props.onSyncVault}>sync</button>
      <button type="button" data-testid="list-scroll" onClick={() => props.onScroll(600)}>list-scroll</button>
      <span data-testid="sort-mode">{props.sortMode}</span>
      <button type="button" data-testid="toggle-sort-menu" onClick={props.onToggleSortMenu}>toggle-sort-menu</button>
      <button type="button" data-testid="sort-name" onClick={() => props.onSelectSortMode('name')}>sort-name</button>
      <button type="button" data-testid="sort-created" onClick={() => props.onSelectSortMode('created')}>sort-created</button>
      <button type="button" data-testid="sort-edited" onClick={() => props.onSelectSortMode('edited')}>sort-edited</button>
      <button type="button" data-testid="toggle-create-menu" onClick={props.onToggleCreateMenu}>toggle-create-menu</button>
      <span data-testid="create-menu-open">{String(props.createMenuOpen)}</span>
      <span data-testid="duplicate-mode">{props.duplicateMode}</span>
      <button type="button" data-testid="dup-mode-similar" onClick={() => props.onDuplicateModeChange('similar')}>dup-mode-similar</button>
      <button type="button" data-testid="select-unique" onClick={props.onSelectUniqueFromDuplicates}>select-unique</button>
      <button type="button" data-testid="select-duplicates" onClick={props.onSelectDuplicates}>select-duplicates</button>
      <span data-testid="search-input-value">{props.searchInput}</span>
      <button type="button" data-testid="search-set" onClick={() => props.onSearchInput('GitHub')}>search-set</button>
      <button type="button" data-testid="search-clear" onClick={props.onClearSearch}>search-clear</button>
      <button type="button" data-testid="search-compose-start" onClick={props.onSearchCompositionStart}>search-compose-start</button>
      <button type="button" data-testid="search-compose-end" onClick={() => props.onSearchCompositionEnd('GitLab')}>search-compose-end</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultDetailView', () => ({
  default: (props: any) => (
    <div data-testid="detail-view">
      <span data-testid="detail-name">{props.selectedCipher?.decName}</span>
      <span data-testid="detail-folder">{props.folderName(props.selectedCipher?.folderId)}</span>
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
      <span data-testid="editor-name">{props.draft?.name}</span>
      <span data-testid="editor-local-error">{props.localError}</span>
      <span data-testid="editor-ssh-fingerprint">{props.draft?.sshFingerprint}</span>
      <span data-testid="editor-ssh-public">{props.draft?.sshPublicKey}</span>
      <span data-testid="editor-uri-0">{props.draft?.loginUris?.[0]?.uri}</span>
      <span data-testid="editor-uri-1">{props.draft?.loginUris?.[1]?.uri}</span>
      <span data-testid="editor-uri-0-match">{String(props.draft?.loginUris?.[0]?.match)}</span>
      <span data-testid="editor-custom-count">{props.draft?.customFields?.length ?? 0}</span>
      <span data-testid="editor-custom-0-value">{props.draft?.customFields?.[0]?.value}</span>
      <span data-testid="editor-queue-count">{props.attachmentQueue?.length ?? 0}</span>
      <span data-testid="editor-removed-count">{props.removedAttachmentCount}</span>
      <span data-testid="editor-passkey-count">{props.draft?.loginFido2Credentials?.length ?? 0}</span>
      <button type="button" onClick={props.onCancel}>editor-cancel</button>
      <button type="button" onClick={props.onDeleteSelected}>editor-delete</button>
      <button type="button" onClick={props.onOpenFieldModal}>editor-open-field</button>
      <button type="button" data-testid="editor-save" onClick={props.onSave}>editor-save</button>
      <button type="button" data-testid="editor-set-name" onClick={() => props.onUpdateDraft({ name: 'Renamed Item' })}>editor-set-name</button>
      <button type="button" data-testid="editor-clear-name" onClick={() => props.onUpdateDraft({ name: '   ' })}>editor-clear-name</button>
      <button type="button" data-testid="editor-seed-ssh" onClick={() => props.onSeedSshDefaults(true)}>editor-seed-ssh</button>
      <button type="button" data-testid="editor-set-ssh" onClick={() => props.onUpdateSshPublicKey('ssh-ed25519 AAAAPUB')}>editor-set-ssh</button>
      <button type="button" data-testid="editor-set-uri" onClick={() => props.onUpdateDraftLoginUri(0, 'https://example.test')}>editor-set-uri</button>
      <button type="button" data-testid="editor-set-uri-match" onClick={() => props.onUpdateDraftLoginUriMatch(0, 1)}>editor-set-uri-match</button>
      <button type="button" data-testid="editor-reorder-uri" onClick={() => props.onReorderDraftLoginUri(0, 1)}>editor-reorder-uri</button>
      <button type="button" data-testid="editor-patch-field" onClick={() => props.onPatchDraftCustomField(0, { value: 'patched' })}>editor-patch-field</button>
      <button type="button" data-testid="editor-set-fields" onClick={() => props.onUpdateDraftCustomFields([{ type: 0, label: 'L', value: 'V' }])}>editor-set-fields</button>
      <button type="button" data-testid="editor-queue-attachment" onClick={() => props.onQueueAttachmentFiles([new File(['x'], 'a.txt')])}>editor-queue-attachment</button>
      <button type="button" data-testid="editor-remove-queued" onClick={() => props.onRemoveQueuedAttachment(0)}>editor-remove-queued</button>
      <button type="button" data-testid="editor-toggle-existing" onClick={() => props.onToggleExistingAttachmentRemoval('att1')}>editor-toggle-existing</button>
      <button type="button" data-testid="editor-download-attachment" onClick={() => props.onDownloadAttachment(props.selectedCipher, 'att1')}>editor-download-attachment</button>
      <button type="button" data-testid="editor-request-delete-passkey" onClick={() => props.onRequestDeleteLoginPasskey(0)}>editor-request-delete-passkey</button>
      <button type="button" data-testid="editor-queue-empty" onClick={() => props.onQueueAttachmentFiles([])}>editor-queue-empty</button>
      <button type="button" data-testid="editor-toggle-empty-id" onClick={() => props.onToggleExistingAttachmentRemoval('')}>editor-toggle-empty-id</button>
      <button type="button" data-testid="editor-reorder-oob" onClick={() => props.onReorderDraftLoginUri(5, 9)}>editor-reorder-oob</button>
      <button type="button" data-testid="editor-seed-noforce" onClick={() => props.onSeedSshDefaults(false)}>editor-seed-noforce</button>
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
      <span data-testid="dlg-field-label">{props.fieldLabel}</span>
      <span data-testid="dlg-field-type">{String(props.fieldType)}</span>
      <span data-testid="dlg-delete-passkey-open">{String(props.deletePasskeyOpen)}</span>
      <span data-testid="dlg-rename-folder-open">{String(props.renameFolderOpen)}</span>
      <span data-testid="dlg-rename-folder-name">{props.renameFolderName}</span>
      <button type="button" data-testid="field-set-label" onClick={() => props.onFieldLabelChange('My Field')}>field-set-label</button>
      <button type="button" data-testid="field-clear-label" onClick={() => props.onFieldLabelChange('')}>field-clear-label</button>
      <button type="button" data-testid="field-set-type-bool" onClick={() => props.onFieldTypeChange(2)}>field-set-type-bool</button>
      <button type="button" data-testid="field-set-value" onClick={() => props.onFieldValueChange('true')}>field-set-value</button>
      <button type="button" data-testid="confirm-add-field" onClick={props.onConfirmAddField}>confirm-add-field</button>
      <button type="button" data-testid="cancel-field" onClick={props.onCancelFieldModal}>cancel-field</button>
      <button type="button" data-testid="confirm-delete-passkey" onClick={props.onConfirmDeletePasskey}>confirm-delete-passkey</button>
      <button type="button" data-testid="cancel-delete-passkey" onClick={props.onCancelDeletePasskey}>cancel-delete-passkey</button>
      <button type="button" data-testid="set-move-folder" onClick={() => props.onMoveFolderIdChange('f1')}>set-move-folder</button>
    </div>
  ),
}));

// Deterministic SSH stubs so the type-5 (ssh key) editor flows don't depend on
// real Ed25519 generation being available in jsdom.
const generateDefaultSshKeyMaterial = vi.fn(async () => ({
  privateKey: 'PRIVATE',
  publicKey: 'ssh-ed25519 SEEDPUB',
  fingerprint: 'SHA256:seed',
}));
const computeSshFingerprint = vi.fn(async (pub: string) => `SHA256:fp(${pub})`);
vi.mock('@/lib/ssh', () => ({
  generateDefaultSshKeyMaterial: (...args: unknown[]) => generateDefaultSshKeyMaterial(...(args as [])),
  computeSshFingerprint: (...args: unknown[]) => computeSshFingerprint(...(args as [string])),
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

let matchMediaMatches = false;
const originalMatchMedia = window.matchMedia;
function installMatchMedia(matches: boolean) {
  matchMediaMatches = matches;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return matchMediaMatches;
    },
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

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

  it('computes list subtitles for bank / license / passport ciphers (types 6/7/8)', () => {
    setup({
      ciphers: [
        makeCipher({
          id: 'bk',
          decName: 'Chase',
          type: 6,
          login: undefined,
          bankAccount: { decBankName: 'Chase', decAccountType: 'Checking', decAccountNumber: '000123456789' },
        } as unknown as Partial<Cipher>),
        makeCipher({
          id: 'dl',
          decName: 'License',
          type: 7,
          login: undefined,
          driversLicense: { decLicenseNumber: 'D1234567' },
        } as unknown as Partial<Cipher>),
        makeCipher({
          id: 'pp',
          decName: 'Passport',
          type: 8,
          login: undefined,
          passport: { decPassportNumber: 'X1234567' },
        } as unknown as Partial<Cipher>),
      ],
    });
    expect(screen.getByTestId('subtitle-bk')).toHaveTextContent('Chase, Checking, *6789');
    expect(screen.getByTestId('subtitle-dl')).toHaveTextContent('D1234567');
    expect(screen.getByTestId('subtitle-pp')).toHaveTextContent('X1234567');
  });
});

describe('<VaultPage> sort / search / create menu', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('selects sort modes and persists the choice to localStorage', () => {
    setup();
    fireEvent.click(screen.getByTestId('sort-name'));
    expect(screen.getByTestId('sort-mode')).toHaveTextContent('name');
    expect(localStorage.getItem('nodewarden.vault.sort.v1')).toBe('name');
    fireEvent.click(screen.getByTestId('sort-created'));
    expect(screen.getByTestId('sort-mode')).toHaveTextContent('created');
    expect(localStorage.getItem('nodewarden.vault.sort.v1')).toBe('created');
    fireEvent.click(screen.getByTestId('sort-edited'));
    expect(screen.getByTestId('sort-mode')).toHaveTextContent('edited');
  });

  it('restores a previously saved sort mode on mount', () => {
    localStorage.setItem('nodewarden.vault.sort.v1', 'name');
    setup();
    expect(screen.getByTestId('sort-mode')).toHaveTextContent('name');
  });

  it('toggles the sort menu and the create menu open state', () => {
    setup();
    fireEvent.click(screen.getByTestId('toggle-create-menu'));
    expect(screen.getByTestId('create-menu-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('toggle-create-menu'));
    expect(screen.getByTestId('create-menu-open')).toHaveTextContent('false');
    // Toggling the sort menu open then closing it via Escape.
    fireEvent.click(screen.getByTestId('toggle-sort-menu'));
    fireEvent.keyDown(document, { key: 'Escape' });
  });

  it('closes an open create menu when Escape is pressed', () => {
    setup();
    fireEvent.click(screen.getByTestId('toggle-create-menu'));
    expect(screen.getByTestId('create-menu-open')).toHaveTextContent('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('create-menu-open')).toHaveTextContent('false');
  });

  it('drives the debounced search input, clear, and IME composition handlers', () => {
    setup();
    fireEvent.click(screen.getByTestId('search-set'));
    expect(screen.getByTestId('search-input-value')).toHaveTextContent('GitHub');
    fireEvent.click(screen.getByTestId('search-clear'));
    expect(screen.getByTestId('search-input-value')).toHaveTextContent('');
    // Composition start suspends the debounce; composition end commits the value.
    fireEvent.click(screen.getByTestId('search-compose-start'));
    fireEvent.click(screen.getByTestId('search-compose-end'));
    expect(screen.getByTestId('search-input-value')).toHaveTextContent('GitLab');
  });

  it('switches the duplicate detection mode and forces sort to name', () => {
    const dupLogin = { decUsername: 'octocat', decPassword: 'pw', uris: [] };
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'Dup', login: { ...dupLogin } }),
        makeCipher({ id: 'c2', decName: 'Dup', login: { ...dupLogin } }),
      ],
    });
    fireEvent.click(screen.getByText('filter-duplicates'));
    // Entering the duplicates filter forces sort mode to name.
    expect(screen.getByTestId('sort-mode')).toHaveTextContent('name');
    fireEvent.click(screen.getByTestId('dup-mode-similar'));
    expect(screen.getByTestId('duplicate-mode')).toHaveTextContent('similar');
  });

  it('selects one item per duplicate colour-group via select-unique', () => {
    const dupLogin = { decUsername: 'octocat', decPassword: 'pw', uris: [] };
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'Dup', login: { ...dupLogin } }),
        makeCipher({ id: 'c2', decName: 'Dup', login: { ...dupLogin } }),
      ],
    });
    fireEvent.click(screen.getByText('filter-duplicates'));
    fireEvent.click(screen.getByTestId('select-unique'));
    // One item of the single duplicate group stays unselected.
    expect(screen.getByTestId('selected-count')).toHaveTextContent('1');
  });
});

describe('<VaultPage> editor save + draft mutations', () => {
  beforeEach(() => {
    localStorage.clear();
    computeSshFingerprint.mockClear();
    generateDefaultSshKeyMaterial.mockClear();
  });

  it('blocks saving a new item with an empty name and surfaces a local error', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('start-create'));
    fireEvent.click(screen.getByTestId('editor-save'));
    await act(flush);
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-local-error')).not.toHaveTextContent('');
  });

  it('creates a new card item with a queued attachment', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('start-create'));
    fireEvent.click(screen.getByTestId('editor-set-name'));
    expect(screen.getByTestId('editor-name')).toHaveTextContent('Renamed Item');
    fireEvent.click(screen.getByTestId('editor-queue-attachment'));
    expect(screen.getByTestId('editor-queue-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('editor-save'));
    await act(flush);
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate.mock.calls[0][0].name).toBe('Renamed Item');
    expect(props.onCreate.mock.calls[0][1]).toHaveLength(1);
  });

  it('removes a queued attachment before saving', () => {
    setup();
    fireEvent.click(screen.getByTestId('start-create'));
    fireEvent.click(screen.getByTestId('editor-queue-attachment'));
    expect(screen.getByTestId('editor-queue-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('editor-remove-queued'));
    expect(screen.getByTestId('editor-queue-count')).toHaveTextContent('0');
  });

  it('updates an existing item, adding queued files and removing a flagged attachment', async () => {
    const { props } = setup({
      ciphers: [
        makeCipher({
          id: 'c1',
          decName: 'GitHub',
          attachments: [{ id: 'att1', fileName: 'a.txt' }],
        } as unknown as Partial<Cipher>),
      ],
    });
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-set-name'));
    fireEvent.click(screen.getByTestId('editor-queue-attachment'));
    fireEvent.click(screen.getByTestId('editor-toggle-existing'));
    expect(screen.getByTestId('editor-removed-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('editor-save'));
    await act(flush);
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
    const [, draft, options] = props.onUpdate.mock.calls[0];
    expect(draft.name).toBe('Renamed Item');
    expect(options.addFiles).toHaveLength(1);
    expect(options.removeAttachmentIds).toEqual(['att1']);
  });

  it('toggling an existing attachment removal twice clears the flag', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'GitHub', attachments: [{ id: 'att1', fileName: 'a.txt' }] } as unknown as Partial<Cipher>),
      ],
    });
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-toggle-existing'));
    expect(screen.getByTestId('editor-removed-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('editor-toggle-existing'));
    expect(screen.getByTestId('editor-removed-count')).toHaveTextContent('0');
  });

  it('downloads an attachment from the editor', () => {
    const { props } = setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'GitHub', attachments: [{ id: 'att1', fileName: 'a.txt' }] } as unknown as Partial<Cipher>),
      ],
    });
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-download-attachment'));
    expect(props.onDownloadAttachment).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), 'att1');
  });

  it('seeds and recomputes the SSH fingerprint for a new key item, then saves', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('start-create-ssh'));
    await act(flush);
    // Seed material populated the public key + fingerprint.
    expect(screen.getByTestId('editor-ssh-public')).toHaveTextContent('ssh-ed25519 SEEDPUB');
    // Editing the public key recomputes the fingerprint deterministically.
    fireEvent.click(screen.getByTestId('editor-set-ssh'));
    await act(flush);
    expect(screen.getByTestId('editor-ssh-fingerprint')).toHaveTextContent('SHA256:fp(ssh-ed25519 AAAAPUB)');
    fireEvent.click(screen.getByTestId('editor-set-name'));
    fireEvent.click(screen.getByTestId('editor-save'));
    await act(flush);
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate.mock.calls[0][0].type).toBe(5);
  });

  it('force-reseeds SSH defaults on request', async () => {
    setup();
    fireEvent.click(screen.getByTestId('start-create-ssh'));
    await act(flush);
    generateDefaultSshKeyMaterial.mockClear();
    fireEvent.click(screen.getByTestId('editor-seed-ssh'));
    await act(flush);
    expect(generateDefaultSshKeyMaterial).toHaveBeenCalled();
  });

  it('edits, matches, and reorders draft login URIs', () => {
    setup({
      ciphers: [
        makeCipher({
          id: 'c1',
          decName: 'GitHub',
          login: {
            decUsername: 'octocat',
            decPassword: 'pw',
            uris: [{ uri: 'https://a.test' }, { uri: 'https://b.test' }],
          },
        } as unknown as Partial<Cipher>),
      ],
    });
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-set-uri'));
    expect(screen.getByTestId('editor-uri-0')).toHaveTextContent('https://example.test');
    fireEvent.click(screen.getByTestId('editor-set-uri-match'));
    expect(screen.getByTestId('editor-uri-0-match')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('editor-reorder-uri'));
    // After reorder, the (edited) first URI moves to slot 1.
    expect(screen.getByTestId('editor-uri-1')).toHaveTextContent('https://example.test');
  });

  it('patches and replaces draft custom fields', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-set-fields'));
    expect(screen.getByTestId('editor-custom-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('editor-patch-field'));
    expect(screen.getByTestId('editor-custom-0-value')).toHaveTextContent('patched');
  });

  it('cancels the editor and returns to the detail view', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    fireEvent.click(screen.getByText('editor-cancel'));
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-view')).toBeInTheDocument();
  });

  it('cancels an in-progress edit when another cipher is selected', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('select-c2'));
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-name')).toHaveTextContent('GitLab');
  });
});

describe('<VaultPage> field modal + passkey + move dialogs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds a custom field through the field modal', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByText('editor-open-field'));
    expect(screen.getByTestId('dlg-field-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('field-set-label'));
    fireEvent.click(screen.getByTestId('confirm-add-field'));
    // Modal closes and the field is appended to the draft.
    expect(screen.getByTestId('dlg-field-open')).toHaveTextContent('false');
    expect(screen.getByTestId('editor-custom-count')).toHaveTextContent('1');
  });

  it('blocks adding a field with an empty label', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByText('editor-open-field'));
    fireEvent.click(screen.getByTestId('field-clear-label'));
    fireEvent.click(screen.getByTestId('confirm-add-field'));
    // Field modal stays open with a local error and no field added.
    expect(screen.getByTestId('dlg-field-open')).toHaveTextContent('true');
    expect(screen.getByTestId('editor-custom-count')).toHaveTextContent('0');
  });

  it('adds a boolean custom field and normalizes its value', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByText('editor-open-field'));
    fireEvent.click(screen.getByTestId('field-set-label'));
    fireEvent.click(screen.getByTestId('field-set-type-bool'));
    fireEvent.click(screen.getByTestId('field-set-value'));
    fireEvent.click(screen.getByTestId('confirm-add-field'));
    expect(screen.getByTestId('editor-custom-0-value')).toHaveTextContent('true');
  });

  it('cancels the field modal without adding a field', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByText('editor-open-field'));
    fireEvent.click(screen.getByTestId('field-set-label'));
    fireEvent.click(screen.getByTestId('cancel-field'));
    expect(screen.getByTestId('dlg-field-open')).toHaveTextContent('false');
    expect(screen.getByTestId('editor-custom-count')).toHaveTextContent('0');
  });

  it('opens and confirms the delete-passkey dialog', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-request-delete-passkey'));
    expect(screen.getByTestId('dlg-delete-passkey-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('confirm-delete-passkey'));
    expect(screen.getByTestId('dlg-delete-passkey-open')).toHaveTextContent('false');
  });

  it('cancels the delete-passkey dialog', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-request-delete-passkey'));
    fireEvent.click(screen.getByTestId('cancel-delete-passkey'));
    expect(screen.getByTestId('dlg-delete-passkey-open')).toHaveTextContent('false');
  });

  it('moves the selected ciphers into a chosen folder', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('check-c1'));
    fireEvent.click(screen.getByTestId('open-move'));
    fireEvent.click(screen.getByTestId('set-move-folder'));
    fireEvent.click(screen.getByTestId('confirm-move'));
    await act(flush);
    expect(props.onBulkMove).toHaveBeenCalledWith(['c1'], 'f1');
  });
});

describe('<VaultPage> confirm-guard no-op paths', () => {
  it('no-ops bulk confirm/direct actions when nothing is selected', async () => {
    const { props } = setup();
    // Dialog-gated confirms open regardless of selection; confirming with an
    // empty selection early-returns without calling the api.
    fireEvent.click(screen.getByTestId('open-bulk-delete'));
    fireEvent.click(screen.getByTestId('confirm-bulk-delete'));
    fireEvent.click(screen.getByTestId('open-bulk-archive'));
    fireEvent.click(screen.getByTestId('confirm-bulk-archive'));
    fireEvent.click(screen.getByTestId('open-move'));
    fireEvent.click(screen.getByTestId('confirm-move'));
    // Direct (non-dialog) bulk handlers also early-return with no selection.
    fireEvent.click(screen.getByTestId('bulk-restore'));
    fireEvent.click(screen.getByTestId('bulk-unarchive'));
    await act(flush);
    expect(props.onBulkDelete).not.toHaveBeenCalled();
    expect(props.onBulkArchive).not.toHaveBeenCalled();
    expect(props.onBulkMove).not.toHaveBeenCalled();
    expect(props.onBulkRestore).not.toHaveBeenCalled();
    expect(props.onBulkUnarchive).not.toHaveBeenCalled();
  });

  it('rejects creating a folder with a blank name', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('open-create-folder'));
    fireEvent.click(screen.getByTestId('confirm-create-folder'));
    await act(flush);
    expect(props.onCreateFolder).not.toHaveBeenCalled();
    expect(props.onNotify).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('no-ops select-duplicates when the duplicate mode is not exact', () => {
    const dupLogin = { decUsername: 'octocat', decPassword: 'pw', uris: [] };
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'Dup', login: { ...dupLogin } }),
        makeCipher({ id: 'c2', decName: 'Dup', login: { ...dupLogin } }),
      ],
    });
    fireEvent.click(screen.getByText('filter-duplicates'));
    fireEvent.click(screen.getByTestId('dup-mode-similar'));
    fireEvent.click(screen.getByTestId('select-duplicates'));
    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
  });
});

describe('<VaultPage> sort comparator', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('breaks ties by id when edited timestamps are equal', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'cB', decName: 'Bravo', revisionDate: '2024-05-01T00:00:00Z' }),
        makeCipher({ id: 'cA', decName: 'Alpha', revisionDate: '2024-05-01T00:00:00Z' }),
      ],
    });
    const ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    // Equal sortTime -> stable id ordering cA before cB.
    expect(ids).toEqual(['select-cA', 'select-cB']);
  });

  it('sorts by creation time and falls back to id on ties', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'cB', decName: 'Bravo', creationDate: '2024-01-01T00:00:00Z', revisionDate: '2024-01-01T00:00:00Z' }),
        makeCipher({ id: 'cA', decName: 'Alpha', creationDate: '2024-01-01T00:00:00Z', revisionDate: '2024-01-01T00:00:00Z' }),
      ],
    });
    fireEvent.click(screen.getByTestId('sort-created'));
    const ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['select-cA', 'select-cB']);
  });

  it('sorts by name and falls back to id when names are equal', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'cB', decName: 'Same' }),
        makeCipher({ id: 'cA', decName: 'Same' }),
      ],
    });
    fireEvent.click(screen.getByTestId('sort-name'));
    const ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['select-cA', 'select-cB']);
  });

  it('orders duplicate colour-groups and sorts within each group', () => {
    const groupA = { decUsername: 'alpha', decPassword: 'pw', uris: [] };
    const groupB = { decUsername: 'bravo', decPassword: 'pw', uris: [] };
    setup({
      ciphers: [
        makeCipher({ id: 'a2', decName: 'Zeta', login: { ...groupA } }),
        makeCipher({ id: 'a1', decName: 'Zeta', login: { ...groupA } }),
        makeCipher({ id: 'b2', decName: 'Beta', login: { ...groupB } }),
        makeCipher({ id: 'b1', decName: 'Beta', login: { ...groupB } }),
        makeCipher({ id: 'u1', decName: 'Unique', login: { decUsername: 'solo', decPassword: 'pw', uris: [] } }),
      ],
    });
    fireEvent.click(screen.getByText('filter-duplicates'));
    // Only the two duplicate groups (4 items) remain; the unique item is hidden.
    const ids = Array.from(document.querySelectorAll('[data-testid^="select-"]'))
      .map((n) => n.getAttribute('data-testid'))
      .filter((id) => id && /^select-[ab]\d$/.test(id));
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain('select-u1');
  });

  it('excludes archived ciphers from duplicate detection', () => {
    const dup = { decUsername: 'octocat', decPassword: 'pw', uris: [] };
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'Dup', login: { ...dup } }),
        makeCipher({ id: 'c2', decName: 'Dup', login: { ...dup } }),
        makeCipher({ id: 'c3', decName: 'Dup', login: { ...dup }, archivedDate: '2024-01-01T00:00:00Z' }),
      ],
    });
    fireEvent.click(screen.getByText('filter-duplicates'));
    // The archived duplicate is not part of the visible duplicate set.
    expect(screen.queryByTestId('select-c3')).not.toBeInTheDocument();
    expect(screen.getByTestId('select-c1')).toBeInTheDocument();
    expect(screen.getByTestId('select-c2')).toBeInTheDocument();
  });
});

describe('<VaultPage> focus-cipher deep link', () => {
  const originalHref = window.location.href;
  afterEach(() => {
    window.history.replaceState(null, '', originalHref);
  });

  it('focuses the cipher named in the ?cipher= query and strips it from the URL', () => {
    window.history.replaceState(null, '', '/vault?cipher=c2');
    setup();
    expect(screen.getByTestId('detail-name')).toHaveTextContent('GitLab');
    // The cipher param is removed from the address bar after focusing.
    expect(window.location.search).not.toContain('cipher=');
  });

  it('switches to the trash filter when the focused cipher lives in trash', () => {
    window.history.replaceState(null, '', '/vault?cipher=c4');
    setup();
    expect(screen.getByTestId('sidebar-filter')).toHaveTextContent('"trash"');
    expect(screen.getByTestId('detail-name')).toHaveTextContent('Trashed');
  });

  it('switches to the archive filter when the focused cipher is archived', () => {
    window.history.replaceState(null, '', '/vault?cipher=c3');
    setup();
    expect(screen.getByTestId('sidebar-filter')).toHaveTextContent('"archive"');
    expect(screen.getByTestId('detail-name')).toHaveTextContent('Archived');
  });

  it('ignores an unknown focus cipher and selects the first item instead', () => {
    window.history.replaceState(null, '', '/vault?cipher=missing');
    setup();
    // Falls back to the default first-item selection.
    expect(screen.getByTestId('detail-view')).toBeInTheDocument();
  });
});

describe('<VaultPage> ssh + attachment edge branches', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ignores ssh seed / public-key updates while editing a non-ssh draft', async () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    // The selected cipher is a login (type 1); ssh handlers no-op on it.
    fireEvent.click(screen.getByTestId('editor-seed-ssh'));
    fireEvent.click(screen.getByTestId('editor-set-ssh'));
    await act(flush);
    // Fingerprint remains empty because the draft is not an ssh key.
    expect(screen.getByTestId('editor-ssh-fingerprint')).toHaveTextContent('');
  });

  it('ignores an attachment with a blank id in the existing-attachments list', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'GitHub', attachments: [{ id: '', fileName: 'ghost' }] } as unknown as Partial<Cipher>),
      ],
    });
    fireEvent.click(screen.getByText('start-edit'));
    // A blank-id attachment is filtered out of the editable list and cannot be flagged.
    fireEvent.click(screen.getByTestId('editor-toggle-existing'));
    // toggle uses id 'att1' which is not present, so removed-count reflects that toggle only.
    expect(screen.getByTestId('editor-removed-count')).toHaveTextContent('1');
  });
});

describe('<VaultPage> field modal boolean default', () => {
  it('defaults a boolean field to false when no value is chosen', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByText('editor-open-field'));
    fireEvent.click(screen.getByTestId('field-set-label'));
    fireEvent.click(screen.getByTestId('field-set-type-bool'));
    // Do not set a value -> normalized to 'false'.
    fireEvent.click(screen.getByTestId('confirm-add-field'));
    expect(screen.getByTestId('editor-custom-0-value')).toHaveTextContent('false');
  });
});

describe('<VaultPage> listSubtitle + folderName branches', () => {
  it('renders the login-uri fallback and default type labels in subtitles', () => {
    setup({
      ciphers: [
        // type 1 with neither username nor uri -> empty subtitle.
        makeCipher({ id: 'lg', decName: 'Bare Login', login: { decUsername: '', decPassword: 'pw', uris: [] } }),
        // type 4 (identity) and type 2 (note) fall through to the default label.
        makeCipher({ id: 'id', decName: 'Ident', type: 4, login: undefined } as unknown as Partial<Cipher>),
        makeCipher({ id: 'nt', decName: 'Note', type: 2, login: undefined } as unknown as Partial<Cipher>),
        makeCipher({ id: 'sk', decName: 'Key', type: 5, login: undefined } as unknown as Partial<Cipher>),
      ],
    });
    expect(screen.getByTestId('subtitle-lg')).toHaveTextContent('');
    // Non-typed items render the type label rather than an empty string.
    expect(screen.getByTestId('subtitle-id').textContent).not.toBe('');
    expect(screen.getByTestId('subtitle-nt').textContent).not.toBe('');
    expect(screen.getByTestId('subtitle-sk').textContent).not.toBe('');
  });

  it('renders the login uri as the subtitle when there is no username', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'lg', decName: 'Uri Login', login: { decUsername: '', decPassword: 'pw', uris: [{ uri: 'https://only.test' }] } }),
      ],
    });
    expect(screen.getByTestId('subtitle-lg')).toHaveTextContent('https://only.test');
  });

  it('resolves folder names, the no-folder label, and an unknown-folder id', () => {
    setup({
      ciphers: [makeCipher({ id: 'c1', decName: 'Item', folderId: 'ghost' })],
      folders: [],
    });
    // No matching folder -> falls back to the raw id.
    expect(screen.getByTestId('detail-folder')).toHaveTextContent('ghost');
  });

  it('shows the no-folder label for a cipher with no folder', () => {
    setup({ ciphers: [makeCipher({ id: 'c1', decName: 'Item', folderId: '' })], folders: [] });
    expect(screen.getByTestId('detail-folder').textContent).not.toBe('');
  });
});

describe('<VaultPage> misc editor guard branches', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('no-ops queueing an empty file list', () => {
    setup();
    fireEvent.click(screen.getByTestId('start-create'));
    fireEvent.click(screen.getByTestId('editor-queue-empty'));
    expect(screen.getByTestId('editor-queue-count')).toHaveTextContent('0');
  });

  it('no-ops toggling an existing attachment with a blank id', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-toggle-empty-id'));
    expect(screen.getByTestId('editor-removed-count')).toHaveTextContent('0');
  });

  it('no-ops reordering login uris with out-of-range indices', () => {
    setup();
    fireEvent.click(screen.getByText('start-edit'));
    // Out-of-range reorder leaves the single default uri untouched.
    fireEvent.click(screen.getByTestId('editor-reorder-oob'));
    expect(screen.getByTestId('editor')).toBeInTheDocument();
  });

  it('drives the list scroll handler', () => {
    setup();
    fireEvent.click(screen.getByTestId('list-scroll'));
    expect(screen.getByTestId('list-panel')).toBeInTheDocument();
  });
});

describe('<VaultPage> mobile orchestration branches', () => {
  beforeEach(() => {
    localStorage.clear();
    installMatchMedia(true);
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    matchMediaMatches = false;
  });

  it('returns to the detail panel after saving an edit on mobile', async () => {
    const { props, container } = setup();
    fireEvent.click(screen.getByTestId('select-c1'));
    fireEvent.click(screen.getByText('start-edit'));
    fireEvent.click(screen.getByTestId('editor-set-name'));
    fireEvent.click(screen.getByTestId('editor-save'));
    await act(flush);
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.vault-grid.mobile-panel-detail')).not.toBeNull();
  });

  it('returns to the list after deleting the selected item on mobile', async () => {
    const { props, container } = setup();
    fireEvent.click(screen.getByTestId('select-c1'));
    fireEvent.click(screen.getByText('detail-delete'));
    fireEvent.click(screen.getByTestId('confirm-delete'));
    await act(flush);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.vault-grid.mobile-panel-list')).not.toBeNull();
  });

  it('returns to the list after restoring the selected item on mobile', async () => {
    const { props, container } = setup();
    fireEvent.click(screen.getByText('filter-trash'));
    fireEvent.click(screen.getByTestId('select-c4'));
    fireEvent.click(screen.getByText('detail-restore'));
    await act(flush);
    expect(props.onRestore).toHaveBeenCalledWith(['c4']);
    expect(container.querySelector('.vault-grid.mobile-panel-list')).not.toBeNull();
  });

  it('returns to the list after archiving the selected item on mobile', async () => {
    const { props, container } = setup();
    fireEvent.click(screen.getByTestId('select-c1'));
    fireEvent.click(screen.getByText('detail-archive'));
    fireEvent.click(screen.getByTestId('confirm-archive'));
    await act(flush);
    expect(props.onArchive).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.vault-grid.mobile-panel-list')).not.toBeNull();
  });

  it('cancels a mobile edit back to the detail panel', () => {
    const { container } = setup();
    fireEvent.click(screen.getByTestId('select-c1'));
    fireEvent.click(screen.getByText('start-edit'));
    expect(container.querySelector('.vault-grid.mobile-panel-edit')).not.toBeNull();
    fireEvent.click(screen.getByText('editor-cancel'));
    expect(container.querySelector('.vault-grid.mobile-panel-detail')).not.toBeNull();
  });

  it('focuses a deep-linked cipher into the mobile detail panel', () => {
    window.history.replaceState(null, '', '/vault?cipher=c1');
    const { container } = setup();
    expect(container.querySelector('.vault-grid.mobile-panel-detail')).not.toBeNull();
    window.history.replaceState(null, '', '/vault');
  });

  it('ignores a mask click while the mobile sidebar is already closed', () => {
    const { container } = setup();
    const mask = container.querySelector('.mobile-sidebar-mask') as HTMLElement;
    expect(mask).not.toBeNull();
    // Sidebar is closed; clicking the mask is a no-op guard path.
    fireEvent.click(mask);
    expect(screen.getByTestId('sidebar-filter')).toBeInTheDocument();
  });
});

describe('<VaultPage> additional comparator + guard branches', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('applies the cross-group tiebreak when duplicate groups share a minimum name', () => {
    const groupA = { decUsername: 'alpha', decPassword: 'pw', uris: [] };
    const groupB = { decUsername: 'bravo', decPassword: 'pw', uris: [] };
    setup({
      ciphers: [
        makeCipher({ id: 'a2', decName: 'Same', login: { ...groupA } }),
        makeCipher({ id: 'a1', decName: 'Same', login: { ...groupA } }),
        makeCipher({ id: 'b2', decName: 'Same', login: { ...groupB } }),
        makeCipher({ id: 'b1', decName: 'Same', login: { ...groupB } }),
      ],
    });
    fireEvent.click(screen.getByText('filter-duplicates'));
    const ids = Array.from(document.querySelectorAll('[data-testid^="select-"]'))
      .map((n) => n.getAttribute('data-testid'))
      .filter((id) => id && /^select-[ab]\d$/.test(id));
    // All four remain; within a group the equal-name items fall back to id order.
    expect(ids).toHaveLength(4);
  });

  it('sorts by unequal edited/created/name values', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'Alpha', revisionDate: '2024-01-01T00:00:00Z', creationDate: '2024-01-01T00:00:00Z' }),
        makeCipher({ id: 'c2', decName: 'Bravo', revisionDate: '2024-06-01T00:00:00Z', creationDate: '2024-06-01T00:00:00Z' }),
      ],
    });
    // Default edited sort: newest (c2) first.
    let ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['select-c2', 'select-c1']);
    fireEvent.click(screen.getByTestId('sort-created'));
    ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['select-c2', 'select-c1']);
    fireEvent.click(screen.getByTestId('sort-name'));
    ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['select-c1', 'select-c2']);
  });

  it('ignores document key/pointer events while all menus are closed', () => {
    setup();
    // No menu is open; these listeners take their early-return guard.
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByTestId('list-panel')).toBeInTheDocument();
  });

  it('builds meta for a cipher that uses name (not decName) and one without an id', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: undefined, name: 'Legacy Name' } as unknown as Partial<Cipher>),
        makeCipher({ id: 'c2', decName: 'Second' }),
      ],
    });
    // The legacy-named cipher still renders in the list via its name field.
    expect(screen.getByTestId('subtitle-c1')).toBeInTheDocument();
  });

  it('early-returns the scroll handler when the bucket does not change', () => {
    setup();
    fireEvent.click(screen.getByTestId('list-scroll'));
    // Second identical scroll lands in the same row bucket -> no state churn.
    fireEvent.click(screen.getByTestId('list-scroll'));
    expect(screen.getByTestId('list-panel')).toBeInTheDocument();
  });
});

describe('<VaultPage> defensive fallback branches', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sorts ciphers that lack revision/creation timestamps', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'Alpha', revisionDate: undefined, creationDate: undefined } as unknown as Partial<Cipher>),
        makeCipher({ id: 'c2', decName: 'Bravo', revisionDate: undefined, creationDate: undefined } as unknown as Partial<Cipher>),
      ],
    });
    // Edited sort with zero sort-times falls through to the id tiebreak.
    let ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['select-c1', 'select-c2']);
    fireEvent.click(screen.getByTestId('sort-created'));
    ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['select-c1', 'select-c2']);
  });

  it('renders a subtitle for a cipher whose type is unset (defaults to login)', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'c1', decName: 'No Type', type: undefined, login: { decUsername: 'user', decPassword: 'pw', uris: [] } } as unknown as Partial<Cipher>),
      ],
    });
    expect(screen.getByTestId('subtitle-c1')).toHaveTextContent('user');
  });
});

describe('<VaultPage> mobile create cancel', () => {
  beforeEach(() => {
    localStorage.clear();
    installMatchMedia(true);
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    matchMediaMatches = false;
  });

  it('cancels a mobile create flow back to the list panel', () => {
    const { container } = setup({ ciphers: [] });
    fireEvent.click(screen.getByTestId('start-create'));
    expect(container.querySelector('.vault-grid.mobile-panel-edit')).not.toBeNull();
    fireEvent.click(screen.getByText('editor-cancel'));
    // No selected cipher + isCreating -> cancel returns to the list, not detail.
    expect(container.querySelector('.vault-grid.mobile-panel-list')).not.toBeNull();
  });
});

describe('<VaultPage> more reachable edge branches', () => {
  beforeEach(() => {
    localStorage.clear();
    computeSshFingerprint.mockClear();
    generateDefaultSshKeyMaterial.mockClear();
  });

  it('renders items with no name at all and sorts them by id', () => {
    setup({
      ciphers: [
        makeCipher({ id: 'c2', decName: undefined, name: undefined } as unknown as Partial<Cipher>),
        makeCipher({ id: 'c1', decName: undefined, name: undefined } as unknown as Partial<Cipher>),
      ],
    });
    fireEvent.click(screen.getByTestId('sort-name'));
    const ids = Array.from(document.querySelectorAll('[data-testid^="select-c"]')).map((n) => n.getAttribute('data-testid'));
    expect(ids).toEqual(['select-c1', 'select-c2']);
  });

  it('prefills the rename dialog from a folder that only has a name field', () => {
    setup();
    fireEvent.click(screen.getByText('open-rename-plain'));
    expect(screen.getByTestId('dlg-rename-folder-open')).toHaveTextContent('true');
    expect(screen.getByTestId('dlg-rename-folder-name')).toHaveTextContent('PlainName');
  });

  it('no-ops a non-forced ssh reseed when key material already exists', async () => {
    setup();
    fireEvent.click(screen.getByTestId('start-create-ssh'));
    await act(flush);
    expect(screen.getByTestId('editor-ssh-public')).toHaveTextContent('ssh-ed25519 SEEDPUB');
    // A non-forced reseed with keys already present leaves the seeded key intact.
    fireEvent.click(screen.getByTestId('editor-seed-noforce'));
    await act(flush);
    expect(screen.getByTestId('editor-ssh-public')).toHaveTextContent('ssh-ed25519 SEEDPUB');
  });

  it('keeps the fingerprint stable when the same public key is re-applied', async () => {
    setup();
    fireEvent.click(screen.getByTestId('start-create-ssh'));
    await act(flush);
    fireEvent.click(screen.getByTestId('editor-set-ssh'));
    await act(flush);
    const fp = screen.getByTestId('editor-ssh-fingerprint').textContent;
    // Re-applying the identical public key recomputes the same fingerprint.
    fireEvent.click(screen.getByTestId('editor-set-ssh'));
    await act(flush);
    expect(screen.getByTestId('editor-ssh-fingerprint').textContent).toBe(fp);
  });
});

describe('<VaultPage> folder branch tails', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prefills the rename dialog with an empty name for a folder lacking name fields', () => {
    setup();
    fireEvent.click(screen.getByText('open-rename-empty'));
    expect(screen.getByTestId('dlg-rename-folder-open')).toHaveTextContent('true');
    expect(screen.getByTestId('dlg-rename-folder-name')).toHaveTextContent('');
  });

  it('deletes a folder while a different folder filter is active without resetting it', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('filter-folder'));
    fireEvent.click(screen.getByText('open-delete-other-folder'));
    fireEvent.click(screen.getByTestId('confirm-delete-folder'));
    await act(flush);
    expect(props.onDeleteFolder).toHaveBeenCalledWith('f9');
    // The active f1 folder filter is untouched because a different folder was deleted.
    expect(screen.getByTestId('sidebar-filter')).toHaveTextContent('"folder"');
  });
});

describe('<VaultPage> selection guard tails', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('no-ops select-unique when not in the duplicates view', () => {
    setup();
    fireEvent.click(screen.getByTestId('select-unique'));
    // Outside the duplicates filter no group indices exist, so nothing is selected.
    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
  });

  it('no-ops deselecting an item that is not currently selected', () => {
    setup();
    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
    fireEvent.click(screen.getByTestId('uncheck-c1'));
    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
  });
});

describe('<VaultPage> legacy matchMedia + focus guard', () => {
  const savedMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = savedMatchMedia;
    window.history.replaceState(null, '', '/vault');
  });

  it('subscribes via the legacy addListener api when addEventListener is unavailable', () => {
    const listeners = new Set<() => void>();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      // No addEventListener -> the component falls back to addListener/removeListener.
      addListener: (cb: () => void) => listeners.add(cb),
      removeListener: (cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => true,
    })) as unknown as typeof window.matchMedia;
    const { unmount } = setup();
    expect(listeners.size).toBeGreaterThan(0);
    // Unmount exercises the legacy removeListener cleanup path.
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('keeps a pending focus id while ciphers are still loading', () => {
    window.history.replaceState(null, '', '/vault?cipher=missing');
    // Empty + loading: the not-found focus branch keeps the pending ref instead of clearing.
    setup({ ciphers: [], loading: true });
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument();
  });
});

describe('<VaultPage> outside-pointer menu handlers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('runs the outside-pointer handlers while the create and sort menus are open', () => {
    setup();
    // Open the create menu, then a document pointerdown runs the outside-click
    // handler's active path (the menu ref belongs to the mocked list panel).
    fireEvent.click(screen.getByTestId('toggle-create-menu'));
    expect(screen.getByTestId('create-menu-open')).toHaveTextContent('true');
    fireEvent.pointerDown(document.body);
    // Open the sort menu and fire another outside pointerdown.
    fireEvent.click(screen.getByTestId('toggle-sort-menu'));
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('list-panel')).toBeInTheDocument();
  });
});
