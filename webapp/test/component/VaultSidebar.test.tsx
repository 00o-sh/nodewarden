import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import { fireEvent, render, screen, within } from '@testing-library/preact';
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
});
