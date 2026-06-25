import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import VaultEditor from '@/components/vault/VaultEditor';
import { createEmptyDraft } from '@/components/vault/vault-page-helpers';
import type { Cipher, Folder, VaultDraft } from '@/lib/types';

function makeDraft(overrides: Partial<VaultDraft> = {}): VaultDraft {
  return { ...createEmptyDraft(1), name: 'GitHub', ...overrides };
}

function setup(
  draft: VaultDraft,
  overrides: Partial<Parameters<typeof VaultEditor>[0]> = {}
) {
  const callbacks = {
    onUpdateDraft: vi.fn(),
    onSeedSshDefaults: vi.fn(),
    onUpdateSshPublicKey: vi.fn(),
    onUpdateDraftLoginUri: vi.fn(),
    onUpdateDraftLoginUriMatch: vi.fn(),
    onReorderDraftLoginUri: vi.fn(),
    onRequestDeleteLoginPasskey: vi.fn(),
    onQueueAttachmentFiles: vi.fn(),
    onToggleExistingAttachmentRemoval: vi.fn(),
    onRemoveQueuedAttachment: vi.fn(),
    onDownloadAttachment: vi.fn(),
    onPatchDraftCustomField: vi.fn(),
    onUpdateDraftCustomFields: vi.fn(),
    onOpenFieldModal: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onDeleteSelected: vi.fn(),
  };
  const folders: Folder[] = [{ id: 'f1', name: 'Work', decName: 'Work' }];
  const props: Parameters<typeof VaultEditor>[0] = {
    draft,
    isCreating: true,
    busy: false,
    folders,
    selectedCipher: null,
    editExistingAttachments: [],
    removedAttachmentIds: {},
    removedAttachmentCount: 0,
    attachmentQueue: [],
    attachmentInputRef: createRef<HTMLInputElement>(),
    localError: '',
    downloadingAttachmentKey: '',
    attachmentDownloadPercent: null,
    uploadingAttachmentName: '',
    attachmentUploadPercent: null,
    ...callbacks,
    ...overrides,
  };
  const utils = render(<VaultEditor {...props} />);
  return { ...utils, ...callbacks, props };
}

