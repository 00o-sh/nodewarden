import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import VaultDetailView from '@/components/vault/VaultDetailView';
import { checkPasswordLeaked } from '@/lib/password-security';
import type { Cipher } from '@/lib/types';

vi.mock('@/lib/password-security', () => ({
  checkPasswordLeaked: vi.fn(),
}));

const mockedCheckPasswordLeaked = vi.mocked(checkPasswordLeaked);

function makeLoginCipher(overrides: Partial<Cipher> = {}): Cipher {
  return {
    id: 'c1',
    type: 1,
    decName: 'GitHub Account',
    folderId: 'f1',
    login: {
      decUsername: 'octocat',
      decPassword: 's3cret-pass',
      uris: [{ uri: 'https://github.com', decUri: 'https://github.com' }],
    },
    ...overrides,
  } as Cipher;
}

function setup(cipher: Cipher, overrides: Partial<Parameters<typeof VaultDetailView>[0]> = {}) {
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

describe('<VaultDetailView>', () => {
  it('renders the cipher name and folder', () => {
    setup(makeLoginCipher());
    expect(screen.getByText('GitHub Account')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('renders login credential fields (username, masked password)', () => {
    setup(makeLoginCipher());
    expect(screen.getByText('octocat')).toBeInTheDocument();
    expect(screen.getByText('Login Credentials')).toBeInTheDocument();
    // password masked while showPassword is false
    expect(screen.queryByText('s3cret-pass')).not.toBeInTheDocument();
  });

  it('reveals the password when showPassword is set', () => {
    setup(makeLoginCipher(), { showPassword: true });
    expect(screen.getByText('s3cret-pass')).toBeInTheDocument();
  });

  it('fires onToggleShowPassword when the reveal button is clicked', () => {
    const { onToggleShowPassword } = setup(makeLoginCipher());
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(onToggleShowPassword).toHaveBeenCalledTimes(1);
  });

  it('renders the autofill website URI', () => {
    setup(makeLoginCipher());
    expect(screen.getByText('https://github.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('fires onStartEdit, onArchive, and onDelete from the action bar', () => {
    const { onStartEdit, onArchive, onDelete } = setup(makeLoginCipher());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onStartEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows restore + permanent delete for a deleted cipher', () => {
    const { onRestore, onDelete } = setup(makeLoginCipher({ deletedDate: '2024-01-01T00:00:00Z' }));
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows unarchive instead of archive for an archived cipher', () => {
    const { onUnarchive } = setup(makeLoginCipher({ archivedDate: '2024-01-01T00:00:00Z' }));
    expect(screen.getByText('Archived')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    expect(onUnarchive).toHaveBeenCalledTimes(1);
  });

  it('shows the reprompt unlock gate and fires onOpenReprompt', () => {
    const cipher = makeLoginCipher({ reprompt: 1 });
    const { onOpenReprompt } = setup(cipher, { repromptApprovedCipherId: null });
    // gated: credentials hidden
    expect(screen.queryByText('octocat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Details' }));
    expect(onOpenReprompt).toHaveBeenCalledTimes(1);
  });

  it('renders card details for a card cipher', () => {
    const card = {
      id: 'card1',
      type: 3,
      decName: 'My Visa',
      card: {
        decCardholderName: 'Jane Doe',
        decNumber: '4111111111111111',
        decBrand: 'Visa',
        decExpMonth: '12',
        decExpYear: '2030',
        decCode: '123',
      },
    } as unknown as Cipher;
    setup(card);
    expect(screen.getByText('Card Details')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('4111111111111111')).toBeInTheDocument();
  });

  it('renders notes when present', () => {
    setup(makeLoginCipher({ decNotes: 'remember this' }));
    expect(screen.getByText('remember this')).toBeInTheDocument();
  });

  it('renders the live TOTP code and countdown when totpLive is set', () => {
    const cipher = makeLoginCipher({
      login: {
        decUsername: 'octocat',
        decPassword: 's3cret-pass',
        decTotp: 'otpauth://totp/x?secret=ABC',
        uris: [{ uri: 'https://github.com', decUri: 'https://github.com' }],
      },
    } as Partial<Cipher>);
    setup(cipher, { totpLive: { code: '123456', remain: 12, period: 30 } });
    // Codes render grouped into two halves ("123 456").
    expect(screen.getByText('123 456')).toBeInTheDocument();
    // The countdown ring uses the remaining seconds.
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders bank account details for a bank cipher (type 6)', () => {
    const bank = {
      id: 'bank1',
      type: 6,
      decName: 'Chase Checking',
      bankAccount: {
        decBankName: 'Chase',
        decNameOnAccount: 'Jane Doe',
        decAccountType: 'Checking',
        decAccountNumber: '000123456789',
        decRoutingNumber: '021000021',
        decBranchNumber: '004',
        decPin: '4321',
        decSwiftCode: 'CHASUS33',
        decIban: 'GB29NWBK60161331926819',
        decBankContactPhone: '+1-800-935-9935',
      },
    } as unknown as Cipher;
    setup(bank);
    expect(screen.getByText('Bank Account Details')).toBeInTheDocument();
    expect(screen.getByText('Chase')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('000123456789')).toBeInTheDocument();
    expect(screen.getByText('GB29NWBK60161331926819')).toBeInTheDocument();
  });

  it('renders drivers license details for a license cipher (type 7)', () => {
    const license = {
      id: 'lic1',
      type: 7,
      decName: 'My License',
      driversLicense: {
        decFirstName: 'John',
        decMiddleName: 'Q',
        decLastName: 'Public',
        decDateOfBirth: '1990-01-02',
        decLicenseNumber: 'D1234567',
        decIssuingCountry: 'USA',
        decIssuingState: 'CA',
        decIssueDate: '2020-01-01',
        decExpirationDate: '2028-01-01',
        decIssuingAuthority: 'DMV',
        decLicenseClass: 'C',
      },
    } as unknown as Cipher;
    setup(license);
    expect(screen.getByText('Driver License Details')).toBeInTheDocument();
    expect(screen.getByText('John Q Public')).toBeInTheDocument();
    expect(screen.getByText('D1234567')).toBeInTheDocument();
    expect(screen.getByText('CA')).toBeInTheDocument();
  });

  it('renders passport details for a passport cipher (type 8)', () => {
    const passport = {
      id: 'pass1',
      type: 8,
      decName: 'My Passport',
      passport: {
        decSurname: 'Public',
        decGivenName: 'John',
        decDateOfBirth: '1990-01-02',
        decSex: 'M',
        decBirthPlace: 'Springfield',
        decNationality: 'American',
        decIssuingCountry: 'USA',
        decPassportNumber: 'X1234567',
        decPassportType: 'P',
        decNationalIdentificationNumber: 'N999',
        decIssuingAuthority: 'State Dept',
        decIssueDate: '2019-05-01',
        decExpirationDate: '2029-05-01',
      },
    } as unknown as Cipher;
    setup(passport);
    expect(screen.getByText('Passport Details')).toBeInTheDocument();
    expect(screen.getByText('John Public')).toBeInTheDocument();
    expect(screen.getByText('X1234567')).toBeInTheDocument();
    expect(screen.getByText('American')).toBeInTheDocument();
  });
});

describe('<VaultDetailView> additional coverage', () => {
  beforeEach(() => {
    mockedCheckPasswordLeaked.mockReset();
  });

  it('falls back to the no-name placeholder when the cipher has no name', () => {
    setup(makeLoginCipher({ decName: '' }));
    expect(screen.getByText('(No Name)')).toBeInTheDocument();
  });

  it('renders empty login fields without throwing (username/password fallbacks)', () => {
    const cipher = { id: 'c1', type: 1, decName: 'Empty', login: {} } as unknown as Cipher;
    expect(() => setup(cipher)).not.toThrow();
    expect(screen.getByText('Login Credentials')).toBeInTheDocument();
  });

  it('copies the password and fires the copy button in the login section', () => {
    setup(makeLoginCipher());
    const passwordRow = screen.getByText('Password').closest('.kv-row') as HTMLElement;
    const copyBtn = within(passwordRow).getByRole('button', { name: 'Copy' });
    expect(() => fireEvent.click(copyBtn)).not.toThrow();
  });

  it('renders the TOTP placeholder and zero countdown when totpLive is null', () => {
    const cipher = makeLoginCipher({
      login: {
        decUsername: 'octocat',
        decPassword: 's3cret-pass',
        decTotp: 'otpauth://totp/x?secret=ABC',
        uris: [],
      },
    } as Partial<Cipher>);
    setup(cipher, { totpLive: null });
    expect(screen.getByText('TOTP')).toBeInTheDocument();
    // Countdown shows 0 while there is no live code yet.
    const totpRow = screen.getByText('TOTP').closest('.kv-row') as HTMLElement;
    expect(within(totpRow).getByText('0')).toBeInTheDocument();
    // The copy button still fires without a live code.
    expect(() => fireEvent.click(within(totpRow).getByRole('button', { name: 'Copy' }))).not.toThrow();
  });

  it('skips autofill URIs whose value is blank', () => {
    const cipher = makeLoginCipher({
      login: {
        decUsername: 'octocat',
        decPassword: 's3cret-pass',
        uris: [{ uri: '', decUri: '' }],
      },
    } as Partial<Cipher>);
    setup(cipher);
    // The autofill card renders (uris length > 0) but the blank URI produces no row.
    expect(screen.getByText('Autofill Options')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('copies an autofill URI value', () => {
    setup(makeLoginCipher());
    const uriRow = screen.getByText('https://github.com').closest('.kv-row') as HTMLElement;
    expect(() => fireEvent.click(within(uriRow).getByRole('button', { name: 'Copy' }))).not.toThrow();
  });

  it('renders empty card fields without throwing (value fallbacks)', () => {
    const card = { id: 'card1', type: 3, decName: 'Blank Card', card: {} } as unknown as Cipher;
    expect(() => setup(card)).not.toThrow();
    expect(screen.getByText('Card Details')).toBeInTheDocument();
  });

  it('renders empty identity fields without throwing', () => {
    const identity = { id: 'i1', type: 4, decName: 'Blank ID', identity: {} } as unknown as Cipher;
    expect(() => setup(identity)).not.toThrow();
    expect(screen.getByText('Identity Details')).toBeInTheDocument();
  });

  it('renders empty ssh key fields and copies each value', () => {
    const cipher = { id: 's1', type: 5, decName: 'Blank Key', sshKey: {} } as unknown as Cipher;
    setup(cipher);
    expect(screen.getByText('SSH Key')).toBeInTheDocument();
    const copyButtons = screen.getAllByRole('button', { name: 'Copy' });
    // Public key + fingerprint + private key copy buttons all fire safely.
    copyButtons.forEach((btn) => expect(() => fireEvent.click(btn)).not.toThrow());
  });

  it('renders empty bank account fields without throwing', () => {
    const bank = { id: 'b1', type: 6, decName: 'Blank Bank', bankAccount: {} } as unknown as Cipher;
    expect(() => setup(bank)).not.toThrow();
    expect(screen.getByText('Bank Account Details')).toBeInTheDocument();
  });

  it('renders empty drivers license fields without throwing', () => {
    const license = { id: 'l1', type: 7, decName: 'Blank License', driversLicense: {} } as unknown as Cipher;
    expect(() => setup(license)).not.toThrow();
    expect(screen.getByText('Driver License Details')).toBeInTheDocument();
  });

  it('renders empty passport fields without throwing', () => {
    const passport = { id: 'p1', type: 8, decName: 'Blank Passport', passport: {} } as unknown as Cipher;
    expect(() => setup(passport)).not.toThrow();
    expect(screen.getByText('Passport Details')).toBeInTheDocument();
  });

  it('copies text and boolean custom field values', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'Fields',
      login: { decUsername: 'u', decPassword: 'p', uris: [] },
      fields: [
        { type: 0, decName: 'Plain', decValue: 'plain-value' },
        { type: 2, decName: 'Flag', decValue: 'false' },
      ],
    } as unknown as Cipher;
    setup(cipher);
    const plainCard = screen.getByText('Plain').closest('.custom-field-card') as HTMLElement;
    expect(() => fireEvent.click(within(plainCard).getByRole('button', { name: 'Copy' }))).not.toThrow();
    // An unchecked boolean field renders the unchecked label and a copy action.
    const flagCard = screen.getByText('Unchecked').closest('.custom-field-card') as HTMLElement;
    expect(() => fireEvent.click(within(flagCard).getByRole('button', { name: 'Copy' }))).not.toThrow();
  });

  it('skips attachments with a blank id', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'Attach',
      login: { decUsername: 'u', decPassword: 'p', uris: [] },
      attachments: [
        { id: '   ', decFileName: 'ignored.pdf', size: 10 },
        { id: 'a2', size: 20 },
      ],
    } as unknown as Cipher;
    setup(cipher);
    expect(screen.getByText('Attachments')).toBeInTheDocument();
    // Blank-id attachment is skipped; the a2 attachment falls back to its id as filename.
    expect(screen.queryByText('ignored.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('a2')).toBeInTheDocument();
  });

  it('copies a password-history entry from the dialog', () => {
    const cipher = {
      id: 'c1',
      type: 1,
      decName: 'History',
      creationDate: '2024-01-01T00:00:00Z',
      revisionDate: '2024-02-01T00:00:00Z',
      login: { decUsername: 'u', decPassword: 'p', uris: [] },
      passwordHistory: [{ decPassword: 'old-pass-1', lastUsedDate: '2024-01-10T00:00:00Z' }],
    } as unknown as Cipher;
    setup(cipher);
    fireEvent.click(screen.getByRole('button', { name: 'Password History' }));
    const dialog = screen.getByRole('dialog', { name: 'Password History' });
    const copyBtn = dialog.querySelector('.password-history-copy-btn') as HTMLElement;
    expect(() => fireEvent.click(copyBtn)).not.toThrow();
  });

  it('shows the exposed-count breach result when the password is found in a breach', async () => {
    mockedCheckPasswordLeaked.mockResolvedValue({ count: 5, available: true });
    setup(makeLoginCipher());
    fireEvent.click(screen.getByRole('button', { name: 'Check breach' }));
    expect(await screen.findByText('Found in 5 breaches')).toBeInTheDocument();
    expect(mockedCheckPasswordLeaked).toHaveBeenCalledTimes(1);
  });

  it('shows the safe breach result when the password is not found', async () => {
    mockedCheckPasswordLeaked.mockResolvedValue({ count: 0, available: true });
    setup(makeLoginCipher());
    fireEvent.click(screen.getByRole('button', { name: 'Check breach' }));
    expect(await screen.findByText('Not found in the breach database')).toBeInTheDocument();
  });

  it('shows the failure notice when the breach database is unavailable', async () => {
    mockedCheckPasswordLeaked.mockResolvedValue({ count: null, available: false });
    setup(makeLoginCipher());
    fireEvent.click(screen.getByRole('button', { name: 'Check breach' }));
    expect(await screen.findByText('The breach check could not be completed.')).toBeInTheDocument();
  });

  it('shows the failure notice when the breach check throws a non-abort error', async () => {
    mockedCheckPasswordLeaked.mockRejectedValue(new Error('network down'));
    setup(makeLoginCipher());
    fireEvent.click(screen.getByRole('button', { name: 'Check breach' }));
    expect(await screen.findByText('The breach check could not be completed.')).toBeInTheDocument();
  });

  it('disables the breach button and shows the checking state while a check is in flight', async () => {
    let resolveCheck: (value: { count: number | null; available: boolean }) => void = () => {};
    mockedCheckPasswordLeaked.mockImplementation(
      () => new Promise((resolve) => { resolveCheck = resolve; })
    );
    setup(makeLoginCipher());
    fireEvent.click(screen.getByRole('button', { name: 'Check breach' }));
    const checkingBtn = await screen.findByRole('button', { name: 'Checking' });
    expect(checkingBtn).toBeDisabled();
    resolveCheck({ count: 0, available: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check breach' })).toBeInTheDocument());
  });

  it('disables the breach button when there is no password to check', () => {
    const cipher = { id: 'c1', type: 1, decName: 'NoPass', login: { decUsername: 'u', uris: [] } } as unknown as Cipher;
    setup(cipher);
    expect(screen.getByRole('button', { name: 'Check breach' })).toBeDisabled();
  });
});
