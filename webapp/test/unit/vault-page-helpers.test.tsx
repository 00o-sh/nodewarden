import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import {
  bankAccountListSubtitle,
  driversLicenseListSubtitle,
  passportListSubtitle,
  cipherTypeKey,
  cipherTypeLabel,
  buildCipherDuplicateSignature,
  createEmptyDraft,
  draftFromCipher,
  TypeIcon,
} from '@/components/vault/vault-page-helpers';
import type { Cipher } from '@/lib/types';

function bankCipher(overrides: Record<string, unknown> = {}): Cipher {
  return {
    id: 'b1',
    type: 6,
    decName: 'Checking',
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
    ...overrides,
  } as unknown as Cipher;
}

function licenseCipher(overrides: Record<string, unknown> = {}): Cipher {
  return {
    id: 'l1',
    type: 7,
    decName: 'DL',
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
    ...overrides,
  } as unknown as Cipher;
}

function passportCipher(overrides: Record<string, unknown> = {}): Cipher {
  return {
    id: 'p1',
    type: 8,
    decName: 'Passport',
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
    ...overrides,
  } as unknown as Cipher;
}

describe('bank/license/passport list subtitles', () => {
  it('bankAccountListSubtitle joins bank name, type, and last-4 of the account number', () => {
    expect(bankAccountListSubtitle(bankCipher())).toBe('Chase, Checking, *6789');
  });

  it('bankAccountListSubtitle falls back to the type label when empty', () => {
    expect(bankAccountListSubtitle({ id: 'x', type: 6, bankAccount: {} } as unknown as Cipher)).toBe('Bank Account');
  });

  it('bankAccountListSubtitle prefers plaintext fields when decrypted fields are absent', () => {
    const cipher = { id: 'x', type: 6, bankAccount: { bankName: 'Ally', accountNumber: '9999' } } as unknown as Cipher;
    expect(bankAccountListSubtitle(cipher)).toBe('Ally, *9999');
  });

  it('driversLicenseListSubtitle returns the license number when present', () => {
    expect(driversLicenseListSubtitle(licenseCipher())).toBe('D1234567');
  });

  it('driversLicenseListSubtitle falls back to the name, then the type label', () => {
    const noNumber = licenseCipher({ driversLicense: { decFirstName: 'John', decLastName: 'Public' } });
    expect(driversLicenseListSubtitle(noNumber)).toBe('John Public');
    expect(driversLicenseListSubtitle({ id: 'x', type: 7, driversLicense: {} } as unknown as Cipher)).toBe('Driver License');
  });

  it('passportListSubtitle returns the passport number when present', () => {
    expect(passportListSubtitle(passportCipher())).toBe('X1234567');
  });

  it('passportListSubtitle falls back to the name, then the type label', () => {
    const noNumber = passportCipher({ passport: { decGivenName: 'John', decSurname: 'Public' } });
    expect(passportListSubtitle(noNumber)).toBe('John Public');
    expect(passportListSubtitle({ id: 'x', type: 8, passport: {} } as unknown as Cipher)).toBe('Passport');
  });
});

describe('cipherTypeKey / cipherTypeLabel for the new types', () => {
  it('maps types 6/7/8 to bank/license/passport keys', () => {
    expect(cipherTypeKey(6)).toBe('bank');
    expect(cipherTypeKey(7)).toBe('license');
    expect(cipherTypeKey(8)).toBe('passport');
  });

  it('falls back to the note key for unknown types', () => {
    expect(cipherTypeKey(99)).toBe('note');
  });

  it('labels types 6/7/8', () => {
    expect(cipherTypeLabel(6)).toBe('Bank Account');
    expect(cipherTypeLabel(7)).toBe('Driver License');
    expect(cipherTypeLabel(8)).toBe('Passport');
  });
});

describe('TypeIcon renders distinct icons for the new types', () => {
  it('renders a distinct svg icon for bank / license / passport', () => {
    const bank = render(<TypeIcon type={6} />).container.querySelector('svg');
    const license = render(<TypeIcon type={7} />).container.querySelector('svg');
    const passport = render(<TypeIcon type={8} />).container.querySelector('svg');
    expect(bank).not.toBeNull();
    expect(license).not.toBeNull();
    expect(passport).not.toBeNull();
    const classes = [bank, license, passport].map((el) => el?.getAttribute('class') || '');
    // Each of the three new types resolves to a different lucide glyph.
    expect(new Set(classes).size).toBe(3);
  });
});

