import { describe, expect, it } from 'vitest';
import {
  parseOnePasswordCsv,
  parseOnePassword1Pif,
  parseOnePassword1PuxJson,
} from '@/lib/import-formats-onepassword';

// ---------------------------------------------------------------------------
// parseOnePasswordCsv
// ---------------------------------------------------------------------------
describe('parseOnePasswordCsv', () => {
  it('parses a Mac-style login row with username/password/url/totp', () => {
    const csv = [
      'title,username,password,url,one-time password,notesPlain,type',
      'GitHub,octocat,hunter2,https://github.com,otpauth://totp/x,my note,login',
    ].join('\n');
    const { ciphers } = parseOnePasswordCsv(csv, true);
    expect(ciphers).toHaveLength(1);
    const c = ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.name).toBe('GitHub');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.uris).toEqual([{ uri: 'https://github.com', match: null }]);
    expect(c.login.totp).toBe('otpauth://totp/x');
    expect(c.notes).toBe('my note');
  });

  it('skips rows with no title', () => {
    const csv = ['title,username', ',nobody'].join('\n');
    const { ciphers } = parseOnePasswordCsv(csv, true);
    expect(ciphers).toHaveLength(0);
  });

  it('returns empty payload for blank input', () => {
    const { ciphers, folders, folderRelationships } = parseOnePasswordCsv('', true);
    expect(ciphers).toEqual([]);
    expect(folders).toEqual([]);
    expect(folderRelationships).toEqual([]);
  });

  it('parses a Mac-style credit card row', () => {
    const csv = [
      'title,type,number,verification number,cardholder name,expiry date',
      'My Visa,credit card,4111111111111111,123,Jane Doe,12/2027',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, true).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.login).toBeNull();
    expect(c.card.number).toBe('4111111111111111');
    expect(c.card.brand).toBe('Visa');
    expect(c.card.code).toBe('123');
    expect(c.card.cardholderName).toBe('Jane Doe');
    expect(c.card.expMonth).toBe('12');
    expect(c.card.expYear).toBe('2027');
  });

  it('parses a Mac-style identity row', () => {
    const csv = [
      'title,type,first name,initial,last name,username,email,default phone,company',
      'Me,identity,Jane,Q,Doe,jdoe,jane@example.com,555-1234,Acme',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, true).ciphers[0] as any;
    expect(c.type).toBe(4);
    expect(c.login).toBeNull();
    expect(c.identity.firstName).toBe('Jane');
    expect(c.identity.middleName).toBe('Q');
    expect(c.identity.lastName).toBe('Doe');
    expect(c.identity.username).toBe('jdoe');
    expect(c.identity.email).toBe('jane@example.com');
    expect(c.identity.phone).toBe('555-1234');
    expect(c.identity.company).toBe('Acme');
  });

  it('parses a Mac-style secure note row', () => {
    const csv = [
      'title,type,notesPlain',
      'Wifi,secure note,SSID home',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, true).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.notes).toBe('SSID home');
  });

  it('infers a credit card type on non-Mac exports via number + expiry date headers', () => {
    const csv = [
      'title,number,expiry date,verification number,cardholder name',
      'Card,5500000000000004,202705,999,John',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, false).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.card.brand).toBe('Mastercard');
    expect(c.card.expMonth).toBe('5');
    expect(c.card.expYear).toBe('2027');
  });

  it('infers an identity type on non-Mac exports via name/email headers', () => {
    const csv = [
      'title,first name,last name,email',
      'Ident,Ada,Lovelace,ada@example.com',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, false).ciphers[0] as any;
    expect(c.type).toBe(4);
    expect(c.identity.firstName).toBe('Ada');
    expect(c.identity.lastName).toBe('Lovelace');
    expect(c.identity.email).toBe('ada@example.com');
  });

  it('puts unrecognised columns into custom fields, marking secrets hidden', () => {
    const csv = [
      'title,username,password,custom note,api key',
      'Site,bob,pw,plain value,sk_secret',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, true).ciphers[0] as any;
    const byName = (n: string) => c.fields.find((f: any) => f.name === n);
    expect(byName('custom note')).toMatchObject({ type: 0, value: 'plain value' });
    expect(byName('api key')).toMatchObject({ type: 1, value: 'sk_secret' });
  });

  it('converts created/modified date columns to readable ISO custom fields', () => {
    const csv = [
      'title,username,created date',
      'Site,bob,1700000000',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, true).ciphers[0] as any;
    const field = c.fields.find((f: any) => f.name === '1Password created date');
    expect(field).toBeDefined();
    expect(field.value).toContain('2023');
  });

  it('falls back to the email column as username for a login when none set', () => {
    const csv = [
      'title,email',
      'Site,user@example.com',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, true).ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.login.username).toBe('user@example.com');
  });

  it('converts a login with no login data into a secure note', () => {
    const csv = [
      'title,notesPlain',
      'Just A Note,hello there',
    ].join('\n');
    const c = parseOnePasswordCsv(csv, true).ciphers[0] as any;
    // notesPlain is in the ignored set, so no login fields populate -> note
    expect(c.type).toBe(2);
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.notes).toBe('hello there');
  });
});

