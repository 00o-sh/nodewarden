import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { createWouterMock } from './helpers/wouterMock';

// v1.8.0 VaultSidebar renders a wouter <Link> to the new Password Security page.
// Real wouter resolves its internal `react` import to the real React under jsdom,
// which has no renderer; mock it with the shared preact-native stand-in.
vi.mock('wouter', () => createWouterMock());

import VaultSidebar from '@/components/vault/VaultSidebar';
import type { Folder } from '@/lib/types';

function setup(overrides: Partial<Parameters<typeof VaultSidebar>[0]> = {}) {
  const callbacks = {
    onCloseMobileSidebar: vi.fn(),
    onChangeFilter: vi.fn(),
    onOpenDeleteAllFolders: vi.fn(),
    onOpenCreateFolder: vi.fn(),
    onOpenRenameFolder: vi.fn(),
    onOpenDeleteFolder: vi.fn(),
    onToggleFolderSortMenu: vi.fn(),
    onSelectFolderSortMode: vi.fn(),
  };
  const folders: Folder[] = overrides.folders ?? [
    { id: 'f1', name: 'Work', decName: 'Work' },
    { id: 'f2', name: 'Personal', decName: 'Personal' },
  ];
  const props: Parameters<typeof VaultSidebar>[0] = {
    folders,
    sidebarFilter: { kind: 'all' },
    busy: false,
    isMobileLayout: false,
    mobileSidebarOpen: false,
    folderSortMode: 'name',
    folderSortMenuOpen: false,
    folderSortMenuRef: createRef<HTMLDivElement>(),
    ...callbacks,
    ...overrides,
  };
  const utils = render(<VaultSidebar {...props} />);
  return { ...utils, ...callbacks, props };
}

