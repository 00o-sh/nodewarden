import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/preact';

const copyTextToClipboard = vi.fn();
vi.mock('@/lib/clipboard', () => ({
  copyTextToClipboard: (...args: unknown[]) => copyTextToClipboard(...args),
}));

import {
  bankAccountListSubtitle,
  driversLicenseListSubtitle,
  passportListSubtitle,
  cipherTypeKey,
  cipherTypeLabel,
  buildCipherDuplicateSignature,
  buildCipherDuplicateSignatures,
  createEmptyDraft,
  draftFromCipher,
  TypeIcon,
  CreateTypeIcon,
  CardBrandIcon,
  VaultListIcon,
  getFieldTypeOptions,
  getWebsiteMatchOptions,
  getVaultSortOptions,
  getFolderSortOptions,
  getDuplicateDetectionOptions,
  getCreateTypeOptions,
  parseFieldType,
  toBooleanFieldValue,
  websiteMatchLabel,
  normalizeCardBrand,
  displayCardBrand,
  cardLast4,
  cardListSubtitle,
  maskSecret,
  formatTotp,
  formatHistoryTime,
  parseAttachmentSizeBytes,
  formatAttachmentSize,
  sortTimeValue,
  creationTimeValue,
  firstPasskeyCreationTime,
  copyToClipboard,
} from '@/components/vault/vault-page-helpers';
import type { Cipher, CipherAttachment } from '@/lib/types';

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

// ---------------------------------------------------------------------------
// Plaintext-fallback ciphers: exercise the `?? plaintext` / `|| ''` right-hand
// branches in buildCipherDuplicateSignature and draftFromCipher that the
// decrypted-field fixtures above never reach.
// ---------------------------------------------------------------------------

// A cipher carrying EVERY sub-object using only the plaintext (non-`dec`) keys,
// and without top-level type/folderId/favorite/reprompt/decName so the
// signature builder takes its `|| fallback` / `?? name` branches.
function plaintextCipher(): Cipher {
  return {
    id: 'plain',
    name: 'Plain Name',
    notes: 'Plain notes',
    login: {
      username: 'user',
      password: 'pass',
      totp: 'totpseed',
      uris: [{ uri: 'https://example.com', match: 2 }],
      fido2Credentials: [{ creationDate: '2021-01-01T00:00:00Z' }],
    },
    card: {
      cardholderName: 'Card Holder',
      number: '4111111111111111',
      brand: 'visa',
      expMonth: '01',
      expYear: '2030',
      code: '123',
    },
    identity: {
      title: 'Mr',
      firstName: 'First',
      middleName: 'Mid',
      lastName: 'Last',
      username: 'iuser',
      company: 'Acme',
      ssn: '111',
      passportNumber: 'P1',
      licenseNumber: 'L1',
      email: 'e@e.com',
      phone: '555',
      address1: 'a1',
      address2: 'a2',
      address3: 'a3',
      city: 'City',
      state: 'ST',
      postalCode: '00000',
      country: 'US',
    },
    sshKey: {
      privateKey: 'priv',
      publicKey: 'pub',
      fingerprint: 'fp',
    },
    bankAccount: {
      bankName: 'Bank',
      nameOnAccount: 'Name',
      accountType: 'Savings',
      accountNumber: '987654321',
      routingNumber: '111000025',
      branchNumber: '01',
      pin: '0000',
      swiftCode: 'AAAA',
      iban: 'DE00',
      bankContactPhone: '555',
    },
    driversLicense: {
      firstName: 'DFirst',
      middleName: 'DMid',
      lastName: 'DLast',
      dateOfBirth: '1980-01-01',
      licenseNumber: 'DL1',
      issuingCountry: 'US',
      issuingState: 'NY',
      issueDate: '2015-01-01',
      expirationDate: '2025-01-01',
      issuingAuthority: 'DMV',
      licenseClass: 'D',
    },
    passport: {
      surname: 'PSurname',
      givenName: 'PGiven',
      dateOfBirth: '1980-01-01',
      sex: 'F',
      birthPlace: 'Town',
      nationality: 'Nat',
      issuingCountry: 'US',
      passportNumber: 'PP1',
      passportType: 'T',
      nationalIdentificationNumber: 'NID',
      issuingAuthority: 'Auth',
      issueDate: '2016-01-01',
      expirationDate: '2026-01-01',
    },
    secureNote: { type: 0 },
    fields: [{ type: 1, name: 'fname', value: 'fval', linkedId: 5 }],
    passwordHistory: [{ password: 'old', lastUsedDate: '2020-01-01' }],
  } as unknown as Cipher;
}