// ---------------------------------------------------------------------------
// parseOnePassword1Pif
// ---------------------------------------------------------------------------
describe('parseOnePassword1Pif', () => {
  it('parses a login item with url, username/password fields and totp', () => {
    const item = {
      title: 'Example',
      location: 'https://example.com',
      typeName: 'webforms.WebForm',
      openContents: { faveIndex: 1 },
      secureContents: {
        password: 'topsecret',
        notesPlain: 'hello note',
        fields: [
          { designation: 'username', name: 'login', value: 'alice' },
          { designation: 'password', name: 'pass', value: 'overridden?' },
        ],
        sections: [
          {
            fields: [
              { n: 'otp', t: 'one-time password', v: 'otpauth://totp/abc' },
            ],
          },
        ],
      },
    };
    const text = JSON.stringify(item);
    const c = parseOnePassword1Pif(text).ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.name).toBe('Example');
    expect(c.favorite).toBe(true);
    expect(c.login.username).toBe('alice');
    expect(c.login.password).toBe('topsecret'); // from details.password
    expect(c.login.uris).toEqual([{ uri: 'https://example.com', match: null }]);
    expect(c.login.totp).toBe('otpauth://totp/abc');
    expect(c.notes).toBe('hello note');
  });

  it('skips blank lines, non-brace lines, malformed JSON, and trashed items', () => {
    const good = JSON.stringify({ title: 'Keep', secureContents: { password: 'p' } });
    const trashed = JSON.stringify({ title: 'Gone', trashed: true });
    const text = ['', '   ', 'not json', '{ broken', trashed, good].join('\n');
    const { ciphers } = parseOnePassword1Pif(text);
    expect(ciphers).toHaveLength(1);
    expect((ciphers[0] as any).name).toBe('Keep');
  });

  it('detects a credit card item via ccnum and parses card fields', () => {
    const item = {
      title: 'Card',
      typeName: 'wallet.financial.CreditCard',
      secureContents: {
        ccnum: '4111111111111111',
        cvv: '321',
        cardholder: 'Jane Doe',
        expiry: '202612',
        fields: [
          { designation: 'ccnum', name: 'number', value: '4111111111111111' },
          { designation: 'cvv', name: 'cvv', value: '321' },
          { designation: 'cardholder', name: 'cardholder', value: 'Jane Doe' },
          { designation: 'expiry', name: 'expiry', value: '202612' },
          { designation: 'type', name: 'type', value: 'visa' },
        ],
      },
    };
    const c = parseOnePassword1Pif(JSON.stringify(item)).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.card.number).toBe('4111111111111111');
    expect(c.card.brand).toBe('Visa');
    expect(c.card.code).toBe('321');
    expect(c.card.cardholderName).toBe('Jane Doe');
    expect(c.card.expMonth).toBe('12');
    expect(c.card.expYear).toBe('2026');
  });

  it('detects an identity item via firstname and parses an address section', () => {
    const item = {
      title: 'Identity',
      typeName: 'identities.Identity',
      secureContents: {
        firstname: 'Ada',
        sections: [
          {
            fields: [
              { n: 'firstname', t: 'first name', v: 'Ada' },
              { n: 'lastname', t: 'last name', v: 'Lovelace' },
              { n: 'initial', t: 'initial', v: 'B' },
              { n: 'defphone', t: 'default phone', v: '555-9999' },
              { n: 'company', t: 'company', v: 'Analytical' },
              { n: 'email', t: 'email', v: 'ada@example.com' },
              { n: 'username', t: 'username', v: 'ada' },
              {
                n: 'address',
                t: 'address',
                v: { street: '1 Main St', city: 'London', country: 'gb', zip: 'AB1', state: 'LDN' },
              },
            ],
          },
        ],
      },
    };
    const c = parseOnePassword1Pif(JSON.stringify(item)).ciphers[0] as any;
    expect(c.type).toBe(4);
    expect(c.identity.firstName).toBe('Ada');
    expect(c.identity.lastName).toBe('Lovelace');
    expect(c.identity.middleName).toBe('B');
    expect(c.identity.phone).toBe('555-9999');
    expect(c.identity.company).toBe('Analytical');
    expect(c.identity.email).toBe('ada@example.com');
    expect(c.identity.username).toBe('ada');
    expect(c.identity.address1).toBe('1 Main St');
    expect(c.identity.city).toBe('London');
    expect(c.identity.country).toBe('GB');
    expect(c.identity.postalCode).toBe('AB1');
    expect(c.identity.state).toBe('LDN');
  });

  it('detects a secure note item via typeName hint', () => {
    const item = {
      title: 'Note',
      typeName: 'securenotes.SecureNote',
      secureContents: { notesPlain: 'a secret note' },
    };
    const c = parseOnePassword1Pif(JSON.stringify(item)).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.notes).toBe('a secret note');
  });

  it('collects URLs from the URLs array and converts a login with no data to a note', () => {
    const withUrls = {
      title: 'Multi',
      typeName: 'webforms.WebForm',
      secureContents: {
        password: 'pw',
        URLs: [{ url: 'example.org' }, { u: 'https://second.test' }],
      },
    };
    const c = parseOnePassword1Pif(JSON.stringify(withUrls)).ciphers[0] as any;
    expect(c.login.uris).toEqual([
      { uri: 'http://example.org', match: null },
      { uri: 'https://second.test', match: null },
    ]);

    const empty = { title: 'Empty', typeName: 'webforms.WebForm', secureContents: {} };
    const note = parseOnePassword1Pif(JSON.stringify(empty)).ciphers[0] as any;
    expect(note.type).toBe(2);
  });

  it('builds password history sorted by time, capped at 5, ignoring incomplete entries', () => {
    const item = {
      title: 'History',
      typeName: 'webforms.WebForm',
      secureContents: {
        password: 'current',
        passwordHistory: [
          { value: 'old1', time: 1000 },
          { value: 'old2', time: 2000 },
          { value: 'noTime' },
          { time: 3000 },
        ],
      },
    };
    const c = parseOnePassword1Pif(JSON.stringify(item)).ciphers[0] as any;
    expect(c.passwordHistory).toHaveLength(2);
    // newest first
    expect(c.passwordHistory[0].password).toBe('old2');
    expect(c.passwordHistory[1].password).toBe('old1');
  });

  it('sets login password from a field designation when details.password is absent', () => {
    const item = {
      title: 'FieldPass',
      typeName: 'webforms.WebForm',
      secureContents: {
        fields: [
          { designation: 'username', name: 'login', value: 'u' },
          { designation: 'password', name: 'pass', value: 'fieldpw' },
        ],
      },
    };
    const c = parseOnePassword1Pif(JSON.stringify(item)).ciphers[0] as any;
    expect(c.login.password).toBe('fieldpw');
  });

  it('uses overview.title fallback and date field formatting', () => {
    const item = {
      overview: { title: 'OverviewName' },
      typeName: 'webforms.WebForm',
      secureContents: {
        password: 'pw',
        fields: [{ designation: '', name: 'created', value: 1700000000, k: 'date' }],
      },
    };
    const c = parseOnePassword1Pif(JSON.stringify(item)).ciphers[0] as any;
    expect(c.name).toBe('OverviewName');
    const f = c.fields.find((x: any) => x.name === 'created');
    expect(f.value).toContain('2023');
  });
});

