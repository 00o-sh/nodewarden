import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import VaultDetailView from '@/components/vault/VaultDetailView';
import type { Cipher } from '@/lib/types';

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
