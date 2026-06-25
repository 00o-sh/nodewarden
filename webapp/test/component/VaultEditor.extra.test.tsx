import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import VaultEditor from '@/components/vault/VaultEditor';
import { createEmptyDraft } from '@/components/vault/vault-page-helpers';
import type { Cipher, Folder, VaultDraft } from '@/lib/types';

// These tests cover the branches NOT exercised by VaultEditor.test.tsx:
// deep card/identity/ssh field editing, custom-field edit/remove, the boolean
// custom-field branch, password/attachment lists, reprompt toggle, the TOTP
// field button, the URI match-type select, and the various conditional
// attachment status sections.

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

describe('<VaultEditor> extra coverage', () => {
  it('seeds ssh defaults when switching the type select to SSH (type 5)', () => {
    const { onUpdateDraft, onSeedSshDefaults } = setup(makeDraft({ type: 1 }));
    const typeSelect = screen.getByText('Type').closest('label')!.querySelector('select')!;
    fireEvent.input(typeSelect, { target: { value: '5' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ type: 5 });
    expect(onSeedSshDefaults).toHaveBeenCalledTimes(1);
  });

  it('edits the folder select via onUpdateDraft', () => {
    const { onUpdateDraft } = setup(makeDraft());
    const folderSelect = screen.getByText('Folder').closest('label')!.querySelector('select')!;
    fireEvent.input(folderSelect, { target: { value: 'f1' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ folderId: 'f1' });
  });

  it('edits the username and TOTP secret on a login draft', () => {
    const { onUpdateDraft } = setup(makeDraft({ type: 1 }));
    const username = screen.getByText('Username').closest('label')!.querySelector('input')!;
    fireEvent.input(username, { target: { value: 'octo' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ loginUsername: 'octo' });

    const totp = screen.getByText('TOTP Secret').closest('label')!.querySelector('input')!;
    fireEvent.input(totp, { target: { value: 'JBSWY3DPEHPK3PXP' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ loginTotp: 'JBSWY3DPEHPK3PXP' });
  });

  it('opens the TOTP QR scan dialog when the scan button is pressed', () => {
    setup(makeDraft({ type: 1 }));
    const scanBtn = screen.getByRole('button', { name: 'Scan TOTP QR code' });
    fireEvent.click(scanBtn);
    // The scan dialog renders in a portal with role=dialog.
    expect(screen.getByRole('dialog', { name: 'Scan TOTP QR code' })).toBeInTheDocument();
  });

  it('changes the URI match type via the website match select', () => {
    const draft = makeDraft({ type: 1, loginUris: [{ uri: 'https://a.com', match: null }] });
    const { onUpdateDraftLoginUriMatch } = setup(draft);
    const select = document.querySelector('select.website-match-select') as HTMLSelectElement;
    // "Exact" maps to value 3.
    fireEvent.input(select, { target: { value: '3' } });
    expect(onUpdateDraftLoginUriMatch).toHaveBeenCalledWith(0, 3);
    // Selecting the blank ("Default") option clears the match back to null.
    fireEvent.input(select, { target: { value: '' } });
    expect(onUpdateDraftLoginUriMatch).toHaveBeenCalledWith(0, null);
  });

  it('moves and removes a website row when multiple URIs exist', () => {
    const draft = makeDraft({
      type: 1,
      loginUris: [
        { uri: 'https://a.com', match: null },
        { uri: 'https://b.com', match: null },
      ],
    });
    const { onReorderDraftLoginUri } = setup(draft);
    const rows = document.querySelectorAll('.website-row');
    expect(rows.length).toBe(2);
    // The first row can move down but not up; click its move-down button.
    const firstRow = rows[0] as HTMLElement;
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Move down' }));
    expect(onReorderDraftLoginUri).toHaveBeenCalledWith(0, 1);
  });

  it('removes a website row (Remove button only shows with multiple URIs)', () => {
    const draft = makeDraft({
      type: 1,
      loginUris: [
        { uri: 'https://a.com', match: null },
        { uri: 'https://b.com', match: null },
      ],
    });
    const { onUpdateDraft } = setup(draft);
    const rows = document.querySelectorAll('.website-row');
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: 'Remove' }));
    const patch = onUpdateDraft.mock.calls.at(-1)![0];
    expect(patch.loginUris).toHaveLength(1);
    expect(patch.loginUris[0].uri).toBe('https://b.com');
  });

  it('renders passkeys and requests deletion of one', () => {
    const draft = makeDraft({
      type: 1,
      loginFido2Credentials: [{ creationDate: '2024-01-01T00:00:00Z' }],
    });
    const { onRequestDeleteLoginPasskey } = setup(draft);
    expect(screen.getByText('Passkeys')).toBeInTheDocument();
    const row = document.querySelector('.attachment-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(onRequestDeleteLoginPasskey).toHaveBeenCalledWith(0);
  });

  it('edits every card field and auto-detects the brand from a Visa number', () => {
    const { onUpdateDraft } = setup(makeDraft({ type: 3 }));
    const editField = (label: string, value: string) => {
      const input = screen.getByText(label).closest('label')!.querySelector('input')!;
      fireEvent.input(input, { target: { value } });
    };
    editField('Cardholder Name', 'Jane Doe');
    expect(onUpdateDraft).toHaveBeenCalledWith({ cardholderName: 'Jane Doe' });

    // Number field auto-detects the brand when cardBrand is empty.
    const numberInput = screen.getByText('Number').closest('label')!.querySelector('input')!;
    fireEvent.input(numberInput, { target: { value: '4111111111111111' } });
    const numberPatch = onUpdateDraft.mock.calls.at(-1)![0];
    expect(numberPatch.cardNumber).toBe('4111111111111111');
    expect(numberPatch.cardBrand).toBe('Visa');

    editField('Security Code (CVV)', '123');
    expect(onUpdateDraft).toHaveBeenCalledWith({ cardCode: '123' });
    editField('Expiry Month', '12');
    expect(onUpdateDraft).toHaveBeenCalledWith({ cardExpMonth: '12' });
    editField('Expiry Year', '2030');
    expect(onUpdateDraft).toHaveBeenCalledWith({ cardExpYear: '2030' });
  });

  it('does not overwrite an existing card brand when the number changes', () => {
    const { onUpdateDraft } = setup(makeDraft({ type: 3, cardBrand: 'Mastercard' }));
    const numberInput = screen.getByText('Number').closest('label')!.querySelector('input')!;
    fireEvent.input(numberInput, { target: { value: '4111111111111111' } });
    const patch = onUpdateDraft.mock.calls.at(-1)![0];
    expect(patch.cardNumber).toBe('4111111111111111');
    expect('cardBrand' in patch).toBe(false);
  });

  it('edits the card brand select directly', () => {
    const { onUpdateDraft } = setup(makeDraft({ type: 3 }));
    const brandSelect = document.querySelector('select.card-brand-select') as HTMLSelectElement;
    fireEvent.input(brandSelect, { target: { value: 'Discover' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ cardBrand: 'Discover' });
  });

  it('appends an unknown card brand to the brand options', () => {
    setup(makeDraft({ type: 3, cardBrand: 'MysteryPay' }));
    const brandSelect = document.querySelector('select.card-brand-select') as HTMLSelectElement;
    const optionValues = Array.from(brandSelect.options).map((o) => o.value);
    expect(optionValues).toContain('MysteryPay');
  });

  it('edits identity fields including a deep one (passport number)', () => {
    const { onUpdateDraft } = setup(makeDraft({ type: 4 }));
    const passport = screen.getByText('Passport Number').closest('label')!.querySelector('input')!;
    fireEvent.input(passport, { target: { value: 'X1234567' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ identPassportNumber: 'X1234567' });

    const firstName = screen.getByText('First Name').closest('label')!.querySelector('input')!;
    fireEvent.input(firstName, { target: { value: 'Jane' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ identFirstName: 'Jane' });
  });

  it('edits ssh private/public keys and offers regenerate in create mode', () => {
    const { onUpdateDraft, onUpdateSshPublicKey, onSeedSshDefaults } = setup(
      makeDraft({ type: 5, sshPrivateKey: 'priv', sshPublicKey: 'pub', sshFingerprint: 'SHA256:abc' })
    );
    const priv = screen.getByText('Private Key').closest('label')!.querySelector('textarea')!;
    fireEvent.input(priv, { target: { value: 'newpriv' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ sshPrivateKey: 'newpriv' });

    const pub = screen.getByText('Public Key').closest('label')!.querySelector('textarea')!;
    fireEvent.input(pub, { target: { value: 'newpub' } });
    expect(onUpdateSshPublicKey).toHaveBeenCalledWith('newpub');

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onSeedSshDefaults).toHaveBeenCalledWith(true);

    // Fingerprint field is read-only.
    const fingerprint = screen.getByDisplayValue('SHA256:abc') as HTMLInputElement;
    expect(fingerprint.readOnly).toBe(true);
  });

  it('disables ssh key editing and regenerate when not creating', () => {
    const cipher = { id: 'c1', type: 5 } as Cipher;
    setup(makeDraft({ type: 5 }), { isCreating: false, selectedCipher: cipher });
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled();
    const priv = screen.getByText('Private Key').closest('label')!.querySelector('textarea')!;
    expect(priv).toBeDisabled();
  });

  it('toggles the master-password reprompt checkbox', () => {
    const { onUpdateDraft } = setup(makeDraft({ reprompt: false }));
    const checkbox = screen.getByText('Master password reprompt').closest('label')!.querySelector('input')!;
    fireEvent.input(checkbox, { target: { checked: true } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ reprompt: true });
  });

  it('edits the notes textarea', () => {
    const { onUpdateDraft } = setup(makeDraft());
    const notes = screen.getByText('Notes').closest('label')!.querySelector('textarea')!;
    fireEvent.input(notes, { target: { value: 'a secret note' } });
    expect(onUpdateDraft).toHaveBeenCalledWith({ notes: 'a secret note' });
  });

  it('edits a text custom field label and value', () => {
    const draft = makeDraft({ customFields: [{ type: 0, label: 'PIN', value: '1234' }] });
    const { onPatchDraftCustomField } = setup(draft);
    const card = document.querySelector('.custom-field-card') as HTMLElement;
    const labelInput = card.querySelector('input.input') as HTMLInputElement;
    fireEvent.input(labelInput, { target: { value: 'Code' } });
    expect(onPatchDraftCustomField).toHaveBeenCalledWith(0, { label: 'Code' });

    const valueArea = card.querySelector('textarea.custom-field-textarea') as HTMLTextAreaElement;
    fireEvent.input(valueArea, { target: { value: '9999' } });
    expect(onPatchDraftCustomField).toHaveBeenCalledWith(0, { value: '9999' });
  });

  it('renders a boolean custom field and toggles it via onPatchDraftCustomField', () => {
    const draft = makeDraft({ customFields: [{ type: 2, label: 'Active', value: 'false' }] });
    const { onPatchDraftCustomField } = setup(draft);
    expect(screen.getByText('Unchecked')).toBeInTheDocument();
    const checkbox = document.querySelector('.custom-field-check input[type="checkbox"]') as HTMLInputElement;
    fireEvent.input(checkbox, { target: { checked: true } });
    expect(onPatchDraftCustomField).toHaveBeenCalledWith(0, { value: 'true' });
  });

  it('removes a custom field via onUpdateDraftCustomFields', () => {
    const draft = makeDraft({
      customFields: [
        { type: 0, label: 'A', value: '1' },
        { type: 0, label: 'B', value: '2' },
      ],
    });
    const { onUpdateDraftCustomFields } = setup(draft);
    const cards = document.querySelectorAll('.custom-field-card');
    expect(cards.length).toBe(2);
    fireEvent.click(within(cards[0] as HTMLElement).getByRole('button', { name: 'Remove' }));
    const nextFields = onUpdateDraftCustomFields.mock.calls.at(-1)![0];
    expect(nextFields).toHaveLength(1);
    expect(nextFields[0].label).toBe('B');
  });

  it('hides linked (type 3) custom fields from the editor', () => {
    const draft = makeDraft({
      customFields: [
        { type: 3 as any, label: 'Linked', value: '' },
        { type: 0, label: 'Visible', value: 'x' },
      ],
    });
    setup(draft);
    expect(screen.queryByDisplayValue('Linked')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Visible')).toBeInTheDocument();
  });

  it('lists existing attachments with download + remove in edit mode', () => {
    const cipher = { id: 'c1', type: 1 } as Cipher;
    const attachments = [{ id: 'a1', decFileName: 'photo.png', size: 2048 }];
    const { onDownloadAttachment, onToggleExistingAttachmentRemoval } = setup(makeDraft(), {
      isCreating: false,
      selectedCipher: cipher,
      editExistingAttachments: attachments,
    });
    const row = screen.getByText('photo.png').closest('.attachment-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Download/ }));
    expect(onDownloadAttachment).toHaveBeenCalledWith(cipher, 'a1');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(onToggleExistingAttachmentRemoval).toHaveBeenCalledWith('a1');
  });

  it('shows the removed state and a cancel button for a marked attachment', () => {
    const cipher = { id: 'c1', type: 1 } as Cipher;
    const attachments = [{ id: 'a1', decFileName: 'photo.png', size: 2048 }];
    setup(makeDraft(), {
      isCreating: false,
      selectedCipher: cipher,
      editExistingAttachments: attachments,
      removedAttachmentIds: { a1: true },
      removedAttachmentCount: 1,
    });
    const row = screen.getByText('photo.png').closest('.attachment-row') as HTMLElement;
    expect(row).toHaveClass('is-removed');
    // The toggle button now reads "Cancel".
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText('1 attachment(s) will be removed on save')).toBeInTheDocument();
  });

  it('shows a download progress percentage label while downloading', () => {
    const cipher = { id: 'c1', type: 1 } as Cipher;
    const attachments = [{ id: 'a1', decFileName: 'photo.png', size: 2048 }];
    setup(makeDraft(), {
      isCreating: false,
      selectedCipher: cipher,
      editExistingAttachments: attachments,
      downloadingAttachmentKey: 'c1:a1',
      attachmentDownloadPercent: 42,
    });
    expect(screen.getByText('Downloading 42%')).toBeInTheDocument();
  });

  it('shows an upload status line while an attachment is uploading', () => {
    setup(makeDraft(), {
      uploadingAttachmentName: 'photo.png',
      attachmentUploadPercent: 75,
    });
    expect(screen.getByText('Uploading photo.png 75%')).toBeInTheDocument();
  });

  it('queues attachment files chosen through the hidden file input', async () => {
    const { onQueueAttachmentFiles, container } = setup(makeDraft());
    const input = container.querySelector('input.attachment-file-input') as HTMLInputElement;
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    expect(onQueueAttachmentFiles).toHaveBeenCalledTimes(1);
    const passed = onQueueAttachmentFiles.mock.calls[0][0] as FileList;
    expect(passed[0]).toBe(file);
  });
});