// ---------------------------------------------------------------------------
// parseOnePassword1PuxJson
// ---------------------------------------------------------------------------
function pux(items: any[], vaultName = 'Personal'): string {
  return JSON.stringify({
    accounts: [{ vaults: [{ attrs: { name: vaultName }, items }] }],
  });
}

describe('parseOnePassword1PuxJson', () => {
  it('returns empty payload when accounts missing', () => {
    const { ciphers } = parseOnePassword1PuxJson('{}');
    expect(ciphers).toEqual([]);
  });

  it('parses a login item with urls, loginFields and a folder from vault name', () => {
    const item = {
      categoryUuid: '001',
      favIndex: 1,
      overview: { title: 'Login One', urls: [{ url: 'example.com' }] },
      details: {
        notesPlain: 'note here',
        loginFields: [
          { designation: 'username', name: 'username', value: 'carol', fieldType: 'T' },
          { designation: 'password', name: 'password', value: 'pw123', fieldType: 'P' },
          { designation: '', name: 'extra', value: 'extraval', fieldType: 'T' },
        ],
      },
    };
    const payload = parseOnePassword1PuxJson(pux([item], 'MyVault'));
    const c = payload.ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.favorite).toBe(true);
    expect(c.name).toBe('Login One');
    expect(c.notes).toBe('note here');
    expect(c.login.username).toBe('carol');
    expect(c.login.password).toBe('pw123');
    expect(c.login.uris).toEqual([{ uri: 'http://example.com', match: null }]);
    expect(c.fields.find((f: any) => f.name === 'extra')).toMatchObject({ value: 'extraval' });
    expect(payload.folders.map((f) => f.name)).toEqual(['MyVault']);
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('reads totp from a loginField via field name', () => {
    const item = {
      categoryUuid: '001',
      overview: { title: 'TotpLogin', urls: [{ url: 'https://t.test' }] },
      details: {
        loginFields: [
          { designation: 'username', name: 'username', value: 'u' },
          { designation: '', name: 'One-Time Password', value: 'otpauth://totp/lf', fieldType: 'T' },
        ],
      },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.login.totp).toBe('otpauth://totp/lf');
  });

  it('prefers a tag folder over the vault name', () => {
    const item = {
      categoryUuid: '001',
      overview: { title: 'Tagged', tags: ['Work'], urls: [{ url: 'https://x.test' }] },
      details: { loginFields: [{ designation: 'username', value: 'u' }] },
    };
    const payload = parseOnePassword1PuxJson(pux([item], 'Vault'));
    expect(payload.folders.map((f) => f.name)).toEqual(['Work']);
  });

  it('falls back to overview.url when urls array empty', () => {
    const item = {
      categoryUuid: '001',
      overview: { title: 'Fallback', url: 'fallback.com' },
      details: { loginFields: [{ designation: 'username', value: 'u' }] },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.login.uris).toEqual([{ uri: 'http://fallback.com', match: null }]);
  });

  it('skips archived items', () => {
    const item = { categoryUuid: '001', state: 'archived', overview: { title: 'Gone' } };
    const { ciphers } = parseOnePassword1PuxJson(pux([item]));
    expect(ciphers).toHaveLength(0);
  });

  it('parses a password category (005) item using details.password', () => {
    const item = {
      categoryUuid: '005',
      overview: { title: 'Pwd' },
      details: { password: 'rawpass' },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.login.password).toBe('rawpass');
  });

  it('parses a credit card item (002) via section fields by id and field type', () => {
    const item = {
      categoryUuid: '002',
      overview: { title: 'Card' },
      details: {
        sections: [
          {
            title: 'Card',
            fields: [
              { id: 'creditCardNumber', title: 'number', value: { string: '4111111111111111' } },
              { id: 'creditCardVerificationNumber', title: 'cvv', value: { concealed: '456' } },
              { id: 'creditCardCardholder', title: 'cardholder', value: { string: 'John Q' } },
              { id: 'creditCardExpiry', title: 'expiry', value: { monthYear: '202612' } },
            ],
          },
        ],
      },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.card.number).toBe('4111111111111111');
    expect(c.card.brand).toBe('Visa');
    expect(c.card.code).toBe('456');
    expect(c.card.cardholderName).toBe('John Q');
    expect(c.card.expMonth).toBe('12');
    expect(c.card.expYear).toBe('2026');
  });

  it('parses an identity item (004) including address, ssn, passport, license', () => {
    const item = {
      categoryUuid: '004',
      overview: { title: 'Ident' },
      details: {
        sections: [
          {
            fields: [
              { id: 'firstName', value: { string: 'Ada' } },
              { id: 'lastName', value: { string: 'Lovelace' } },
              { id: 'initial', value: { string: 'B' } },
              { id: 'company', value: { string: 'Analytical' } },
              { id: 'email', value: { string: 'ada@x.com' } },
              { id: 'phone', value: { string: '555' } },
              { id: 'username', value: { string: 'ada' } },
              {
                id: 'address',
                value: { address: { street: '1 St', city: 'London', state: 'L', zip: 'AB1', country: 'gb' } },
              },
              { id: 'socialSecurityNumber', value: { string: '123-45' } },
              { id: 'passportNumber', value: { string: 'P123' } },
              { id: 'licenseNumber', value: { string: 'L456' } },
            ],
          },
        ],
      },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.type).toBe(4);
    expect(c.identity.firstName).toBe('Ada');
    expect(c.identity.lastName).toBe('Lovelace');
    expect(c.identity.middleName).toBe('B');
    expect(c.identity.company).toBe('Analytical');
    expect(c.identity.email).toBe('ada@x.com');
    expect(c.identity.phone).toBe('555');
    expect(c.identity.username).toBe('ada');
    expect(c.identity.address1).toBe('1 St');
    expect(c.identity.city).toBe('London');
    expect(c.identity.state).toBe('L');
    expect(c.identity.postalCode).toBe('AB1');
    expect(c.identity.country).toBe('GB');
    expect(c.identity.ssn).toBe('123-45');
    expect(c.identity.passportNumber).toBe('P123');
    expect(c.identity.licenseNumber).toBe('L456');
  });

  it('parses a secure note item (003)', () => {
    const item = {
      categoryUuid: '003',
      overview: { title: 'Note' },
      details: { notesPlain: 'secret stuff' },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.notes).toBe('secret stuff');
  });

  it('parses an ssh key item (114) from a sshKey section field', () => {
    const item = {
      categoryUuid: '114',
      overview: { title: 'SSH' },
      details: {
        sections: [
          {
            fields: [
              {
                id: 'privateKey',
                value: {
                  sshKey: {
                    privateKey: 'PRIV',
                    metadata: { publicKey: 'PUB', fingerprint: 'FP' },
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.type).toBe(5);
    expect(c.sshKey.publicKey).toBe('PUB');
    expect(c.sshKey.keyFingerprint).toBe('FP');
    expect(c.sshKey.fingerprint).toBe('FP');
  });

  it('handles login section fields: url, username/password by title, and totp', () => {
    const item = {
      categoryUuid: '001',
      overview: { title: 'Sectioned' },
      details: {
        sections: [
          {
            fields: [
              { id: 'url', value: { url: 'https://sec.test' } },
              { id: 'someUser', title: 'username', value: { string: 'sammy' } },
              { id: 'somePass', title: 'password', value: { concealed: 'sammypw' } },
              { id: 'oneTimePassword', value: { totp: 'otpauth://totp/sec' } },
            ],
          },
        ],
      },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.login.username).toBe('sammy');
    expect(c.login.password).toBe('sammypw');
    expect(c.login.totp).toBe('otpauth://totp/sec');
    expect(c.login.uris).toEqual([{ uri: 'https://sec.test', match: null }]);
  });

  it('handles API credential category (112): credential as password, hostname as uri', () => {
    const item = {
      categoryUuid: '112',
      overview: { title: 'API Cred' },
      details: {
        sections: [
          {
            fields: [
              { id: 'credential', title: 'credential', value: { concealed: 'tok_abc' } },
              { id: 'hostname', title: 'hostname', value: { string: 'api.example.com' } },
            ],
          },
        ],
      },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.login.password).toBe('tok_abc');
    expect(c.login.uris).toEqual([{ uri: 'http://api.example.com', match: null }]);
  });

  it('routes unmatched section fields into custom fields (hidden for concealed)', () => {
    const item = {
      categoryUuid: '001',
      overview: { title: 'Custom' },
      details: {
        loginFields: [{ designation: 'username', value: 'u' }],
        sections: [
          {
            title: 'Extra',
            fields: [
              { id: 'note1', title: 'Visible', value: { string: 'shown' } },
              { id: 'note2', title: 'Hidden', value: { concealed: 'hush' } },
            ],
          },
        ],
      },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    const visible = c.fields.find((f: any) => f.name === 'Visible');
    const hidden = c.fields.find((f: any) => f.name === 'Hidden');
    expect(visible).toMatchObject({ type: 0, value: 'shown' });
    expect(hidden).toMatchObject({ type: 1, value: 'hush' });
  });

  it('formats date and email section field values', () => {
    const item = {
      categoryUuid: '003', // secure note so date/email land as custom fields/notes
      overview: { title: 'Dated' },
      details: {
        sections: [
          {
            fields: [
              { id: 'd', title: 'When', value: { date: 1700000000 } },
              { id: 'e', title: 'Contact', value: { email: { email_address: 'x@y.com' } } },
            ],
          },
        ],
      },
    };
    const c = parseOnePassword1PuxJson(pux([item])).ciphers[0] as any;
    const when = c.fields.find((f: any) => f.name === 'When');
    const contact = c.fields.find((f: any) => f.name === 'Contact');
    expect(when.value).toContain('2023');
    expect(contact.value).toBe('x@y.com');
  });
});