describe('buildCipherDuplicateSignature plaintext fallbacks', () => {
  it('serializes every sub-object from plaintext keys and applies top-level fallbacks', () => {
    const parsed = JSON.parse(buildCipherDuplicateSignature(plaintextCipher()));
    expect(parsed.type).toBe(1);
    expect(parsed.folderId).toBeNull();
    expect(parsed.favorite).toBe(false);
    expect(parsed.reprompt).toBe(0);
    expect(parsed.name).toBe('Plain Name');
    expect(parsed.notes).toBe('Plain notes');
    expect(parsed.login).toMatchObject({ username: 'user', password: 'pass', totp: 'totpseed' });
    expect(parsed.login.uris).toEqual([{ uri: 'https://example.com', match: 2 }]);
    expect(parsed.login.fido2Credentials).toEqual([{ creationDate: '2021-01-01T00:00:00Z' }]);
    expect(parsed.card).toMatchObject({ cardholderName: 'Card Holder', number: '4111111111111111' });
    expect(parsed.identity).toMatchObject({ firstName: 'First', country: 'US' });
    expect(parsed.sshKey).toMatchObject({ privateKey: 'priv', fingerprint: 'fp' });
    expect(parsed.bankAccount).toMatchObject({ bankName: 'Bank', accountNumber: '987654321' });
    expect(parsed.driversLicense).toMatchObject({ firstName: 'DFirst', licenseClass: 'D' });
    expect(parsed.passport).toMatchObject({ surname: 'PSurname', passportNumber: 'PP1' });
    expect(parsed.secureNoteType).toBe(0);
    expect(parsed.fields).toEqual([{ type: 1, name: 'fname', value: 'fval', linkedId: 5 }]);
    expect(parsed.passwordHistory).toEqual([{ password: 'old', lastUsedDate: '2020-01-01' }]);
  });

  it('uses null defaults when optional sub-fields are missing', () => {
    const parsed = JSON.parse(
      buildCipherDuplicateSignature({
        id: 'z',
        login: { uris: [{ uri: 'u' }], fido2Credentials: [{}] },
        fields: [{}],
        passwordHistory: [{}],
      } as unknown as Cipher)
    );
    expect(parsed.login.uris[0].match).toBeNull();
    expect(parsed.secureNoteType).toBeNull();
    expect(parsed.fields[0]).toEqual({ type: null, name: '', value: '', linkedId: null });
    expect(parsed.passwordHistory[0]).toEqual({ password: '', lastUsedDate: '' });
  });
});

describe('draftFromCipher plaintext-only ciphers stay blank but exercise fallbacks', () => {
  it('leaves draft fields blank when only plaintext (non-dec) sub-fields exist', () => {
    const draft = draftFromCipher(plaintextCipher());
    // draftFromCipher reads only decrypted keys, so plaintext-only ciphers yield blanks.
    expect(draft.loginUsername).toBe('');
    expect(draft.cardholderName).toBe('');
    expect(draft.identFirstName).toBe('');
    expect(draft.sshPrivateKey).toBe('');
    expect(draft.bankName).toBe('');
    expect(draft.licenseFirstName).toBe('');
    expect(draft.passportSurname).toBe('');
    // A login with a (blank) uri still produces a single uri entry.
    expect(draft.loginUris).toHaveLength(1);
  });

  it('seeds a single empty login uri when the login has no uris', () => {
    const draft = draftFromCipher({
      id: 'e',
      type: 1,
      login: { decUsername: 'u', uris: [] },
    } as unknown as Cipher);
    expect(draft.loginUsername).toBe('u');
    expect(draft.loginUris).toHaveLength(1);
    expect(draft.loginUris[0].uri).toBe('');
  });

  it('maps custom fields and reprompt from a decrypted cipher', () => {
    const draft = draftFromCipher({
      id: 'c',
      type: 1,
      favorite: 1,
      reprompt: 1,
      decName: 'N',
      folderId: 'fold',
      decNotes: 'notes',
      fields: [{ type: 1, decName: 'secret', decValue: 'v' }],
    } as unknown as Cipher);
    expect(draft.favorite).toBe(true);
    expect(draft.reprompt).toBe(true);
    expect(draft.folderId).toBe('fold');
    expect(draft.customFields).toEqual([{ type: 1, label: 'secret', value: 'v' }]);
  });
});

