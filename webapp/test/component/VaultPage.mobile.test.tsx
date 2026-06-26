import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';

// These mocks expose just enough of each leaf child to drive the orchestration
// branches that the other VaultPage tests don't reach: the reprompt verify flow,
// the live TOTP tick, the rename-folder / delete-all-folders dialogs, the
// duplicate "select all" helper, and the mobile-layout panel transitions.

vi.mock('@/components/vault/VaultSidebar', () => ({
  default: (props: any) => (
    <div data-testid="sidebar">
      <span data-testid="sidebar-filter">{JSON.stringify(props.sidebarFilter)}</span>
      <span data-testid="sidebar-mobile-open">{String(props.mobileSidebarOpen)}</span>
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'duplicates' })}>filter-duplicates</button>
      <button type="button" onClick={() => props.onChangeFilter({ kind: 'folder', folderId: 'f1' })}>filter-folder</button>
      <button type="button" onClick={() => props.onOpenRenameFolder({ id: 'f1', name: 'Work', decName: 'Work' })}>open-rename-folder</button>
      <button type="button" onClick={props.onOpenDeleteAllFolders}>open-delete-all-folders</button>
      <button type="button" onClick={props.onCloseMobileSidebar}>close-mobile-sidebar</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultListPanel', () => ({
  default: (props: any) => (
    <div data-testid="list-panel">
      <span data-testid="selected-count">{props.selectedCount}</span>
      <span data-testid="mobile-fab-visible">{String(props.mobileFabVisible)}</span>
      <ul>
        {props.filteredCiphers.map((cipher: any) => (
          <li key={cipher.id}>
            <button type="button" data-testid={`select-${cipher.id}`} onClick={() => props.onSelectCipher(cipher.id)}>
              {cipher.decName}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" data-testid="select-duplicates" onClick={props.onSelectDuplicates}>select-duplicates</button>
      <button type="button" data-testid="start-create" onClick={() => props.onStartCreate(1)}>start-create</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultDetailView', () => ({
  default: (props: any) => (
    <div data-testid="detail-view">
      <span data-testid="detail-name">{props.selectedCipher?.decName}</span>
      <span data-testid="detail-approved">{String(props.repromptApprovedCipherId === props.selectedCipher?.id)}</span>
      <span data-testid="detail-totp">{props.totpLive ? `${props.totpLive.code}:${props.totpLive.remain}` : 'none'}</span>
      <button type="button" onClick={props.onOpenReprompt}>open-reprompt</button>
      <button type="button" onClick={props.onStartEdit}>start-edit</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultEditor', () => ({
  default: (props: any) => (
    <div data-testid="editor">
      <span data-testid="editor-mode">{props.isCreating ? 'create' : 'edit'}</span>
      <button type="button" onClick={props.onCancel}>editor-cancel</button>
    </div>
  ),
}));

vi.mock('@/components/vault/VaultDialogs', () => ({
  default: (props: any) => (
    <div data-testid="dialogs">
      <span data-testid="dlg-reprompt-open">{String(props.repromptOpen)}</span>
      <span data-testid="dlg-rename-folder-open">{String(props.renameFolderOpen)}</span>
      <span data-testid="dlg-rename-folder-name">{props.renameFolderName}</span>
      <span data-testid="dlg-delete-all-folders-open">{String(props.deleteAllFoldersOpen)}</span>
      <button type="button" data-testid="reprompt-set-pw" onClick={() => props.onRepromptPasswordChange('hunter2')}>reprompt-set-pw</button>
      <button type="button" data-testid="reprompt-confirm" onClick={props.onConfirmReprompt}>reprompt-confirm</button>
      <button type="button" data-testid="reprompt-cancel" onClick={props.onCancelReprompt}>reprompt-cancel</button>
      <button type="button" data-testid="rename-folder-set-name" onClick={() => props.onRenameFolderNameChange('Renamed')}>rename-folder-set-name</button>
      <button type="button" data-testid="rename-folder-clear-name" onClick={() => props.onRenameFolderNameChange('   ')}>rename-folder-clear-name</button>
      <button type="button" data-testid="rename-folder-confirm" onClick={props.onConfirmRenameFolder}>rename-folder-confirm</button>
      <button type="button" data-testid="rename-folder-cancel" onClick={props.onCancelRenameFolder}>rename-folder-cancel</button>
      <button type="button" data-testid="delete-all-folders-confirm" onClick={props.onConfirmDeleteAllFolders}>delete-all-folders-confirm</button>
    </div>
  ),
}));

// calcTotpNow drives the live-tick effect. We stub it deterministically so we
// can assert the rendered code/remaining without real crypto.
const calcTotpNow = vi.fn();
vi.mock('@/lib/crypto', () => ({
  calcTotpNow: (...args: unknown[]) => calcTotpNow(...args),
}));

// VaultPage seeds SSH defaults / recomputes fingerprints; stub so nothing real runs.
vi.mock('@/lib/ssh', () => ({
  computeSshFingerprint: vi.fn(async () => 'SHA256:stub'),
  generateDefaultSshKeyMaterial: vi.fn(async () => ({ privateKey: 'priv', publicKey: 'pub', fingerprint: 'fp' })),
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

let matchMediaMatches = false;
const mediaListeners = new Set<(e: any) => void>();

function installMatchMedia(matches: boolean) {
  matchMediaMatches = matches;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    // Dynamic getter so the effect's captured media object reflects later changes.
    get matches() {
      return matchMediaMatches;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: (e: any) => void) => mediaListeners.add(cb),
    removeEventListener: (_type: string, cb: (e: any) => void) => mediaListeners.delete(cb),
    addListener: (cb: (e: any) => void) => mediaListeners.add(cb),
    removeListener: (cb: (e: any) => void) => mediaListeners.delete(cb),
    dispatchEvent: () => true,
  })) as any;
}

function setMobileLayout(next: boolean) {
  matchMediaMatches = next;
  act(() => {
    for (const cb of Array.from(mediaListeners)) cb({ matches: next });
  });
}

function setup(overrides: Partial<Parameters<typeof VaultPage>[0]> = {}) {
  const ciphers: Cipher[] = overrides.ciphers ?? [
    makeCipher({ id: 'c1', decName: 'GitHub' }),
    makeCipher({ id: 'c2', decName: 'GitLab', folderId: '' }),
  ];
  const folders: Folder[] = overrides.folders ?? [{ id: 'f1', name: 'Work', decName: 'Work' }];
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

beforeEach(() => {
  localStorage.clear();
  mediaListeners.clear();
  calcTotpNow.mockReset();
  installMatchMedia(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('<VaultPage> mobile layout', () => {
  it('renders the mobile grid class and shows the detail sheet after selecting an item', () => {
    installMatchMedia(true);
    const { container } = setup();
    // Initial mobile layout starts on the list panel.
    expect(container.querySelector('.vault-grid.mobile-panel-list')).not.toBeNull();
    // The FAB only shows on the list panel for mobile.
    expect(screen.getByTestId('mobile-fab-visible')).toHaveTextContent('true');

    fireEvent.click(screen.getByTestId('select-c1'));
    // Selecting an item switches the mobile panel to detail and opens the sheet.
    expect(container.querySelector('.vault-grid.mobile-panel-detail')).not.toBeNull();
    expect(container.querySelector('.detail-col.mobile-detail-sheet.open')).not.toBeNull();
    expect(screen.getByTestId('mobile-fab-visible')).toHaveTextContent('false');
  });

  it('the mobile back button returns from detail to the list', () => {
    installMatchMedia(true);
    const { container } = setup();
    fireEvent.click(screen.getByTestId('select-c1'));
    expect(container.querySelector('.vault-grid.mobile-panel-detail')).not.toBeNull();
    // The back button in the mobile panel head returns to the list panel.
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(container.querySelector('.vault-grid.mobile-panel-list')).not.toBeNull();
  });

  it('the mobile back button cancels an in-progress edit instead of leaving to the list', () => {
    installMatchMedia(true);
    const { container } = setup();
    fireEvent.click(screen.getByTestId('select-c1'));
    fireEvent.click(screen.getByText('start-edit'));
    expect(container.querySelector('.vault-grid.mobile-panel-edit')).not.toBeNull();
    // Back while editing => cancelEdit, which returns to the detail panel.
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(container.querySelector('.vault-grid.mobile-panel-detail')).not.toBeNull();
    expect(screen.getByTestId('detail-view')).toBeInTheDocument();
  });

  it('switches to a mobile create flow and shows the editor panel', () => {
    installMatchMedia(true);
    const { container } = setup();
    fireEvent.click(screen.getByTestId('start-create'));
    expect(container.querySelector('.vault-grid.mobile-panel-edit')).not.toBeNull();
    expect(screen.getByTestId('editor-mode')).toHaveTextContent('create');
  });

  it('reacts to a matchMedia change event switching into and out of mobile layout', () => {
    installMatchMedia(false);
    const { container } = setup();
    // Desktop: no mobile-panel class.
    expect(container.querySelector('.vault-grid.mobile-panel-list')).toBeNull();
    setMobileLayout(true);
    expect(container.querySelector('.vault-grid.mobile-panel-list')).not.toBeNull();
    // Leaving mobile resets the panel back to list and closes the sidebar.
    setMobileLayout(false);
    expect(container.querySelector('.vault-grid.mobile-panel-list')).toBeNull();
  });

  it('toggles the mobile sidebar open via the toggle key prop and closes it from the mask/sidebar', () => {
    installMatchMedia(true);
    const { rerender, props, container } = setup();
    expect(screen.getByTestId('sidebar-mobile-open')).toHaveTextContent('false');
    // Bumping the toggle key flips the sidebar open.
    rerender(<VaultPage {...props} mobileSidebarToggleKey={1} />);
    expect(screen.getByTestId('sidebar-mobile-open')).toHaveTextContent('true');
    // Clicking the mask closes it again.
    const mask = container.querySelector('.mobile-sidebar-mask.open') as HTMLElement;
    expect(mask).not.toBeNull();
    fireEvent.click(mask);
    expect(screen.getByTestId('sidebar-mobile-open')).toHaveTextContent('false');
  });
});

describe('<VaultPage> reprompt verify flow', () => {
  it('opens the reprompt dialog, verifies the master password, and marks the cipher approved', async () => {
    const { props } = setup();
    // c1 is auto-selected. Open reprompt.
    fireEvent.click(screen.getByText('open-reprompt'));
    expect(screen.getByTestId('dlg-reprompt-open')).toHaveTextContent('true');
    expect(screen.getByTestId('detail-approved')).toHaveTextContent('false');

    fireEvent.click(screen.getByTestId('reprompt-set-pw'));
    fireEvent.click(screen.getByTestId('reprompt-confirm'));
    await act(flush);

    expect(props.onVerifyMasterPassword).toHaveBeenCalledWith('user@example.com', 'hunter2');
    // After a successful verify the dialog closes and the cipher is approved.
    expect(screen.getByTestId('dlg-reprompt-open')).toHaveTextContent('false');
    expect(screen.getByTestId('detail-approved')).toHaveTextContent('true');
  });

  it('notifies an error when reprompt is confirmed with an empty password', () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('open-reprompt'));
    fireEvent.click(screen.getByTestId('reprompt-confirm'));
    expect(props.onVerifyMasterPassword).not.toHaveBeenCalled();
    expect(props.onNotify).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('notifies an error and keeps the cipher unapproved when verification fails', async () => {
    const onVerifyMasterPassword = vi.fn().mockRejectedValue(new Error('wrong password'));
    const { props } = setup({ onVerifyMasterPassword });
    fireEvent.click(screen.getByText('open-reprompt'));
    fireEvent.click(screen.getByTestId('reprompt-set-pw'));
    fireEvent.click(screen.getByTestId('reprompt-confirm'));
    await act(flush);
    expect(props.onNotify).toHaveBeenCalledWith('error', 'wrong password');
    expect(screen.getByTestId('detail-approved')).toHaveTextContent('false');
  });

  it('resets the reprompt approval when a different cipher is selected', async () => {
    setup();
    fireEvent.click(screen.getByText('open-reprompt'));
    fireEvent.click(screen.getByTestId('reprompt-set-pw'));
    fireEvent.click(screen.getByTestId('reprompt-confirm'));
    await act(flush);
    expect(screen.getByTestId('detail-approved')).toHaveTextContent('true');
    // Selecting a different cipher clears the approval state.
    fireEvent.click(screen.getByTestId('select-c2'));
    expect(screen.getByTestId('detail-approved')).toHaveTextContent('false');
  });
});

describe('<VaultPage> live TOTP tick', () => {
  it('renders the initial code and advances on the 1s interval', async () => {
    vi.useFakeTimers();
    calcTotpNow.mockResolvedValueOnce({ code: '111111', remain: 30 });
    const ciphers = [
      makeCipher({ id: 'c1', decName: 'GitHub', login: { decUsername: 'octocat', decPassword: 'pw', decTotp: 'otpauth://x', uris: [] } }),
    ];
    setup({ ciphers });
    // Resolve the immediate tick.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('detail-totp')).toHaveTextContent('111111:30');

    // Advance the interval; the next tick produces a new code.
    calcTotpNow.mockResolvedValueOnce({ code: '222222', remain: 29 });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('detail-totp')).toHaveTextContent('222222:29');
    expect(calcTotpNow).toHaveBeenCalledTimes(2);
  });

  it('clears the live TOTP when calcTotpNow throws', async () => {
    vi.useFakeTimers();
    calcTotpNow.mockRejectedValueOnce(new Error('bad totp'));
    const ciphers = [
      makeCipher({ id: 'c1', decName: 'GitHub', login: { decUsername: 'octocat', decPassword: 'pw', decTotp: 'otpauth://bad', uris: [] } }),
    ];
    setup({ ciphers });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('detail-totp')).toHaveTextContent('none');
  });

  it('does not run the tick when the selected cipher has no TOTP', () => {
    vi.useFakeTimers();
    setup();
    expect(calcTotpNow).not.toHaveBeenCalled();
    expect(screen.getByTestId('detail-totp')).toHaveTextContent('none');
  });
});

describe('<VaultPage> folder dialogs', () => {
  it('opens the rename-folder dialog prefilled with the folder name and renames it', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('open-rename-folder'));
    expect(screen.getByTestId('dlg-rename-folder-open')).toHaveTextContent('true');
    // Prefilled from the folder's decName.
    expect(screen.getByTestId('dlg-rename-folder-name')).toHaveTextContent('Work');
    fireEvent.click(screen.getByTestId('rename-folder-set-name'));
    fireEvent.click(screen.getByTestId('rename-folder-confirm'));
    await act(flush);
    expect(props.onRenameFolder).toHaveBeenCalledWith('f1', 'Renamed');
    expect(screen.getByTestId('dlg-rename-folder-open')).toHaveTextContent('false');
  });

  it('rejects renaming a folder to a blank name without calling the api', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('open-rename-folder'));
    // Clear the name to whitespace, then confirm -> required-name branch.
    fireEvent.click(screen.getByTestId('rename-folder-clear-name'));
    fireEvent.click(screen.getByTestId('rename-folder-confirm'));
    await act(flush);
    expect(props.onRenameFolder).not.toHaveBeenCalled();
    expect(props.onNotify).toHaveBeenCalledWith('error', expect.any(String));
    // Dialog stays open since the rename was rejected.
    expect(screen.getByTestId('dlg-rename-folder-open')).toHaveTextContent('true');
  });

  it('cancelling the rename dialog closes it without renaming', () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('open-rename-folder'));
    fireEvent.click(screen.getByTestId('rename-folder-cancel'));
    expect(props.onRenameFolder).not.toHaveBeenCalled();
    expect(screen.getByTestId('dlg-rename-folder-open')).toHaveTextContent('false');
  });

  it('opens and confirms the delete-all-folders dialog, resetting a folder filter to all', async () => {
    const { props } = setup();
    // Move into a folder filter so the reset branch runs.
    fireEvent.click(screen.getByText('filter-folder'));
    expect(screen.getByTestId('sidebar-filter')).toHaveTextContent('"folder"');
    fireEvent.click(screen.getByText('open-delete-all-folders'));
    expect(screen.getByTestId('dlg-delete-all-folders-open')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('delete-all-folders-confirm'));
    await act(flush);
    expect(props.onBulkDeleteFolders).toHaveBeenCalledWith(['f1']);
    expect(screen.getByTestId('sidebar-filter')).toHaveTextContent('"all"');
    expect(screen.getByTestId('dlg-delete-all-folders-open')).toHaveTextContent('false');
  });

  it('does nothing when delete-all-folders is confirmed with no folders', async () => {
    const { props } = setup({ folders: [] });
    fireEvent.click(screen.getByText('open-delete-all-folders'));
    fireEvent.click(screen.getByTestId('delete-all-folders-confirm'));
    await act(flush);
    expect(props.onBulkDeleteFolders).not.toHaveBeenCalled();
  });
});

