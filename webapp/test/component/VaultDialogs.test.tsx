import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import VaultDialogs from '@/components/vault/VaultDialogs';
import type { Folder } from '@/lib/types';

type Props = Parameters<typeof VaultDialogs>[0];

function baseProps(): Props {
  return {
    busy: false,
    fieldModalOpen: false,
    fieldType: 0,
    fieldLabel: '',
    fieldValue: '',
    archiveConfirmOpen: false,
    bulkArchiveOpen: false,
    pendingDeleteOpen: false,
    bulkDeleteOpen: false,
    sidebarTrashMode: false,
    selectedCount: 0,
    moveOpen: false,
    moveFolderId: '__none__',
    folders: [],
    createFolderOpen: false,
    newFolderName: '',
    renameFolderOpen: false,
    renameFolderName: '',
    pendingDeleteFolder: null,
    deleteAllFoldersOpen: false,
    repromptOpen: false,
    repromptPassword: '',
    deletePasskeyOpen: false,
    onConfirmAddField: vi.fn(),
    onCancelFieldModal: vi.fn(),
    onFieldTypeChange: vi.fn(),
    onFieldLabelChange: vi.fn(),
    onFieldValueChange: vi.fn(),
    onConfirmArchive: vi.fn(),
    onCancelArchive: vi.fn(),
    onConfirmBulkArchive: vi.fn(),
    onCancelBulkArchive: vi.fn(),
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onConfirmBulkDelete: vi.fn(),
    onCancelBulkDelete: vi.fn(),
    onConfirmMove: vi.fn(),
    onCancelMove: vi.fn(),
    onMoveFolderIdChange: vi.fn(),
    onConfirmCreateFolder: vi.fn(),
    onCancelCreateFolder: vi.fn(),
    onNewFolderNameChange: vi.fn(),
    onConfirmRenameFolder: vi.fn(),
    onCancelRenameFolder: vi.fn(),
    onRenameFolderNameChange: vi.fn(),
    onConfirmDeleteFolder: vi.fn(),
    onCancelDeleteFolder: vi.fn(),
    onConfirmDeleteAllFolders: vi.fn(),
    onCancelDeleteAllFolders: vi.fn(),
    onConfirmReprompt: vi.fn(),
    onCancelReprompt: vi.fn(),
    onRepromptPasswordChange: vi.fn(),
    onConfirmDeletePasskey: vi.fn(),
    onCancelDeletePasskey: vi.fn(),
  };
}

function setup(overrides: Partial<Props> = {}) {
  const props = { ...baseProps(), ...overrides };
  const utils = render(<VaultDialogs {...props} />);
  return { ...utils, props };
}

describe('<VaultDialogs>', () => {
  it('renders no dialog when every open flag is false', () => {
    setup();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('add-field dialog renders and fires confirm/cancel', () => {
    const props = setup({ fieldModalOpen: true }).props;
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add Field')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(props.onConfirmAddField).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancelFieldModal).toHaveBeenCalledTimes(1);
  });

  it('add-field dialog fires onFieldLabelChange when the label input changes', () => {
    const props = setup({ fieldModalOpen: true }).props;
    const label = screen.getByText('Field Label').closest('label')!.querySelector('input')!;
    fireEvent.input(label, { target: { value: 'PIN' } });
    expect(props.onFieldLabelChange).toHaveBeenCalledWith('PIN');
  });

  it('archive dialog renders and fires confirm/cancel', () => {
    const props = setup({ archiveConfirmOpen: true }).props;
    expect(screen.getByText('Archive Item')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(props.onConfirmArchive).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancelArchive).toHaveBeenCalledTimes(1);
  });

  it('bulk-archive dialog renders with the selected count', () => {
    const props = setup({ bulkArchiveOpen: true, selectedCount: 3 }).props;
    expect(screen.getByText('Archive Items')).toBeInTheDocument();
    expect(screen.getByText(/3 selected items/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(props.onConfirmBulkArchive).toHaveBeenCalledTimes(1);
  });

  it('delete dialog renders and fires confirm/cancel', () => {
    const props = setup({ pendingDeleteOpen: true }).props;
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(props.onConfirmDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(props.onCancelDelete).toHaveBeenCalledTimes(1);
  });

  it('bulk-delete dialog uses the permanent title while in trash mode', () => {
    setup({ bulkDeleteOpen: true, sidebarTrashMode: true, selectedCount: 2 });
    expect(screen.getByText('Delete Selected Items Permanently')).toBeInTheDocument();
  });

  it('bulk-delete dialog uses the normal title outside trash mode', () => {
    setup({ bulkDeleteOpen: true, sidebarTrashMode: false, selectedCount: 2 });
    expect(screen.getByText('Delete Selected Items')).toBeInTheDocument();
  });

  it('move dialog renders folder options and fires onMoveFolderIdChange', () => {
    const folders: Folder[] = [{ id: 'f1', name: 'Work', decName: 'Work' }];
    const props = setup({ moveOpen: true, folders }).props;
    expect(screen.getByText('Move Selected Items')).toBeInTheDocument();
    const select = screen.getByText('Folder').closest('label')!.querySelector('select')!;
    fireEvent.input(select, { target: { value: 'f1' } });
    expect(props.onMoveFolderIdChange).toHaveBeenCalledWith('f1');
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(props.onConfirmMove).toHaveBeenCalledTimes(1);
  });

  it('create-folder dialog renders and fires onNewFolderNameChange + confirm', () => {
    const props = setup({ createFolderOpen: true }).props;
    expect(screen.getByText('Create Folder')).toBeInTheDocument();
    const input = screen.getByText('Folder Name').closest('label')!.querySelector('input')!;
    fireEvent.input(input, { target: { value: 'Personal' } });
    expect(props.onNewFolderNameChange).toHaveBeenCalledWith('Personal');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(props.onConfirmCreateFolder).toHaveBeenCalledTimes(1);
  });

  it('rename-folder dialog renders and fires confirm', () => {
    const props = setup({ renameFolderOpen: true, renameFolderName: 'Old' }).props;
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(props.onConfirmRenameFolder).toHaveBeenCalledTimes(1);
  });

  it('delete-folder dialog opens when a pendingDeleteFolder is set', () => {
    const folder: Folder = { id: 'f1', name: 'Work', decName: 'Work' };
    const props = setup({ pendingDeleteFolder: folder }).props;
    expect(screen.getByText('Delete Folder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onConfirmDeleteFolder).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancelDeleteFolder).toHaveBeenCalledTimes(1);
  });

  it('delete-all-folders dialog renders and fires confirm', () => {
    const props = setup({ deleteAllFoldersOpen: true }).props;
    expect(screen.getByText('Delete All Folders')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onConfirmDeleteAllFolders).toHaveBeenCalledTimes(1);
  });

  it('reprompt dialog renders a password field and fires change + confirm', () => {
    const props = setup({ repromptOpen: true }).props;
    expect(screen.getByText('Unlock Item')).toBeInTheDocument();
    const input = screen.getByText('Master Password').closest('label')!.querySelector('input')!;
    fireEvent.input(input, { target: { value: 'pw' } });
    expect(props.onRepromptPasswordChange).toHaveBeenCalledWith('pw');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(props.onConfirmReprompt).toHaveBeenCalledTimes(1);
  });

  it('delete-passkey dialog renders and fires confirm/cancel', () => {
    const props = setup({ deletePasskeyOpen: true }).props;
    expect(screen.getByText('Delete Passkey')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onConfirmDeletePasskey).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancelDeletePasskey).toHaveBeenCalledTimes(1);
  });
});