describe('buildCipherDuplicateSignatures modes', () => {
  function loginCipher(overrides: Record<string, unknown> = {}): Cipher {
    return {
      id: 'lg',
      type: 1,
      login: {
        decUsername: 'alice',
        decPassword: 'secret',
        uris: [{ decUri: 'https://example.com/login' }],
      },
      ...overrides,
    } as unknown as Cipher;
  }

  it('exact mode returns the full structural signature', () => {
    const sigs = buildCipherDuplicateSignatures(loginCipher(), 'exact');
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toBe(buildCipherDuplicateSignature(loginCipher()));
  });

  it('non-login ciphers yield no signatures for login-based modes', () => {
    expect(buildCipherDuplicateSignatures(bankCipher(), 'login-site')).toEqual([]);
    expect(buildCipherDuplicateSignatures({ id: 'x', type: 1 } as unknown as Cipher, 'password')).toEqual([]);
  });

  it('password mode keys on the password alone', () => {
    expect(buildCipherDuplicateSignatures(loginCipher(), 'password')).toEqual([
      JSON.stringify(['password', 'secret']),
    ]);
    const noPass = loginCipher({ login: { decUsername: 'alice', uris: [] } });
    expect(buildCipherDuplicateSignatures(noPass, 'password')).toEqual([]);
  });

  it('login-credentials requires both username and password', () => {
    expect(buildCipherDuplicateSignatures(loginCipher(), 'login-credentials')).toEqual([
      JSON.stringify(['login-credentials', 'alice', 'secret']),
    ]);
    const noUser = loginCipher({ login: { decPassword: 'secret', uris: [] } });
    expect(buildCipherDuplicateSignatures(noUser, 'login-credentials')).toEqual([]);
  });

  it('login-site emits one signature per normalized site', () => {
    const sigs = buildCipherDuplicateSignatures(loginCipher(), 'login-site');
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toContain('login-site');
    expect(sigs[0]).toContain('alice');
    // A login with no resolvable sites produces nothing.
    const noSite = loginCipher({ login: { decUsername: 'alice', decPassword: 'secret', uris: [{ decUri: '   ' }] } });
    expect(buildCipherDuplicateSignatures(noSite, 'login-site')).toEqual([]);
  });
});

describe('option list helpers', () => {
  it('return the expected option counts', () => {
    expect(getFieldTypeOptions()).toHaveLength(3);
    expect(getWebsiteMatchOptions()).toHaveLength(7);
    expect(getVaultSortOptions().map((o) => o.value)).toEqual(['edited', 'created', 'name']);
    expect(getFolderSortOptions().map((o) => o.value)).toEqual(['edited', 'created', 'name']);
    expect(getDuplicateDetectionOptions().map((o) => o.value)).toEqual([
      'exact',
      'login-site',
      'login-credentials',
      'password',
    ]);
    expect(getCreateTypeOptions().map((o) => o.type)).toEqual([1, 3, 6, 4, 7, 8, 2, 5]);
  });
});

describe('parseFieldType', () => {
  it('passes through numeric hidden/boolean/linked values', () => {
    expect(parseFieldType(1)).toBe(1);
    expect(parseFieldType(2)).toBe(2);
    expect(parseFieldType(3)).toBe(3);
  });

  it('parses string and named variants', () => {
    expect(parseFieldType('1')).toBe(1);
    expect(parseFieldType('hidden')).toBe(1);
    expect(parseFieldType('2')).toBe(2);
    expect(parseFieldType('boolean')).toBe(2);
    expect(parseFieldType('3')).toBe(3);
    expect(parseFieldType('linked')).toBe(3);
  });

  it('defaults to text (0) for anything else', () => {
    expect(parseFieldType(0)).toBe(0);
    expect(parseFieldType('text')).toBe(0);
    expect(parseFieldType(null)).toBe(0);
    expect(parseFieldType(undefined)).toBe(0);
  });
});