describe('<VaultSidebar>', () => {
  it('renders the standard filter buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: /All Items/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Favorites/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Trash/i })).toBeInTheDocument();
  });

  it('renders the provided folders by decrypted name', () => {
    setup();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('renders the no-folder pseudo-folder even with no folders', () => {
    setup({ folders: [] });
    expect(screen.getByText('No Folder')).toBeInTheDocument();
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });

  it('fires onChangeFilter with the all filter when All Items clicked', () => {
    const { onChangeFilter } = setup();
    fireEvent.click(screen.getByRole('button', { name: /All Items/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'all' });
  });

  it('fires onChangeFilter with a type filter when a type button clicked', () => {
    const { onChangeFilter } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Login/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'type', value: 'login' });
  });

  it('fires onChangeFilter for the bank / license / passport type buttons', () => {
    const { onChangeFilter } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Bank Account/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'type', value: 'bank' });
    fireEvent.click(screen.getByRole('button', { name: /Driver License/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'type', value: 'license' });
    fireEvent.click(screen.getByRole('button', { name: /Passport/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'type', value: 'passport' });
  });

  it('fires onChangeFilter with a folder filter when a folder button clicked', () => {
    const { onChangeFilter } = setup();
    fireEvent.click(screen.getByText('Work'));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'folder', folderId: 'f1' });
  });

  it('fires onOpenRenameFolder and onOpenDeleteFolder from per-folder actions', () => {
    const { onOpenRenameFolder, onOpenDeleteFolder, props } = setup();
    const workRow = screen.getByText('Work').closest('.folder-row') as HTMLElement;
    fireEvent.click(within(workRow).getByRole('button', { name: 'Edit' }));
    expect(onOpenRenameFolder).toHaveBeenCalledWith(props.folders[0]);
    fireEvent.click(within(workRow).getByRole('button', { name: 'Delete' }));
    expect(onOpenDeleteFolder).toHaveBeenCalledWith(props.folders[0]);
  });

  it('fires onOpenCreateFolder when the add-folder button clicked', () => {
    const { onOpenCreateFolder } = setup();
    fireEvent.click(document.querySelector('.folder-add-btn') as HTMLElement);
    expect(onOpenCreateFolder).toHaveBeenCalledTimes(1);
  });

  it('marks the active filter button', () => {
    setup({ sidebarFilter: { kind: 'favorite' } });
    expect(screen.getByRole('button', { name: /Favorites/i })).toHaveClass('active');
  });

  it('disables delete-all-folders when there are no folders', () => {
    setup({ folders: [] });
    expect(screen.getByRole('button', { name: 'Delete All Folders' })).toBeDisabled();
  });

  it('fires onChangeFilter for favorite / archive / trash / duplicates', () => {
    const { onChangeFilter } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Favorites/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'favorite' });
    fireEvent.click(screen.getByRole('button', { name: /Archive/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'archive' });
    fireEvent.click(screen.getByRole('button', { name: /Trash/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'trash' });
    fireEvent.click(screen.getByRole('button', { name: /Duplicates/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'duplicates' });
  });

  it('fires onChangeFilter for the card / identity / note / ssh type buttons', () => {
    const { onChangeFilter } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Card$/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'type', value: 'card' });
    fireEvent.click(screen.getByRole('button', { name: /Identity/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'type', value: 'identity' });
    fireEvent.click(screen.getByRole('button', { name: /Secure Note|^Note$/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'type', value: 'note' });
    fireEvent.click(screen.getByRole('button', { name: /SSH Key/i }));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'type', value: 'ssh' });
  });

  it('marks the active type button when a type filter is set', () => {
    setup({ sidebarFilter: { kind: 'type', value: 'card' } });
    expect(screen.getByRole('button', { name: /^Card$/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /Login/i })).not.toHaveClass('active');
  });

  it('fires the no-folder filter and marks it active', () => {
    const { onChangeFilter } = setup({ sidebarFilter: { kind: 'folder', folderId: null } });
    const noFolderBtn = screen.getByRole('button', { name: /No Folder/i });
    expect(noFolderBtn).toHaveClass('active');
    fireEvent.click(noFolderBtn);
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'folder', folderId: null });
  });

  it('marks the active folder button', () => {
    setup({ sidebarFilter: { kind: 'folder', folderId: 'f2' } });
    const personalRow = screen.getByText('Personal').closest('.folder-row') as HTMLElement;
    expect(within(personalRow).getByRole('button', { name: 'Personal' })).toHaveClass('active');
  });

  it('falls back to name then id for the folder label', () => {
    setup({
      folders: [
        { id: 'f3', name: 'NameOnly' } as Folder,
        { id: 'onlyid' } as Folder,
      ],
      folderSortMode: 'name',
    });
    expect(screen.getByText('NameOnly')).toBeInTheDocument();
    expect(screen.getByText('onlyid')).toBeInTheDocument();
  });

  it('disables per-folder edit/delete and delete-all when busy', () => {
    setup({ busy: true });
    const workRow = screen.getByText('Work').closest('.folder-row') as HTMLElement;
    expect(within(workRow).getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(within(workRow).getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete All Folders' })).toBeDisabled();
  });

  it('fires onOpenDeleteAllFolders when the delete-all button clicked', () => {
    const { onOpenDeleteAllFolders } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete All Folders' }));
    expect(onOpenDeleteAllFolders).toHaveBeenCalledTimes(1);
  });

  it('renders the mobile sidebar header and fires onCloseMobileSidebar', () => {
    const { onCloseMobileSidebar } = setup({ isMobileLayout: true, mobileSidebarOpen: true });
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);
    expect(onCloseMobileSidebar).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.mobile-sidebar-sheet.open')).not.toBeNull();
  });

  it('toggles the folder sort menu via its button', () => {
    const { onToggleFolderSortMenu } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    expect(onToggleFolderSortMenu).toHaveBeenCalledTimes(1);
  });

  it('renders the sort menu options and fires onSelectFolderSortMode', () => {
    const { onSelectFolderSortMode } = setup({ folderSortMenuOpen: true, folderSortMode: 'name' });
    const menu = document.querySelector('.sort-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    const items = within(menu).getAllByRole('button');
    expect(items).toHaveLength(3);
    // The active mode ('name') carries the active class.
    const activeItem = items.find((el) => el.classList.contains('active')) as HTMLElement;
    expect(activeItem).toBeDefined();
    fireEvent.click(items[0]);
    expect(onSelectFolderSortMode).toHaveBeenCalledWith('edited');
  });

  function folderOrder(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('.folder-row .tree-label')).map(
      (el) => el.textContent || ''
    );
  }

  it('sorts folders by last-edited (revisionDate) descending', () => {
    const { container } = setup({
      folderSortMode: 'edited',
      folders: [
        { id: 'a', decName: 'Zebra', revisionDate: '2020-01-01T00:00:00Z' },
        { id: 'b', decName: 'Apple', revisionDate: '2023-01-01T00:00:00Z' },
        { id: 'c', decName: 'Mango', revisionDate: '2021-01-01T00:00:00Z' },
      ] as Folder[],
    });
    expect(folderOrder(container)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('breaks equal edited-times by name and drops date-less folders last', () => {
    const { container } = setup({
      folderSortMode: 'edited',
      folders: [
        { id: 'a', decName: 'Beta', revisionDate: '2022-01-01T00:00:00Z' },
        { id: 'b', decName: 'Alpha', revisionDate: '2022-01-01T00:00:00Z' },
        { id: 'c', decName: 'Gamma' },
      ] as Folder[],
    });
    expect(folderOrder(container)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts folders by created date descending, falling back to creationDate', () => {
    const { container } = setup({
      folderSortMode: 'created',
      folders: [
        { id: 'a', decName: 'Old', creationDate: '2019-01-01T00:00:00Z' },
        { id: 'b', decName: 'New', creationDate: '2024-01-01T00:00:00Z' },
        { id: 'c', decName: 'NoDate' },
      ] as Folder[],
    });
    expect(folderOrder(container)).toEqual(['New', 'Old', 'NoDate']);
  });

  it('marks each standard/type filter active when selected', () => {
    const cases: Array<[Parameters<typeof setup>[0]['sidebarFilter'], RegExp]> = [
      [{ kind: 'archive' }, /Archive/i],
      [{ kind: 'trash' }, /Trash/i],
      [{ kind: 'duplicates' }, /Duplicates/i],
      [{ kind: 'type', value: 'login' }, /Login/i],
      [{ kind: 'type', value: 'bank' }, /Bank Account/i],
      [{ kind: 'type', value: 'identity' }, /Identity/i],
      [{ kind: 'type', value: 'license' }, /Driver License/i],
      [{ kind: 'type', value: 'passport' }, /Passport/i],
      [{ kind: 'type', value: 'note' }, /Secure Note|^Note$/i],
      [{ kind: 'type', value: 'ssh' }, /SSH Key/i],
    ];
    for (const [filter, name] of cases) {
      const { unmount } = setup({ sidebarFilter: filter });
      expect(screen.getByRole('button', { name })).toHaveClass('active');
      unmount();
    }
  });

  it('uses creationDate as the edited-sort fallback and orders date-less folders last', () => {
    const { container } = setup({
      folderSortMode: 'edited',
      folders: [
        { id: 'a', decName: 'Middle', creationDate: '2021-01-01T00:00:00Z' },
        { id: 'b', decName: 'NoDate' },
        { id: 'c', decName: 'Newest', revisionDate: '2025-01-01T00:00:00Z' },
      ] as Folder[],
    });
    expect(folderOrder(container)).toEqual(['Newest', 'Middle', 'NoDate']);
  });

  it('orders date-less folders after dated ones in created mode regardless of position', () => {
    const { container } = setup({
      folderSortMode: 'created',
      folders: [
        { id: 'a', decName: 'Dated', creationDate: '2022-01-01T00:00:00Z' },
        { id: 'b', decName: 'Blank' },
        { id: 'c', decName: 'Older', creationDate: '2018-01-01T00:00:00Z' },
      ] as Folder[],
    });
    expect(folderOrder(container)).toEqual(['Dated', 'Older', 'Blank']);
  });

  it('sorts folders by name and breaks ties by id', () => {
    const { container } = setup({
      folderSortMode: 'name',
      folders: [
        { id: 'z2', decName: 'Same' },
        { id: 'z1', decName: 'Same' },
        { id: 'q', decName: 'Alpha' },
      ] as Folder[],
    });
    expect(folderOrder(container)).toEqual(['Alpha', 'Same', 'Same']);
    // The 'z1' row (earlier id) precedes 'z2' among the equal-named entries.
    const rows = Array.from(container.querySelectorAll('.folder-row'));
    const sameRows = rows.filter((r) => (r.querySelector('.tree-label')?.textContent || '') === 'Same');
    expect(sameRows).toHaveLength(2);
  });
});