describe('<VaultPage> duplicate select-all', () => {
  it('selects one item per duplicate group via onSelectDuplicates', () => {
    // Two pairs of exact duplicates (same name + username + uri).
    const dupLogin = { decUsername: 'octocat', decPassword: 'pw', uris: [] };
    const ciphers = [
      makeCipher({ id: 'c1', decName: 'Dup', login: { ...dupLogin } }),
      makeCipher({ id: 'c2', decName: 'Dup', login: { ...dupLogin } }),
      makeCipher({ id: 'c3', decName: 'Unique', login: { decUsername: 'solo', decPassword: 'pw', uris: [] } }),
    ];
    setup({ ciphers });
    // Enter the duplicates filter (only c1/c2 remain).
    fireEvent.click(screen.getByText('filter-duplicates'));
    expect(screen.getByTestId('select-c1')).toBeInTheDocument();
    expect(screen.getByTestId('select-c2')).toBeInTheDocument();
    expect(screen.queryByTestId('select-c3')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('select-duplicates'));
    // One of the two duplicates is left unselected (the first seen), one selected.
    expect(screen.getByTestId('selected-count')).toHaveTextContent('1');
  });
});

describe('<VaultPage> loading and empty orchestration', () => {
  it('shows the empty select-an-item prompt with no selection and no loading/error', () => {
    setup({ ciphers: [] });
    expect(screen.getByText('Select an item')).toBeInTheDocument();
  });
});
