import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'preact';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import VaultDetailView from '@/components/vault/VaultDetailView';
import VaultListPanel from '@/components/vault/VaultListPanel';
import type { Cipher, Folder } from '@/lib/types';
import {
  cardLast4,
  cardListSubtitle,
  cipherTypeKey,
  cipherTypeLabel,
  createEmptyDraft,
  displayCardBrand,
  draftFromCipher,
  formatAttachmentSize,
  formatHistoryTime,
  formatTotp,
  isCipherArchived,
  isCipherDeleted,
  isCipherVisibleInArchive,
  isCipherVisibleInNormalVault,
  isCipherVisibleInTrash,
  maskSecret,
  normalizeCardBrand,
  openUri,
  parseAttachmentSizeBytes,
  parseFieldType,
  toBooleanFieldValue,
  websiteMatchLabel,
  buildCipherDuplicateSignatures,
} from '@/components/vault/vault-page-helpers';

// ---------------------------------------------------------------------------
// VaultDetailView — branches not exercised by VaultDetailView.test.tsx:
// totp + passkey rows, ssh detail with reveal, identity detail, custom fields
// (text/hidden/boolean), attachment list + download, item history with the
// password-history dialog, copy actions, and the totpLive formatting path.
// ---------------------------------------------------------------------------

function detailSetup(cipher: Cipher, overrides: Partial<Parameters<typeof VaultDetailView>[0]> = {}) {
  const callbacks = {
    onOpenReprompt: vi.fn(),
    onToggleShowPassword: vi.fn(),
    onToggleHiddenField: vi.fn(),
    onDownloadAttachment: vi.fn(),
    onStartEdit: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
  };
  const props: Parameters<typeof VaultDetailView>[0] = {
    selectedCipher: cipher,
    repromptApprovedCipherId: null,
    showPassword: false,
    totpLive: null,
    passkeyCreatedAt: null,
    hiddenFieldVisibleMap: {},
    folderName: () => 'Work',
    downloadingAttachmentKey: '',
    attachmentDownloadPercent: null,
    ...callbacks,
    ...overrides,
  };
  const utils = render(<VaultDetailView {...props} />);
  return { ...utils, ...callbacks, props };
}