describe('buildCipherDuplicateSignature includes new item payloads', () => {
  it('serializes bank account fields', () => {
    const parsed = JSON.parse(buildCipherDuplicateSignature(bankCipher()));
    expect(parsed.bankAccount).toMatchObject({
      bankName: 'Chase',
      nameOnAccount: 'Jane Doe',
      accountType: 'Checking',
      accountNumber: '000123456789',
      routingNumber: '021000021',
      branchNumber: '004',
      pin: '4321',
      swiftCode: 'CHASUS33',
      iban: 'GB29NWBK60161331926819',
      bankContactPhone: '+1-800-935-9935',
    });
  });

  it('serializes drivers license fields', () => {
    const parsed = JSON.parse(buildCipherDuplicateSignature(licenseCipher()));
    expect(parsed.driversLicense).toMatchObject({
      firstName: 'John',
      lastName: 'Public',
      licenseNumber: 'D1234567',
      issuingState: 'CA',
      licenseClass: 'C',
    });
  });

  it('serializes passport fields', () => {
    const parsed = JSON.parse(buildCipherDuplicateSignature(passportCipher()));
    expect(parsed.passport).toMatchObject({
      surname: 'Public',
      givenName: 'John',
      passportNumber: 'X1234567',
      nationality: 'American',
      nationalIdentificationNumber: 'N999',
      expirationDate: '2029-05-01',
    });
  });
});

describe('createEmptyDraft', () => {
  it('creates an empty bank draft with all bank fields blank', () => {
    const draft = createEmptyDraft(6);
    expect(draft.type).toBe(6);
    expect(draft.bankName).toBe('');
    expect(draft.bankAccountNumber).toBe('');
    expect(draft.licenseNumber).toBe('');
    expect(draft.passportNumber).toBe('');
  });
});

describe('draftFromCipher maps the new item types', () => {
  it('maps a bank cipher into bank draft fields', () => {
    const draft = draftFromCipher(bankCipher());
    expect(draft.id).toBe('b1');
    expect(draft.type).toBe(6);
    expect(draft.bankName).toBe('Chase');
    expect(draft.bankNameOnAccount).toBe('Jane Doe');
    expect(draft.bankAccountType).toBe('Checking');
    expect(draft.bankAccountNumber).toBe('000123456789');
    expect(draft.bankRoutingNumber).toBe('021000021');
    expect(draft.bankBranchNumber).toBe('004');
    expect(draft.bankPin).toBe('4321');
    expect(draft.bankSwiftCode).toBe('CHASUS33');
    expect(draft.bankIban).toBe('GB29NWBK60161331926819');
    expect(draft.bankContactPhone).toBe('+1-800-935-9935');
  });

  it('maps a drivers-license cipher into license draft fields', () => {
    const draft = draftFromCipher(licenseCipher());
    expect(draft.type).toBe(7);
    expect(draft.licenseFirstName).toBe('John');
    expect(draft.licenseMiddleName).toBe('Q');
    expect(draft.licenseLastName).toBe('Public');
    expect(draft.licenseDateOfBirth).toBe('1990-01-02');
    expect(draft.licenseNumber).toBe('D1234567');
    expect(draft.licenseIssuingCountry).toBe('USA');
    expect(draft.licenseIssuingState).toBe('CA');
    expect(draft.licenseIssueDate).toBe('2020-01-01');
    expect(draft.licenseExpirationDate).toBe('2028-01-01');
    expect(draft.licenseIssuingAuthority).toBe('DMV');
    expect(draft.licenseClass).toBe('C');
  });

  it('maps a passport cipher into passport draft fields', () => {
    const draft = draftFromCipher(passportCipher());
    expect(draft.type).toBe(8);
    expect(draft.passportSurname).toBe('Public');
    expect(draft.passportGivenName).toBe('John');
    expect(draft.passportDateOfBirth).toBe('1990-01-02');
    expect(draft.passportSex).toBe('M');
    expect(draft.passportBirthPlace).toBe('Springfield');
    expect(draft.passportNationality).toBe('American');
    expect(draft.passportIssuingCountry).toBe('USA');
    expect(draft.passportNumber).toBe('X1234567');
    expect(draft.passportType).toBe('P');
    expect(draft.passportNationalIdentificationNumber).toBe('N999');
    expect(draft.passportIssuingAuthority).toBe('State Dept');
    expect(draft.passportIssueDate).toBe('2019-05-01');
    expect(draft.passportExpirationDate).toBe('2029-05-01');
  });
});