describe('toBooleanFieldValue', () => {
  it('treats 1/true/yes/on as true and everything else as false', () => {
    for (const v of ['1', 'true', 'YES', 'On']) expect(toBooleanFieldValue(v)).toBe(true);
    for (const v of ['0', 'false', 'no', '', 'anything']) expect(toBooleanFieldValue(v)).toBe(false);
  });
});

describe('websiteMatchLabel', () => {
  it('maps a finite match value to its label', () => {
    expect(websiteMatchLabel(1)).toBe(getWebsiteMatchOptions().find((o) => o.value === 1)?.label);
    expect(websiteMatchLabel(3)).toBe(getWebsiteMatchOptions().find((o) => o.value === 3)?.label);
  });

  it('falls back to the default label for null / non-finite values', () => {
    const def = getWebsiteMatchOptions().find((o) => o.value === null)?.label;
    expect(websiteMatchLabel(null)).toBe(def);
    expect(websiteMatchLabel(undefined)).toBe(def);
    expect(websiteMatchLabel(Number.NaN)).toBe(def);
    expect(websiteMatchLabel(99)).toBe(def);
  });
});

describe('card brand + last-4 helpers', () => {
  it('normalizes aliases and passes unknown brands through', () => {
    expect(normalizeCardBrand('amex')).toBe('American Express');
    expect(normalizeCardBrand('  Visa ')).toBe('Visa');
    expect(normalizeCardBrand('union pay')).toBe('UnionPay');
    expect(normalizeCardBrand('Weird Brand')).toBe('Weird Brand');
    expect(normalizeCardBrand('')).toBe('');
    expect(normalizeCardBrand(null)).toBe('');
    expect(displayCardBrand('mastercard')).toBe('Mastercard');
  });

  it('extracts the last four digits when available', () => {
    expect(cardLast4('4111 1111 1111 1234')).toBe('1234');
    expect(cardLast4('12')).toBe('');
    expect(cardLast4(null)).toBe('');
  });

  it('composes the card list subtitle from brand and last-4', () => {
    expect(cardListSubtitle({ card: { decBrand: 'visa', decNumber: '4111111111111234' } } as unknown as Cipher)).toBe('Visa, *1234');
    expect(cardListSubtitle({ card: { decBrand: 'visa' } } as unknown as Cipher)).toBe('Visa');
    expect(cardListSubtitle({ card: { decNumber: '4111111111111234' } } as unknown as Cipher)).toBe('*1234');
    expect(cardListSubtitle({ card: {} } as unknown as Cipher)).toBe('Card');
  });
});

describe('maskSecret / formatTotp', () => {
  it('masks with a clamped star count', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret('ab')).toBe('*'.repeat(8));
    expect(maskSecret('abcdefghij')).toBe('*'.repeat(10));
    expect(maskSecret('x'.repeat(50))).toBe('*'.repeat(24));
  });

  it('groups totp codes by length', () => {
    expect(formatTotp('')).toBe('');
    expect(formatTotp('123')).toBe('123');
    expect(formatTotp('12345')).toBe('12 345');
    expect(formatTotp('123456')).toBe('123 456');
    expect(formatTotp('12345678')).toBe('1234 5678');
  });
});

describe('formatHistoryTime', () => {
  it('returns the dash for empty input', () => {
    expect(formatHistoryTime('')).toBe('-');
    expect(formatHistoryTime(null)).toBe('-');
  });

  it('returns the raw string for unparseable dates and a formatted string otherwise', () => {
    expect(formatHistoryTime('not-a-date')).toBe('not-a-date');
    const formatted = formatHistoryTime('2020-06-15T12:00:00Z');
    expect(typeof formatted).toBe('string');
    expect(formatted).not.toBe('2020-06-15T12:00:00Z');
  });
});