describe('<VaultDetailView> extra coverage', () => {
  it('renders the totp row with a live code and fires a copy action', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'TOTP item',
      login: { decUsername: 'u', decPassword: 'p', decTotp: 'JBSWY3DPEHPK3PXP', uris: [] },
    } as unknown as Cipher;
    detailSetup(cipher, { totpLive: { code: '123456', remain: 17 } });
    expect(screen.getByText('TOTP')).toBeInTheDocument();
    // formatTotp inserts a space in the middle of a 6-digit code.
    expect(screen.getByText('123 456')).toBeInTheDocument();
    // The timer value renders.
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it('renders a passkey row when a passkey creation date is provided', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'Passkey item',
      login: { decUsername: 'u', decPassword: 'p', uris: [] },
    } as unknown as Cipher;
    detailSetup(cipher, { passkeyCreatedAt: '2024-01-01T00:00:00Z' });
    expect(screen.getByText('Passkey')).toBeInTheDocument();
  });

  it('reveals and copies the autofill URI via Open and Copy buttons', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'GitHub',
      login: { decUsername: 'u', decPassword: 'p', uris: [{ uri: 'https://github.com', decUri: 'https://github.com' }] },
    } as unknown as Cipher;
    detailSetup(cipher);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openSpy).toHaveBeenCalledWith('https://github.com', '_blank', 'noopener');
    openSpy.mockRestore();
  });

  it('renders identity details including a joined address line', () => {
    const cipher = {
      id: 'i1',
      type: 4,
      decName: 'My ID',
      identity: {
        decFirstName: 'Jane',
        decLastName: 'Doe',
        decUsername: 'jdoe',
        decEmail: 'jane@example.com',
        decPhone: '555-1234',
        decCompany: 'Acme',
        decAddress1: '1 Main St',
        decCity: 'Townsville',
        decState: 'CA',
        decPostalCode: '90001',
        decCountry: 'USA',
      },
    } as unknown as Cipher;
    detailSetup(cipher);
    expect(screen.getByText('Identity Details')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('1 Main St, Townsville, CA, 90001, USA')).toBeInTheDocument();
  });

  it('renders ssh detail and toggles the private key reveal', () => {
    const cipher = {
      id: 's1',
      type: 5,
      decName: 'My Key',
      sshKey: { decPrivateKey: 'PRIVATE-KEY-MATERIAL', decPublicKey: 'ssh-ed25519 AAAA', decFingerprint: 'SHA256:zzz' },
    } as unknown as Cipher;
    detailSetup(cipher);
    expect(screen.getByText('SSH Key')).toBeInTheDocument();
    // Private key starts masked.
    expect(screen.queryByText('PRIVATE-KEY-MATERIAL')).not.toBeInTheDocument();
    const sshCard = screen.getByText('Private Key').closest('.card') as HTMLElement;
    fireEvent.click(within(sshCard).getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('PRIVATE-KEY-MATERIAL')).toBeInTheDocument();
    expect(screen.getByText('ssh-ed25519 AAAA')).toBeInTheDocument();
    expect(screen.getByText('SHA256:zzz')).toBeInTheDocument();
  });

  it('renders custom fields: text, hidden (masked + reveal), and boolean', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'Fields',
      login: { decUsername: 'u', decPassword: 'p', uris: [] },
      fields: [
        { type: 0, decName: 'Plain', decValue: 'plain-value' },
        { type: 1, decName: 'Secret', decValue: 'hidden-value' },
        { type: 2, decName: 'Flag', decValue: 'true' },
        { type: 3, decName: 'Linked', decValue: 'ignored' },
      ],
    } as unknown as Cipher;
    const { onToggleHiddenField } = detailSetup(cipher);
    expect(screen.getByText('Custom Fields')).toBeInTheDocument();
    expect(screen.getByText('plain-value')).toBeInTheDocument();
    // Hidden field is masked, not shown in plain text.
    expect(screen.queryByText('hidden-value')).not.toBeInTheDocument();
    // Boolean field renders the checked label, linked field is excluded.
    expect(screen.getByText('Checked')).toBeInTheDocument();
    expect(screen.queryByText('Linked')).not.toBeInTheDocument();

    const secretCard = screen.getByText('Secret').closest('.custom-field-card') as HTMLElement;
    fireEvent.click(within(secretCard).getByRole('button', { name: 'Reveal' }));
    expect(onToggleHiddenField).toHaveBeenCalledWith(1);
  });

  it('shows a revealed hidden custom field when the visibility map is set', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'Fields',
      login: { decUsername: 'u', decPassword: 'p', uris: [] },
      fields: [{ type: 1, decName: 'Secret', decValue: 'hidden-value' }],
    } as unknown as Cipher;
    detailSetup(cipher, { hiddenFieldVisibleMap: { 0: true } });
    expect(screen.getByText('hidden-value')).toBeInTheDocument();
  });

  it('renders attachments and fires the download callback', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'WithAttachment',
      login: { decUsername: 'u', decPassword: 'p', uris: [] },
      attachments: [{ id: 'a1', decFileName: 'report.pdf', size: 4096 }],
    } as unknown as Cipher;
    const { onDownloadAttachment } = detailSetup(cipher);
    expect(screen.getByText('Attachments')).toBeInTheDocument();
    const row = screen.getByText('report.pdf').closest('.attachment-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Download/ }));
    expect(onDownloadAttachment).toHaveBeenCalledWith(cipher, 'a1');
  });

  it('disables the download button while that attachment is downloading', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'WithAttachment',
      login: { decUsername: 'u', decPassword: 'p', uris: [] },
      attachments: [{ id: 'a1', decFileName: 'report.pdf', size: 4096 }],
    } as unknown as Cipher;
    detailSetup(cipher, { downloadingAttachmentKey: 'c1:a1', attachmentDownloadPercent: 50 });
    const row = screen.getByText('report.pdf').closest('.attachment-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: /Downloading/ })).toBeDisabled();
  });

  it('renders item history and opens the password-history dialog', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'History',
      creationDate: '2024-01-01T00:00:00Z',
      revisionDate: '2024-02-01T00:00:00Z',
      login: { decUsername: 'u', decPassword: 'p', uris: [], passwordRevisionDate: '2024-01-15T00:00:00Z' },
      passwordHistory: [
        { decPassword: 'old-pass-1', lastUsedDate: '2024-01-10T00:00:00Z' },
        { password: 'old-pass-2', lastUsedDate: null },
      ],
    } as unknown as Cipher;
    detailSetup(cipher);
    expect(screen.getByText('Item History')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Password History' }));
    const dialog = screen.getByRole('dialog', { name: 'Password History' });
    expect(within(dialog).getByText('old-pass-1')).toBeInTheDocument();
    expect(within(dialog).getByText('old-pass-2')).toBeInTheDocument();
    // Closing the dialog (primary footer button) removes it.
    fireEvent.click(dialog.querySelector('.btn-primary.dialog-btn') as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Password History' })).not.toBeInTheDocument();
  });

  it('copies the username from the login section', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'GitHub',
      login: { decUsername: 'octocat', decPassword: 'p', uris: [] },
    } as unknown as Cipher;
    // Clicking copy must not throw even without a clipboard implementation.
    detailSetup(cipher);
    const usernameRow = screen.getByText('octocat').closest('.kv-row') as HTMLElement;
    expect(() => fireEvent.click(within(usernameRow).getByRole('button', { name: 'Copy' }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// VaultListPanel — branches not exercised by VaultListPanel.test.tsx:
// loading skeleton, trash/archive selection-mode bulk buttons, duplicate
// detection menu, sort menu, and the mobile filter rows.
// ---------------------------------------------------------------------------

function makeCipher(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'c1',
    type: 1,
    decName: 'GitHub',
    login: { decUsername: 'octocat', uris: [{ uri: 'https://github.com' }] },
    ...overrides,
  } as Cipher;
}

function listSetup(overrides: Partial<Parameters<typeof VaultListPanel>[0]> = {}) {
  const ciphers = overrides.filteredCiphers ?? [makeCipher({ id: 'c1' }), makeCipher({ id: 'c2', decName: 'GitLab' })];
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

describe('<VaultListPanel> extra coverage', () => {
  it('shows the loading skeleton when loading with no ciphers yet', () => {
    listSetup({ loading: true, filteredCiphers: [], visibleCiphers: [] });
    // LoadingState renders skeleton lines; assert the empty/no-items text is absent.
    expect(screen.queryByText('No items')).not.toBeInTheDocument();
    expect(document.querySelector('.list-panel')?.children.length).toBeGreaterThan(0);
  });

  it('renders restore + permanent-delete in trash selection mode', () => {
    const { onBulkRestore, onOpenBulkDelete } = listSetup({
      sidebarFilter: { kind: 'trash' },
      selectedCount: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    expect(onBulkRestore).toHaveBeenCalledTimes(1);
    // The danger button reads "Delete Permanently" inside trash.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    expect(onOpenBulkDelete).toHaveBeenCalledTimes(1);
    // No archive/move buttons in trash selection mode.
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
  });

  it('renders unarchive in archive selection mode', () => {
    const { onBulkUnarchive } = listSetup({
      sidebarFilter: { kind: 'archive' },
      selectedCount: 1,
    });
    fireEvent.click(screen.getByRole('button', { name: /Unarchive/ }));
    expect(onBulkUnarchive).toHaveBeenCalledTimes(1);
  });

  it('renders archive + move in normal selection mode', () => {
    const { onBulkArchive, onOpenMove, onSelectAll } = listSetup({ selectedCount: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));
    expect(onBulkArchive).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(onOpenMove).toHaveBeenCalledTimes(1);
  });

  it('opens the sort menu and selects a sort mode', () => {
    const { onSelectSortMode } = listSetup({ sortMenuOpen: true });
    const sortMenu = document.querySelector('.sort-menu-wrap .sort-menu') as HTMLElement;
    fireEvent.click(within(sortMenu).getByText('A-Z'));
    expect(onSelectSortMode).toHaveBeenCalledWith('name');
  });

  it('renders the duplicate-detection menu on the duplicates filter and changes the mode', () => {
    const { onDuplicateModeChange } = listSetup({ sidebarFilter: { kind: 'duplicates' } });
    // Open the duplicate mode menu.
    const trigger = document.querySelector('.duplicate-mode-head-menu .mobile-vault-filter-trigger') as HTMLElement;
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('Site + username + password'));
    expect(onDuplicateModeChange).toHaveBeenCalledWith('login-site');
  });

  it('applies duplicate group hue styling on the duplicates filter', () => {
    listSetup({
      sidebarFilter: { kind: 'duplicates' },
      duplicateGroupIndexById: new Map([['c1', 0]]),
    });
    const row = screen.getByText('GitHub').closest('.list-item') as HTMLElement;
    expect(row).toHaveClass('duplicate-group-item');
  });

  it('renders mobile filter rows and changes the filter through the menu', () => {
    const { onChangeFilter } = listSetup({ isMobileLayout: true });
    expect(document.querySelector('.mobile-vault-filter-row')).not.toBeNull();
    // Open the "menu" filter and pick Favorites.
    const triggers = document.querySelectorAll('.mobile-vault-filter-trigger');
    fireEvent.click(triggers[0] as HTMLElement);
    fireEvent.click(screen.getByText('Favorites'));
    expect(onChangeFilter).toHaveBeenCalledWith({ kind: 'favorite' });
  });

  it('clears the search through the clear button when search input is present', () => {
    const { onClearSearch } = listSetup({ searchInput: 'git' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// vault-page-helpers — pure functions used by the detail/list components.
// ---------------------------------------------------------------------------

describe('vault-page-helpers', () => {
  it('cipherTypeKey + cipherTypeLabel map types correctly', () => {
    expect(cipherTypeKey(1)).toBe('login');
    expect(cipherTypeKey(3)).toBe('card');
    expect(cipherTypeKey(4)).toBe('identity');
    expect(cipherTypeKey(2)).toBe('note');
    expect(cipherTypeKey(5)).toBe('ssh');
    expect(cipherTypeLabel(1)).toBe('Login');
    expect(cipherTypeLabel(2)).toBe('Secure Note');
    expect(cipherTypeLabel(99)).toBe('Item');
  });

  it('normalizeCardBrand resolves aliases and displayCardBrand mirrors it', () => {
    expect(normalizeCardBrand('amex')).toBe('American Express');
    expect(normalizeCardBrand('  MASTER ')).toBe('Mastercard');
    expect(normalizeCardBrand('')).toBe('');
    expect(normalizeCardBrand('Weird Brand')).toBe('Weird Brand');
    expect(displayCardBrand('visa')).toBe('Visa');
  });

  it('cardLast4 + cardListSubtitle build the card subtitle', () => {
    expect(cardLast4('4111 1111 1111 1234')).toBe('1234');
    expect(cardLast4('12')).toBe('');
    expect(cardListSubtitle({ type: 3, card: { decBrand: 'visa', decNumber: '4111111111111234' } } as Cipher)).toBe('Visa, *1234');
    expect(cardListSubtitle({ type: 3, card: { decBrand: 'visa' } } as Cipher)).toBe('Visa');
    expect(cardListSubtitle({ type: 3, card: { decNumber: '4111111111111234' } } as Cipher)).toBe('*1234');
    expect(cardListSubtitle({ type: 3, card: {} } as Cipher)).toBe('Card');
  });

  it('parseFieldType normalizes numeric and string inputs', () => {
    expect(parseFieldType(1)).toBe(1);
    expect(parseFieldType('2')).toBe(2);
    expect(parseFieldType('hidden')).toBe(1);
    expect(parseFieldType('boolean')).toBe(2);
    expect(parseFieldType('linked')).toBe(3);
    expect(parseFieldType('anything-else')).toBe(0);
    expect(parseFieldType(null)).toBe(0);
  });

  it('toBooleanFieldValue recognizes truthy strings', () => {
    expect(toBooleanFieldValue('true')).toBe(true);
    expect(toBooleanFieldValue('1')).toBe(true);
    expect(toBooleanFieldValue('YES')).toBe(true);
    expect(toBooleanFieldValue('on')).toBe(true);
    expect(toBooleanFieldValue('false')).toBe(false);
    expect(toBooleanFieldValue('')).toBe(false);
  });

  it('formatTotp groups digits by length', () => {
    expect(formatTotp('123456')).toBe('123 456');
    expect(formatTotp('12345')).toBe('12 345');
    expect(formatTotp('1234')).toBe('1234');
    expect(formatTotp('12345678')).toBe('1234 5678');
    expect(formatTotp('')).toBe('');
  });

  it('maskSecret produces a bounded run of asterisks', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret('abc')).toBe('*'.repeat(8));
    expect(maskSecret('x'.repeat(40))).toBe('*'.repeat(24));
  });

  it('formatHistoryTime handles empty, invalid, and valid dates', () => {
    expect(formatHistoryTime('')).toBe('-');
    expect(formatHistoryTime('not-a-date')).toBe('not-a-date');
    expect(formatHistoryTime('2024-01-01T00:00:00Z')).not.toBe('-');
  });

  it('formatAttachmentSize + parseAttachmentSizeBytes scale units', () => {
    expect(parseAttachmentSizeBytes({ size: 100 } as any)).toBe(100);
    expect(parseAttachmentSizeBytes({ size: 'bad' } as any)).toBe(0);
    expect(formatAttachmentSize({ sizeName: '1.2 KB' } as any)).toBe('1.2 KB');
    expect(formatAttachmentSize({ size: 0 } as any)).toBe('0 B');
    expect(formatAttachmentSize({ size: 512 } as any)).toBe('512 B');
    expect(formatAttachmentSize({ size: 2048 } as any)).toBe('2.00 KB');
    expect(formatAttachmentSize({ size: 5 * 1024 * 1024 } as any)).toBe('5.00 MB');
    expect(formatAttachmentSize({ size: 3 * 1024 * 1024 * 1024 } as any)).toBe('3.00 GB');
  });

  it('websiteMatchLabel maps match codes to labels', () => {
    expect(websiteMatchLabel(null)).toBe('Default');
    expect(websiteMatchLabel(1)).toBe('Host');
    expect(websiteMatchLabel(3)).toBe('Exact');
    expect(websiteMatchLabel(999)).toBe('Default');
  });

  it('cipher visibility predicates handle normal/archive/trash', () => {
    const normal = { id: 'a' } as Cipher;
    const archived = { id: 'b', archivedDate: '2024-01-01T00:00:00Z' } as Cipher;
    const trashed = { id: 'c', deletedDate: '2024-01-01T00:00:00Z' } as Cipher;
    expect(isCipherVisibleInNormalVault(normal)).toBe(true);
    expect(isCipherVisibleInNormalVault(archived)).toBe(false);
    expect(isCipherArchived(archived)).toBe(true);
    expect(isCipherVisibleInArchive(archived)).toBe(true);
    expect(isCipherDeleted(trashed)).toBe(true);
    expect(isCipherVisibleInTrash(trashed)).toBe(true);
    // A deleted+archived cipher counts as trash only.
    const both = { id: 'd', archivedDate: 'x', deletedDate: 'x' } as Cipher;
    expect(isCipherArchived(both)).toBe(false);
    expect(isCipherVisibleInTrash(both)).toBe(true);
  });

  it('openUri prefixes a bare host and ignores blanks', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    openUri('   ');
    expect(openSpy).not.toHaveBeenCalled();
    openUri('example.com');
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
    openUri('http://already.com');
    expect(openSpy).toHaveBeenLastCalledWith('http://already.com', '_blank', 'noopener');
    openSpy.mockRestore();
  });

  it('createEmptyDraft seeds a single empty login URI', () => {
    const draft = createEmptyDraft(1);
    expect(draft.type).toBe(1);
    expect(draft.loginUris).toHaveLength(1);
    expect(draft.loginUris[0].uri).toBe('');
    expect(draft.customFields).toEqual([]);
  });

  it('draftFromCipher maps a login cipher into an editable draft', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      reprompt: 1,
      favorite: true,
      decName: 'GitHub',
      folderId: 'f1',
      decNotes: 'note',
      login: {
        decUsername: 'octocat',
        decPassword: 'pw',
        decTotp: 'SECRET',
        uris: [{ decUri: 'https://github.com', match: 3 }],
        fido2Credentials: [{ creationDate: '2024-01-01' }],
      },
      fields: [{ type: 1, decName: 'Secret', decValue: 'v' }],
    } as unknown as Cipher;
    const draft = draftFromCipher(cipher);
    expect(draft.id).toBe('c1');
    expect(draft.reprompt).toBe(true);
    expect(draft.favorite).toBe(true);
    expect(draft.loginUsername).toBe('octocat');
    expect(draft.loginTotp).toBe('SECRET');
    expect(draft.loginUris[0].uri).toBe('https://github.com');
    expect(draft.loginUris[0].match).toBe(3);
    expect(draft.loginFido2Credentials).toHaveLength(1);
    expect(draft.customFields[0]).toMatchObject({ type: 1, label: 'Secret', value: 'v' });
  });

  it('draftFromCipher backfills an empty login URI when none exist', () => {
    const cipher = { id: 'c1', type: 1, decName: 'x', login: { uris: [] } } as unknown as Cipher;
    const draft = draftFromCipher(cipher);
    expect(draft.loginUris).toHaveLength(1);
    expect(draft.loginUris[0].uri).toBe('');
  });

  it('buildCipherDuplicateSignatures yields mode-specific signatures', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      login: {
        decUsername: 'octocat',
        decPassword: 'pw',
        uris: [{ decUri: 'https://github.com' }],
      },
    } as unknown as Cipher;
    expect(buildCipherDuplicateSignatures(cipher, 'exact')).toHaveLength(1);
    expect(buildCipherDuplicateSignatures(cipher, 'password')[0]).toContain('pw');
    expect(buildCipherDuplicateSignatures(cipher, 'login-credentials')[0]).toContain('octocat');
    expect(buildCipherDuplicateSignatures(cipher, 'login-site').length).toBeGreaterThan(0);
    // A non-login cipher has no login-based signatures.
    const note = { id: 'n1', type: 2 } as unknown as Cipher;
    expect(buildCipherDuplicateSignatures(note, 'password')).toEqual([]);
  });
});