describe('<VaultEditor>', () => {
  it('renders the create header in create mode', () => {
    setup(makeDraft(), { isCreating: true });
    expect(screen.getByText('New Login')).toBeInTheDocument();
  });

  it('renders the edit header in edit mode', () => {
    const cipher = { id: 'c1', type: 1 } as Cipher;
    setup(makeDraft(), { isCreating: false, selectedCipher: cipher });
    expect(screen.getByText('Edit Login')).toBeInTheDocument();
  });

  it('shows the current draft name and fires onUpdateDraft when typing the name', () => {
    const { onUpdateDraft } = setup(makeDraft({ name: 'GitHub' }));
    const nameInput = screen.getByDisplayValue('GitHub') as HTMLInputElement;
    fireEvent.input(nameInput, { target: { value: 'GitLab' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ name: 'GitLab' });
  });

  it('reveals login fields for a login draft and fires onUpdateDraft from the password field', () => {
    const { onUpdateDraft } = setup(makeDraft({ type: 1 }));
    expect(screen.getByText('Login Credentials')).toBeInTheDocument();
    // The username + password fields render under their labels.
    const password = screen.getByText('Password').closest('label')!.querySelector('input')!;
    fireEvent.input(password, { target: { value: 'hunter2' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ loginPassword: 'hunter2' });
  });

  it('reveals card fields only for a card draft (type 3)', () => {
    setup(makeDraft({ type: 3 }));
    expect(screen.getByText('Card Details')).toBeInTheDocument();
    expect(screen.queryByText('Login Credentials')).not.toBeInTheDocument();
    expect(screen.queryByText('Identity Details')).not.toBeInTheDocument();
  });

  it('reveals identity fields only for an identity draft (type 4)', () => {
    setup(makeDraft({ type: 4 }));
    expect(screen.getByText('Identity Details')).toBeInTheDocument();
    expect(screen.queryByText('Card Details')).not.toBeInTheDocument();
    expect(screen.queryByText('Login Credentials')).not.toBeInTheDocument();
  });

  it('shows no type-specific credential section for a note draft (type 2)', () => {
    setup(makeDraft({ type: 2 }));
    expect(screen.queryByText('Login Credentials')).not.toBeInTheDocument();
    expect(screen.queryByText('Card Details')).not.toBeInTheDocument();
    expect(screen.queryByText('Identity Details')).not.toBeInTheDocument();
  });

  it('fires onUpdateDraft with the next type when the type select changes', () => {
    const { onUpdateDraft } = setup(makeDraft({ type: 1 }));
    const typeSelect = screen.getByText('Type').closest('label')!.querySelector('select')!;
    fireEvent.input(typeSelect, { target: { value: '3' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ type: 3 });
  });

  it('appends a new login URI when "Add Website" is clicked', () => {
    const draft = makeDraft({ type: 1 });
    const { onUpdateDraft } = setup(draft);
    fireEvent.click(screen.getByRole('button', { name: 'Add Website' }));
    expect(onUpdateDraft).toHaveBeenCalledTimes(1);
    const patch = onUpdateDraft.mock.calls[0][0];
    expect(patch.loginUris).toHaveLength(draft.loginUris.length + 1);
  });

  it('fires onUpdateDraftLoginUri when a website URI input changes', () => {
    const draft = makeDraft({ type: 1, loginUris: [{ uri: 'https://a.com', match: null }] });
    const { onUpdateDraftLoginUri } = setup(draft);
    const uriInput = screen.getByDisplayValue('https://a.com');
    fireEvent.input(uriInput, { target: { value: 'https://b.com' } });
    expect(onUpdateDraftLoginUri).toHaveBeenCalledWith(0, 'https://b.com');
  });

  it('fires onSave and onCancel from the action bar', () => {
    const { onSave, onCancel } = setup(makeDraft());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the delete button only in edit mode and fires onDeleteSelected', () => {
    const cipher = { id: 'c1', type: 1 } as Cipher;
    const { onDeleteSelected } = setup(makeDraft(), { isCreating: false, selectedCipher: cipher });
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(deleteBtn);
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('does not render a delete button in create mode', () => {
    setup(makeDraft(), { isCreating: true });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('opens the custom-field modal via onOpenFieldModal', () => {
    const { onOpenFieldModal } = setup(makeDraft());
    fireEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    expect(onOpenFieldModal).toHaveBeenCalledTimes(1);
  });

  it('toggles favorite via onUpdateDraft', () => {
    const { onUpdateDraft } = setup(makeDraft({ favorite: false }));
    fireEvent.click(screen.getByRole('button', { name: /Favorite/ }));
    expect(onUpdateDraft).toHaveBeenCalledWith({ favorite: true });
  });

  it('renders the local error message when provided', () => {
    setup(makeDraft(), { localError: 'Item name is required' });
    expect(screen.getByText('Item name is required')).toBeInTheDocument();
  });

  it('renders ssh key fields for an ssh draft (type 5)', () => {
    setup(makeDraft({ type: 5 }));
    // "SSH Key" also appears as a <select> option, so assert the section-specific
    // fields that only render for the SSH editor.
    expect(screen.getByText('Private Key')).toBeInTheDocument();
    expect(screen.getByText('Public Key')).toBeInTheDocument();
    expect(screen.getByText('Fingerprint')).toBeInTheDocument();
    expect(screen.queryByText('Login Credentials')).not.toBeInTheDocument();
  });

  it('lists queued attachments and removes them via callback', () => {
    const file = new File(['x'], 'note.txt', { type: 'text/plain' });
    const { onRemoveQueuedAttachment } = setup(makeDraft(), { attachmentQueue: [file] });
    const row = screen.getByText('note.txt').closest('.attachment-row')!;
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Remove' }));
    expect(onRemoveQueuedAttachment).toHaveBeenCalledWith(0);
  });
});