describe('attachment size helpers', () => {
  it('parses numeric, string, and invalid sizes', () => {
    expect(parseAttachmentSizeBytes({ size: 2048 } as unknown as CipherAttachment)).toBe(2048);
    expect(parseAttachmentSizeBytes({ size: '4096' } as unknown as CipherAttachment)).toBe(4096);
    expect(parseAttachmentSizeBytes({ size: -1 } as unknown as CipherAttachment)).toBe(0);
    expect(parseAttachmentSizeBytes({ size: 'nope' } as unknown as CipherAttachment)).toBe(0);
  });

  it('formats sizes across units and prefers sizeName', () => {
    expect(formatAttachmentSize({ sizeName: '10 KB' } as unknown as CipherAttachment)).toBe('10 KB');
    expect(formatAttachmentSize({ size: 0 } as unknown as CipherAttachment)).toBe('0 B');
    expect(formatAttachmentSize({ size: 512 } as unknown as CipherAttachment)).toBe('512 B');
    expect(formatAttachmentSize({ size: 2048 } as unknown as CipherAttachment)).toBe('2.00 KB');
    expect(formatAttachmentSize({ size: 5 * 1024 * 1024 } as unknown as CipherAttachment)).toBe('5.00 MB');
    expect(formatAttachmentSize({ size: 3 * 1024 * 1024 * 1024 } as unknown as CipherAttachment)).toBe('3.00 GB');
  });
});

describe('sort/creation time + passkey helpers', () => {
  it('sortTimeValue prefers revisionDate then creationDate then 0', () => {
    expect(sortTimeValue({ revisionDate: '2020-01-01T00:00:00Z' } as unknown as Cipher)).toBeGreaterThan(0);
    expect(sortTimeValue({ creationDate: '2019-01-01T00:00:00Z' } as unknown as Cipher)).toBeGreaterThan(0);
    expect(sortTimeValue({} as unknown as Cipher)).toBe(0);
  });

  it('creationTimeValue returns 0 for invalid dates', () => {
    expect(creationTimeValue({ creationDate: '2019-01-01T00:00:00Z' } as unknown as Cipher)).toBeGreaterThan(0);
    expect(creationTimeValue({ creationDate: 'bad' } as unknown as Cipher)).toBe(0);
    expect(creationTimeValue({} as unknown as Cipher)).toBe(0);
  });

  it('firstPasskeyCreationTime finds the first non-blank creation date', () => {
    expect(firstPasskeyCreationTime(null)).toBeNull();
    expect(firstPasskeyCreationTime({ login: {} } as unknown as Cipher)).toBeNull();
    expect(firstPasskeyCreationTime({ login: { fido2Credentials: [] } } as unknown as Cipher)).toBeNull();
    expect(
      firstPasskeyCreationTime({
        login: { fido2Credentials: [{ creationDate: '' }, { creationDate: '2021-05-05T00:00:00Z' }] },
      } as unknown as Cipher)
    ).toBe('2021-05-05T00:00:00Z');
  });
});

describe('icon components', () => {
  it('CreateTypeIcon renders a distinct glyph for each known type and a default', () => {
    const classes = new Set<string>();
    for (const type of [1, 2, 3, 4, 5, 6, 7, 8, 99]) {
      const svg = render(<CreateTypeIcon type={type} />).container.querySelector('svg');
      expect(svg).not.toBeNull();
      classes.add(svg?.getAttribute('class') || String(type));
    }
    expect(classes.size).toBeGreaterThan(1);
  });

  it('TypeIcon renders a default glyph for unknown types', () => {
    const svg = render(<TypeIcon type={99} />).container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('CardBrandIcon renders a logo image for known brands and a fallback glyph otherwise', () => {
    const known = render(<CardBrandIcon brand="visa" />).container;
    expect(known.querySelector('img')).not.toBeNull();
    const unknown = render(<CardBrandIcon brand="Weird" />).container;
    expect(unknown.querySelector('img')).toBeNull();
    expect(unknown.querySelector('svg')).not.toBeNull();
  });

  it('VaultListIcon renders the card brand icon for card ciphers', () => {
    const card = render(<VaultListIcon cipher={{ type: 3, card: { decBrand: 'visa' } } as unknown as Cipher} />).container;
    expect(card.querySelector('.card-brand-icon')).not.toBeNull();
  });
});

describe('copyToClipboard', () => {
  it('ignores blank values and forwards non-blank values', () => {
    copyTextToClipboard.mockClear();
    copyToClipboard('   ');
    expect(copyTextToClipboard).not.toHaveBeenCalled();
    copyToClipboard('secret');
    expect(copyTextToClipboard).toHaveBeenCalledWith('secret');
  });
});
