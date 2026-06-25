import { describe, expect, it } from 'vitest';
import {
  parseMSecureCsv,
  parseMykiCsv,
  parseNetwrixCsv,
  parseNordpassCsv,
  parsePasskyJson,
  parsePassmanJson,
  parsePasswordBossJson,
  parsePsonoJson,
  parseRoboFormCsv,
  parseZohoVaultCsv,
} from '@/lib/import-formats-advanced';

 
const c = (p: { ciphers: unknown[] }, i = 0) => p.ciphers[i] as any;

describe('parseMSecureCsv', () => {
  it('parses a Web Logins row with piped fields, uri and notes', () => {
    // columns: name|..., type, folder, notes, url, username, password
    const row =
      'GitHub|x,Web Logins,Work,line1\\nline2,URL|0|github.com,Username|0|octocat,Password|0|hunter2';
    const p = parseMSecureCsv(row);
    expect(p.ciphers).toHaveLength(1);
    const cipher = c(p);
    expect(cipher.type).toBe(1);
    expect(cipher.name).toBe('GitHub');
    expect(cipher.login.username).toBe('octocat');
    expect(cipher.login.password).toBe('hunter2');
    expect(cipher.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(cipher.notes).toBe('line1\nline2');
    // folder "Work" filed
    expect(p.folders.map((f) => f.name)).toEqual(['Work']);
    expect(p.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('treats "Login" type like Web Logins and ignores Unassigned folder', () => {
    const row = 'Site,Login,Unassigned,,example.com,alice,pw';
    const cipher = c(parseMSecureCsv(row));
    expect(cipher.type).toBe(1);
    expect(cipher.login.username).toBe('alice');
    expect(cipher.login.uris).toEqual([{ uri: 'http://example.com', match: null }]);
    expect(parseMSecureCsv(row).folders).toHaveLength(0);
  });

  it('parses a Credit Card row with holder, code, exp and indexed notes', () => {
    // indices: 0 name,1 type,2 folder,3 ?,4 number,5 exp,6 code,7 holder,8 note...
    const row = [
      'My Card', // 0
      'Credit Card', // 1
      'Cards', // 2
      'Card Number', // 3 (label-ish, no pipe -> rawNotes candidate, has no |d| so kept)
      'Card Number|0|4111111111111111', // 4 number
      'Expiration Date|0|08/27', // 5 exp
      'Security Code|0|123', // 6 (matched by regex loop)
      'Name on Card|0|Jane Doe', // 7 (matched by regex loop)
      'PIN|0|9999', // 8 indexed note
    ].join(',');
    const cipher = c(parseMSecureCsv(row));
    expect(cipher.type).toBe(3);
    expect(cipher.login).toBeNull();
    expect(cipher.card.number).toBe('4111111111111111');
    expect(cipher.card.brand).toBe('Visa');
    expect(cipher.card.expMonth).toBe('08');
    expect(cipher.card.expYear).toBe('2027');
    expect(cipher.card.code).toBe('123');
    expect(cipher.card.cardholderName).toBe('Jane Doe');
    // indexed note from index 8 (PIN) included; name not prefixed for cards
    expect(cipher.name).toBe('My Card');
    expect(cipher.notes).toContain('PIN: 9999');
    // rawNotes: entries from index>=2 without |d| regex and non-empty: "Cards", "Card Number"
    expect(cipher.notes).toContain('Card Number');
  });

  it('credit card with 4-digit year and no matches yields null fields', () => {
    const row = ['C', 'Credit Card', '', '', 'Card Number|0|notacard', 'Expiration Date|0|3/2030'].join(',');
    const cipher = c(parseMSecureCsv(row));
    expect(cipher.card.expMonth).toBe('3');
    expect(cipher.card.expYear).toBe('2030');
    expect(cipher.card.code).toBeNull();
    expect(cipher.card.cardholderName).toBeNull();
    expect(cipher.card.brand).toBeNull();
  });

  it('treats unknown type with extra columns as a secure note with prefixed name', () => {
    const row = 'Secret,Note,,detail one,detail two';
    const cipher = c(parseMSecureCsv(row));
    expect(cipher.type).toBe(2);
    expect(cipher.login).toBeNull();
    expect(cipher.secureNote).toEqual({ type: 0 });
    expect(cipher.notes).toBe('detail one\ndetail two');
    // name prefixed with type for non-login/non-card
    expect(cipher.name).toBe('Note: Secret');
  });

  it('skips rows with fewer than 3 columns', () => {
    expect(parseMSecureCsv('a,b').ciphers).toHaveLength(0);
  });

  it('uses -- fallback name when name column blank', () => {
    const cipher = c(parseMSecureCsv(',Web Logins,,,,u,p'));
    expect(cipher.name).toBe('--');
  });

  it('handles login rows missing optional columns (no uri/user/pass)', () => {
    // exactly 3 columns: name, type, folder. row[4..6] undefined -> '|| ""' fallbacks
    const cipher = c(parseMSecureCsv('Bare,Web Logins,'));
    expect(cipher.type).toBe(1);
    expect(cipher.login.username).toBeNull();
    expect(cipher.login.password).toBeNull();
    expect(cipher.login.uris).toBeNull();
    expect(cipher.notes).toBeNull();
  });

  it('typed row with exactly 3 columns stays a login and is not prefixed', () => {
    // row.length === 3 so the "else if (row.length > 3)" note branch is skipped;
    // cipher stays type 1 (login) so the name-prefix guard (type !== 1 && !== 3)
    // is NOT triggered and the name is left as-is.
    const cipher = c(parseMSecureCsv('Thing,Memo,'));
    expect(cipher.type).toBe(1);
    expect(cipher.name).toBe('Thing');
  });

  it('note-type row with only blank extra columns yields null notes', () => {
    const cipher = c(parseMSecureCsv('Thing,Memo,, , '));
    expect(cipher.type).toBe(2);
    expect(cipher.notes).toBeNull();
  });
});

describe('parseMykiCsv', () => {
  it('parses url login rows with totp and unmapped custom fields', () => {
    const csv = [
      'nickname,additionalInfo,url,username,password,twofaSecret,extra',
      'My Login,some note  ,example.com,alice,pw,SECRET,customval',
    ].join('\n');
    const cipher = c(parseMykiCsv(csv));
    expect(cipher.type).toBe(1);
    expect(cipher.name).toBe('My Login');
    expect(cipher.notes).toBe('some note');
    expect(cipher.login.username).toBe('alice');
    expect(cipher.login.password).toBe('pw');
    expect(cipher.login.totp).toBe('SECRET');
    expect(cipher.login.uris).toEqual([{ uri: 'http://example.com', match: null }]);
    expect(cipher.fields).toEqual([{ type: 0, name: 'extra', value: 'customval', linkedId: null }]);
  });

  it('parses authToken-only rows as totp login', () => {
    const csv = 'nickname,authToken\nAuthGen,TOKEN123';
    const cipher = c(parseMykiCsv(csv));
    expect(cipher.type).toBe(1);
    expect(cipher.login.totp).toBe('TOKEN123');
  });

  it('parses card rows', () => {
    const csv = [
      'nickname,cardNumber,cardName,exp_month,exp_year,cvv',
      'Visa,4111111111111111,John,08,27,321',
    ].join('\n');
    const cipher = c(parseMykiCsv(csv));
    expect(cipher.type).toBe(3);
    expect(cipher.login).toBeNull();
    expect(cipher.card.number).toBe('4111111111111111');
    expect(cipher.card.cardholderName).toBe('John');
    expect(cipher.card.expMonth).toBe('08');
    expect(cipher.card.expYear).toBe('27');
    expect(cipher.card.code).toBe('321');
    expect(cipher.card.brand).toBe('Visa');
  });

  it('parses identity (firstName) rows including phone from number column', () => {
    const csv = [
      'nickname,firstName,middleName,lastName,title,email,number,firstAddressLine,secondAddressLine,city,country,zipCode',
      'Me,John,Q,Public,Mr,j@x.com,555-1234,1 St,Apt 2,Town,US,12345',
    ].join('\n');
    const cipher = c(parseMykiCsv(csv));
    expect(cipher.type).toBe(4);
    expect(cipher.login).toBeNull();
    expect(cipher.identity.firstName).toBe('John');
    expect(cipher.identity.lastName).toBe('Public');
    expect(cipher.identity.phone).toBe('555-1234');
    expect(cipher.identity.email).toBe('j@x.com');
    expect(cipher.identity.address1).toBe('1 St');
    expect(cipher.identity.postalCode).toBe('12345');
  });

  it('parses idType Passport identity with name splitting', () => {
    const csv = 'nickname,idType,idName,idNumber,idCountry\nP,Passport,John Q Public,X123,US';
    const cipher = c(parseMykiCsv(csv));
    expect(cipher.type).toBe(4);
    expect(cipher.identity.firstName).toBe('John');
    expect(cipher.identity.middleName).toBe('Q');
    expect(cipher.identity.lastName).toBe('Public');
    expect(cipher.identity.passportNumber).toBe('X123');
    expect(cipher.identity.ssn).toBeNull();
    expect(cipher.identity.licenseNumber).toBeNull();
    expect(cipher.identity.country).toBe('US');
  });

  it('parses idType Social Security and other (license)', () => {
    const ssn = c(parseMykiCsv('nickname,idType,idName,idNumber\nS,Social Security,Jane Doe,111'));
    expect(ssn.identity.ssn).toBe('111');
    expect(ssn.identity.passportNumber).toBeNull();
    expect(ssn.identity.lastName).toBe('Doe');

    const lic = c(parseMykiCsv('nickname,idType,idName,idNumber\nL,Drivers License,Bob,222'));
    expect(lic.identity.licenseNumber).toBe('222');
    expect(lic.identity.firstName).toBe('Bob');
    expect(lic.identity.middleName).toBeNull();
    expect(lic.identity.lastName).toBeNull();
  });

  it('parses content rows as secure notes', () => {
    const csv = 'nickname,content\nNote,body text  ';
    const cipher = c(parseMykiCsv(csv));
    expect(cipher.type).toBe(2);
    expect(cipher.login).toBeNull();
    expect(cipher.secureNote).toEqual({ type: 0 });
    expect(cipher.notes).toBe('body text');
  });

  it('url login with blank url yields null uris', () => {
    const csv = 'nickname,url,username\nNoUrl,,alice';
    const cipher = c(parseMykiCsv(csv));
    expect(cipher.login.uris).toBeNull();
    expect(cipher.login.username).toBe('alice');
  });

  it('skips rows that match no known shape', () => {
    const csv = 'nickname,additionalInfo\nNothing,info';
    expect(parseMykiCsv(csv).ciphers).toHaveLength(0);
  });
});

describe('parseNetwrixCsv', () => {
  it('maps German headers, totp, uri, folder and unmapped fields', () => {
    const csv = [
      'Organisationseinheit,Informationen,Beschreibung,Benutzername,Passwort,Internetseite,One-Time Passwort,Extra',
      'Dept,info text ,GitHub,octocat,pw,github.com,OTPSEC,extraval',
    ].join('\n');
    const p = parseNetwrixCsv(csv);
    const cipher = c(p);
    expect(cipher.name).toBe('GitHub');
    expect(cipher.notes).toBe('info text');
    expect(cipher.login.username).toBe('octocat');
    expect(cipher.login.password).toBe('pw');
    expect(cipher.login.totp).toBe('OTPSEC');
    expect(cipher.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(cipher.fields).toEqual([{ type: 0, name: 'Extra', value: 'extraval', linkedId: null }]);
    expect(p.folders.map((f) => f.name)).toEqual(['Dept']);
  });

  it('uses -- fallback and null uris when minimal', () => {
    const csv = 'Beschreibung,Benutzername\n,user';
    const cipher = c(parseNetwrixCsv(csv));
    expect(cipher.name).toBe('--');
    expect(cipher.login.uris).toBeNull();
  });
});

describe('parseRoboFormCsv', () => {
  it('parses login with leading-slash folder stripped and Pwd preferred', () => {
    const csv = [
      'Name,Url,Login,Pwd,Password,Note,Folder',
      'GitHub,github.com,octocat,realpw,ignored,a note,/Work/Dev',
    ].join('\n');
    const p = parseRoboFormCsv(csv);
    const cipher = c(p);
    expect(cipher.name).toBe('GitHub');
    expect(cipher.login.username).toBe('octocat');
    expect(cipher.login.password).toBe('realpw');
    expect(cipher.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(cipher.notes).toBe('a note');
    expect(p.folders.map((f) => f.name)).toEqual(['Work/Dev']);
  });

  it('falls back to Password and URL columns', () => {
    const csv = 'Name,URL,Login,Password\nX,x.com,u,fallbackpw';
    const cipher = c(parseRoboFormCsv(csv));
    expect(cipher.login.password).toBe('fallbackpw');
    expect(cipher.login.uris).toEqual([{ uri: 'http://x.com', match: null }]);
  });

  it('converts entries with no login data to secure notes and parses Rf_fields', () => {
    const csv = 'Name,Note,Rf_fields\nJustNote,remember this,key:value';
    const cipher = c(parseRoboFormCsv(csv));
    // no username/password/uri -> converted to note
    expect(cipher.type).toBe(2);
    expect(cipher.login).toBeNull();
    expect(cipher.secureNote).toEqual({ type: 0 });
  });
});

describe('parseZohoVaultCsv', () => {
  it('parses SecretData username/password and custom fields', () => {
    const secretData = 'Username:octocat\nPassword:hunter2\nNote Field:extra';
    const csv = parseZohoCsvBuild({
      'Password Name': 'GitHub',
      'Password URL': 'github.com',
      Notes: 'top note',
      Favorite: '1',
      SecretData: secretData,
      'Folder Name': 'Work',
    });
    const p = parseZohoVaultCsv(csv);
    const cipher = c(p);
    expect(cipher.name).toBe('GitHub');
    expect(cipher.favorite).toBe(true);
    expect(cipher.notes).toBe('top note');
    expect(cipher.login.username).toBe('octocat');
    expect(cipher.login.password).toBe('hunter2');
    expect(cipher.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(cipher.fields).toEqual([
      { type: 0, name: 'Note Field', value: 'extra', linkedId: null },
    ]);
    expect(p.folders.map((f) => f.name)).toEqual(['Work']);
  });

  it('uses Secret Name/URL fallbacks and skips SecretType, ignoring blank entries', () => {
    const csv = parseZohoCsvBuild({
      'Secret Name': 'API Key',
      'Secret URL': 'api.example.com',
      login_totp: 'TOTPSECRET',
      CustomData: 'SecretType:foo\nemail:me@x.com\n:noKey\nblankVal:',
    });
    const cipher = c(parseZohoVaultCsv(csv));
    expect(cipher.name).toBe('API Key');
    // email maps to username since username still empty
    expect(cipher.login.username).toBe('me@x.com');
    expect(cipher.login.totp).toBe('TOTPSECRET');
    expect(cipher.login.uris).toEqual([{ uri: 'http://api.example.com', match: null }]);
  });

  it('skips rows missing both name columns', () => {
    const csv = 'Password Name,Secret Name,Notes\n,,orphan';
    expect(parseZohoVaultCsv(csv).ciphers).toHaveLength(0);
  });

  it('converts to note when no login data present', () => {
    const csv = parseZohoCsvBuild({ 'Password Name': 'PlainNote', Notes: 'just text' });
    const cipher = c(parseZohoVaultCsv(csv));
    expect(cipher.type).toBe(2);
    expect(cipher.secureNote).toEqual({ type: 0 });
  });
});

// helper to build a single-row Zoho CSV from a record
function parseZohoCsvBuild(rec: Record<string, string>): string {
  const headers = Object.keys(rec);
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return `${headers.join(',')}\n${headers.map((h) => esc(rec[h])).join(',')}`;
}

describe('parseNordpassCsv', () => {
  it('parses password with additional_urls and custom_fields json', () => {
    const csv = parseZohoCsvBuild({
      type: 'password',
      name: 'GitHub',
      note: 'n',
      username: 'octocat',
      password: 'pw',
      url: 'github.com',
      additional_urls: JSON.stringify(['alt.com', '']),
      custom_fields: JSON.stringify([
        { label: 'API', value: 'key123', type: 'hidden' },
        { label: 'Plain', value: 'pv', type: 'text' },
      ]),
      folder: 'Work',
    });
    const p = parseNordpassCsv(csv);
    const cipher = c(p);
    expect(cipher.type).toBe(1);
    expect(cipher.name).toBe('GitHub');
    expect(cipher.login.username).toBe('octocat');
    expect(cipher.login.uris).toEqual([
      { uri: 'http://github.com', match: null },
      { uri: 'http://alt.com', match: null },
    ]);
    expect(cipher.fields).toEqual([
      { type: 1, name: 'API', value: 'key123', linkedId: null },
      { type: 0, name: 'Plain', value: 'pv', linkedId: null },
    ]);
    expect(p.folders.map((f) => f.name)).toEqual(['Work']);
  });

  it('tolerates malformed json in additional_urls and custom_fields', () => {
    const csv = parseZohoCsvBuild({
      type: 'password',
      name: 'X',
      url: 'x.com',
      additional_urls: '{bad',
      custom_fields: 'also bad',
    });
    const cipher = c(parseNordpassCsv(csv));
    expect(cipher.login.uris).toEqual([{ uri: 'http://x.com', match: null }]);
    expect(cipher.fields).toEqual([]);
  });

  it('parses note, credit_card, and personal_info types', () => {
    const csv = [
      'type,name,note,cardholdername,cardnumber,cvc,expiry_month,expiry_year,first_name,last_name,email,city',
      'note,Wifi,SSID home,,,,,,,,,',
      'credit_card,My Card,,Jane Doe,4111111111111111,123,08,2027,,,,',
      'personal_info,Me,,,,,,,John,Public,j@x.com,Town',
    ].join('\n');
    const p = parseNordpassCsv(csv);
    expect(p.ciphers).toHaveLength(3);
    const note = c(p, 0);
    expect(note.type).toBe(2);
    expect(note.notes).toBe('SSID home');
    const card = c(p, 1);
    expect(card.type).toBe(3);
    expect(card.card.number).toBe('4111111111111111');
    expect(card.card.brand).toBe('Visa');
    expect(card.card.expYear).toBe('2027');
    const id = c(p, 2);
    expect(id.type).toBe(4);
    expect(id.identity.firstName).toBe('John');
    expect(id.identity.lastName).toBe('Public');
    expect(id.identity.email).toBe('j@x.com');
    expect(id.identity.city).toBe('Town');
  });

  it('skips rows with empty or unknown type', () => {
    const csv = 'type,name\n,Nameless\nunknown,Other';
    expect(parseNordpassCsv(csv).ciphers).toHaveLength(0);
  });
});

describe('parsePassmanJson', () => {
  it('parses logins with totp, email-to-notes, tags folder and custom fields', () => {
    const json = JSON.stringify([
      {
        label: 'GitHub',
        username: 'octocat',
        email: 'oc@x.com',
        password: 'pw',
        url: 'github.com',
        description: 'desc',
        otp: { secret: 'OTPSEC' },
        custom_fields: [
          { label: 'API', value: 'k', field_type: 'password' },
          { label: 'Plain', value: 'v', field_type: 'text' },
          { label: 'File', value: 'ignore', field_type: 'file' },
        ],
        tags: [{ text: 'Work' }],
      },
    ]);
    const p = parsePassmanJson(json);
    const cipher = c(p);
    expect(cipher.name).toBe('GitHub');
    expect(cipher.login.username).toBe('octocat');
    expect(cipher.login.totp).toBe('OTPSEC');
    expect(cipher.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    // username !== email so email is prepended to notes
    expect(cipher.notes).toBe('Email: oc@x.com\ndesc');
    expect(cipher.fields).toEqual([
      { type: 0, name: 'API', value: 'k', linkedId: null },
      { type: 0, name: 'Plain', value: 'v', linkedId: null },
    ]);
    expect(p.folders.map((f) => f.name)).toEqual(['Work']);
  });

  it('falls back username to email and omits email note when equal', () => {
    const json = JSON.stringify([
      { label: 'X', email: 'same@x.com', password: 'p', description: 'd' },
    ]);
    const cipher = c(parsePassmanJson(json));
    expect(cipher.login.username).toBe('same@x.com');
    // username === email -> no "Email:" prefix
    expect(cipher.notes).toBe('d');
  });

  it('handles null array and missing fields', () => {
    expect(parsePassmanJson('null').ciphers).toHaveLength(0);
    const cipher = c(parsePassmanJson('[{}]'));
    expect(cipher.name).toBe('--');
    expect(cipher.login.uris).toBeNull();
    expect(cipher.notes).toBeNull();
  });
});

describe('parsePasskyJson', () => {
  it('parses passwords array', () => {
    const json = JSON.stringify({
      passwords: [
        { website: 'github.com', username: 'octocat', password: 'pw', message: 'note' },
      ],
    });
    const cipher = c(parsePasskyJson(json));
    expect(cipher.name).toBe('github.com');
    expect(cipher.login.username).toBe('octocat');
    expect(cipher.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(cipher.notes).toBe('note');
  });

  it('throws for encrypted backups', () => {
    expect(() => parsePasskyJson(JSON.stringify({ encrypted: true }))).toThrow(/encrypted/);
  });

  it('returns empty when passwords is not an array', () => {
    expect(parsePasskyJson('{}').ciphers).toHaveLength(0);
  });
});

describe('parsePsonoJson', () => {
  it('parses all item types at top level and nested folders', () => {
    const json = JSON.stringify({
      items: [
        {
          type: 'website_password',
          website_password_title: 'GitHub',
          website_password_username: 'octocat',
          website_password_password: 'pw',
          website_password_url: 'github.com',
          website_password_notes: 'wn',
        },
        {
          type: 'application_password',
          application_password_title: 'App',
          application_password_username: 'au',
          application_password_password: 'ap',
          application_password_notes: 'an',
        },
        { type: 'totp', totp_title: 'TOTP', totp_code: 'CODE', totp_notes: 'tn' },
        { type: 'bookmark', bookmark_title: 'BM', bookmark_url: 'site.com', bookmark_notes: 'bn' },
        { type: 'note', note_title: 'Note', note_notes: 'nn' },
        {
          type: 'environment_variables',
          environment_variables_title: 'Env',
          environment_variables_notes: 'en',
        },
        { type: 'unknown' },
        null,
      ],
      folders: [
        {
          name: 'Parent',
          items: [
            {
              type: 'website_password',
              website_password_title: 'Nested',
              website_password_username: 'nu',
            },
          ],
          folders: [
            {
              name: 'Child',
              items: [{ type: 'note', note_title: 'DeepNote', note_notes: 'dn' }],
            },
          ],
        },
      ],
    });
    const p = parsePsonoJson(json);
    const names = p.ciphers.map((x) => (x as any).name);
    expect(names).toEqual(['GitHub', 'App', 'TOTP', 'BM', 'Note', 'Env', 'Nested', 'DeepNote']);

    const web = c(p, 0);
    expect(web.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(web.login.username).toBe('octocat');
    const app = c(p, 1);
    expect(app.login.username).toBe('au');
    const totp = c(p, 2);
    expect(totp.login.totp).toBe('CODE');
    const bm = c(p, 3);
    expect(bm.login.uris).toEqual([{ uri: 'http://site.com', match: null }]);
    const note = c(p, 4);
    expect(note.type).toBe(2);
    expect(note.secureNote).toEqual({ type: 0 });
    const env = c(p, 5);
    expect(env.type).toBe(2);
    expect(env.name).toBe('Env');
    expect(env.notes).toBe('en');

    // folders: Parent then Parent/Child
    expect(p.folders.map((f) => f.name)).toEqual(['Parent', 'Parent/Child']);
    // Nested cipher (index 6) under Parent (folder 0)
    expect(p.folderRelationships).toContainEqual({ key: 6, value: 0 });
    expect(p.folderRelationships).toContainEqual({ key: 7, value: 1 });
  });

  it('attaches folder to application_password, totp and bookmark items', () => {
    const json = JSON.stringify({
      folders: [
        {
          name: 'Vault',
          items: [
            { type: 'application_password', application_password_title: 'App', application_password_username: 'u' },
            { type: 'totp', totp_title: 'T', totp_code: 'C' },
            { type: 'bookmark', bookmark_title: 'B', bookmark_url: 'b.com' },
          ],
        },
      ],
    });
    const p = parsePsonoJson(json);
    expect(p.folders.map((f) => f.name)).toEqual(['Vault']);
    // all three filed under the single folder
    expect(p.folderRelationships).toEqual([
      { key: 0, value: 0 },
      { key: 1, value: 0 },
      { key: 2, value: 0 },
    ]);
  });

  it('handles empty / missing top-level arrays', () => {
    expect(parsePsonoJson('{}').ciphers).toHaveLength(0);
  });
});

describe('parsePasswordBossJson', () => {
  it('parses login items with folder map and custom fields', () => {
    const json = JSON.stringify({
      folders: [{ id: 'f1', name: 'Work' }, { id: null, name: 'NoId' }],
      items: [
        {
          type: 'Login',
          name: 'GitHub',
          login_url: 'github.com',
          folder: 'f1',
          identifiers: {
            username: 'octocat',
            email: 'oc@x.com',
            password: 'pw',
            totp: 'OTP',
            notes: 'n',
            custom_fields: [{ name: 'API', value: 'k' }],
          },
        },
      ],
    });
    const p = parsePasswordBossJson(json);
    const cipher = c(p);
    expect(cipher.type).toBe(1);
    expect(cipher.name).toBe('GitHub');
    expect(cipher.login.username).toBe('octocat');
    expect(cipher.login.password).toBe('pw');
    expect(cipher.login.totp).toBe('OTP');
    expect(cipher.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(cipher.fields).toEqual([{ type: 0, name: 'API', value: 'k', linkedId: null }]);
    expect(p.folders.map((f) => f.name)).toEqual(['Work']);
    expect(p.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('falls back username to email and url to identifiers.url', () => {
    const json = JSON.stringify({
      items: [
        { type: 'Login', name: 'X', identifiers: { email: 'e@x.com', url: 'x.com' } },
      ],
    });
    const cipher = c(parsePasswordBossJson(json));
    expect(cipher.login.username).toBe('e@x.com');
    expect(cipher.login.uris).toEqual([{ uri: 'http://x.com', match: null }]);
  });

  it('parses CreditCard items', () => {
    const json = JSON.stringify({
      items: [
        {
          type: 'CreditCard',
          name: 'My Card',
          identifiers: {
            cardNumber: '4111111111111111',
            nameOnCard: 'Jane Doe',
            security_code: '123',
            notes: 'cardnote',
          },
        },
      ],
    });
    const cipher = c(parsePasswordBossJson(json));
    expect(cipher.type).toBe(3);
    expect(cipher.login).toBeNull();
    expect(cipher.card.number).toBe('4111111111111111');
    expect(cipher.card.cardholderName).toBe('Jane Doe');
    expect(cipher.card.code).toBe('123');
    expect(cipher.card.brand).toBe('Visa');
    expect(cipher.notes).toBe('cardnote');
  });

  it('handles missing folders/items and unknown folder id', () => {
    expect(parsePasswordBossJson('{}').ciphers).toHaveLength(0);
    const json = JSON.stringify({
      items: [{ type: 'Login', name: 'X', folder: 'missing', identifiers: {} }],
    });
    const p = parsePasswordBossJson(json);
    expect(p.folders).toHaveLength(0);
    expect(c(p).name).toBe('X');
  });

  it('handles item with no identifiers and custom field with missing name/value', () => {
    const json = JSON.stringify({
      items: [
        { type: 'Login', name: 'NoIds' },
        {
          type: 'Login',
          name: 'CF',
          identifiers: { custom_fields: [{}, { name: 'k', value: 'v' }] },
        },
      ],
    });
    const p = parsePasswordBossJson(json);
    expect(c(p, 0).name).toBe('NoIds');
    expect(c(p, 0).login.uris).toBeNull();
    // empty-name/value cf produces nothing; the populated one is added
    expect(c(p, 1).fields).toEqual([{ type: 0, name: 'k', value: 'v', linkedId: null }]);
  });
});
