import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import VaultListPanel from '@/components/vault/VaultListPanel';
import type { Cipher, Folder } from '@/lib/types';

function makeCipher(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'c1',
    type: 1,
    decName: 'GitHub',
    login: { decUsername: 'octocat', uris: [{ uri: 'https://github.com' }] },
    ...overrides,
  } as Cipher;
}

function setup(overrides: Partial<Parameters<typeof VaultListPanel>[0]> = {}) {
  const ciphers = overrides.filteredCiphers ?? [
    makeCipher({ id: 'c1', decName: 'GitHub' }),
    makeCipher({ id: 'c2', decName: 'GitLab' }),
  ];
  const callbacks = {
    onSearchInput: vi.fn(),
    onClearSearch: vi.fn(),
    onSearchCompositionStart: vi.fn(),
    onSearchCompositionEnd: vi.fn(),
    onToggleSortMenu: vi.fn(),
    onSelectSortMode: vi.fn(),
    onDuplicateModeChange: vi.fn(),
    onChangeFilter: vi.fn(),
    onSyncVault: vi.fn(),
    onOpenBulkDelete: vi.fn(),
    onSelectDuplicates: vi.fn(),
    onSelectAll: vi.fn(),
    onToggleCreateMenu: vi.fn(),
    onStartCreate: vi.fn(),
    onBulkRestore: vi.fn(),
    onBulkArchive: vi.fn(),
    onBulkUnarchive: vi.fn(),
    onOpenMove: vi.fn(),
    onClearSelection: vi.fn(),
    onScroll: vi.fn(),
    onToggleSelected: vi.fn(),
    onSelectCipher: vi.fn(),
  };
  const props: Parameters<typeof VaultListPanel>[0] = {
    busy: false,
    loading: false,
    error: '',
    folders: [] as Folder[],
    searchInput: '',
    sortMode: 'edited',
    sortMenuOpen: false,
    duplicateMode: 'exact',
    selectedCount: 0,
    totalCipherCount: ciphers.length,
    filteredCiphers: ciphers,
    visibleCiphers: ciphers,
    duplicateGroupIndexById: new Map(),
    virtualRange: { start: 0, end: ciphers.length, padTop: 0, padBottom: 0 },
    selectedCipherId: '',
    selectedMap: {},
    sidebarFilter: { kind: 'all' },
    isMobileLayout: false,
    mobileFabVisible: false,
    createMenuOpen: false,
    createMenuRef: createRef<HTMLDivElement>(),
    sortMenuRef: createRef<HTMLDivElement>(),
    listPanelRef: createRef<HTMLDivElement>(),
    ...callbacks,
    listSubtitle: (cipher: Cipher) => cipher.login?.decUsername || '',
    ...overrides,
  };
  const utils = render(<VaultListPanel {...props} />);
  return { ...utils, ...callbacks, props };
}

describe('<VaultListPanel>', () => {
  it('renders the provided ciphers with their names and subtitles', () => {
    setup();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('GitLab')).toBeInTheDocument();
    // listSubtitle returns the username
    expect(screen.getAllByText('octocat').length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are no ciphers and no error', () => {
    setup({ filteredCiphers: [], visibleCiphers: [], totalCipherCount: 0 });
    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
  });

  it('shows the error state with a retry button when an error is present', () => {
    setup({ filteredCiphers: [], visibleCiphers: [], error: 'Sync failed' });
    expect(screen.getByText('Sync failed')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry sync' });
    expect(retry).toBeInTheDocument();
  });

  it('fires onSelectCipher when a list row main button is clicked', () => {
    const { onSelectCipher } = setup();
    fireEvent.click(screen.getByText('GitHub'));
    expect(onSelectCipher).toHaveBeenCalledWith('c1');
  });

  it('fires onToggleSelected when a row checkbox is toggled', () => {
    const { onToggleSelected } = setup();
    const checkboxes = document.querySelectorAll('input.row-check');
    fireEvent.input(checkboxes[0], { target: { checked: true } });
    expect(onToggleSelected).toHaveBeenCalledWith('c1', true);
  });

  it('fires onSearchInput as the user types in the search box', () => {
    const { onSearchInput } = setup();
    const input = document.querySelector('input.search-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'git' } });
    expect(onSearchInput).toHaveBeenCalledWith('git');
  });

  it('fires onSyncVault when the sync button is clicked', () => {
    const { onSyncVault } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Sync Vault/i }));
    expect(onSyncVault).toHaveBeenCalledTimes(1);
  });

  it('renders selection-mode actions and fires bulk callbacks', () => {
    const { onClearSelection, onOpenBulkDelete } = setup({ selectedCount: 2 });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    // The bulk-delete trigger is the danger button (label is "Delete" outside trash).
    fireEvent.click(document.querySelector('.btn-danger') as HTMLElement);
    expect(onOpenBulkDelete).toHaveBeenCalledTimes(1);
  });

  it('marks the selected cipher row as active', () => {
    setup({ selectedCipherId: 'c2' });
    const gitlabRow = screen.getByText('GitLab').closest('.list-item');
    expect(gitlabRow).toHaveClass('active');
  });

  it('renders the create menu options when the create menu is open', () => {
    const { onStartCreate } = setup({ createMenuOpen: true });
    const menu = document.querySelector('.create-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    fireEvent.click(within(menu).getByText('Login'));
    expect(onStartCreate).toHaveBeenCalledWith(1);
  });
});
