import { describe, expect, it } from 'vitest';
import {
  parseEnpassCsv,
  parseEnpassJson,
  parseKeeperCsv,
  parseKeeperJson,
  parseLogMeOnceCsv,
  parseMeldiumCsv,
  parseProtonPassJson,
} from '@/lib/import-formats-password-managers';

// ---------------------------------------------------------------------------
// parseEnpassCsv
//
// Enpass CSV rows are positional: Title, [fieldName, fieldValue]..., note.
// The parser only walks the field/value pairs when the row has an even length
// (> 2). Login hints (username/password/email/url) keep it a type-1 login;
// card hints (cardholder/number/expiry date) make it a type-3 card; rows with
// no login hints (or exactly 2 columns) become type-2 secure notes.
// ---------------------------------------------------------------------------
describe('parseEnpassCsv', () => {
  it('parses a login item with username/password/url/totp', () => {
    // Title, url, <url>, username, <user>, password, <pw>, totp, <code>, note
    // length = 10 (even). Last column is the note.
    const csv = 'GitHub,url,github.com,username,octocat,password,hunter2,totp,otpauth://x,my note';
    const payload = parseEnpassCsv(csv);
    expect(payload.ciphers).toHaveLength(1);
    const c = payload.ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.name).toBe('GitHub');
    expect(c.notes).toBe('my note');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.totp).toBe('otpauth://x');
    expect(c.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
  });

  it('uses email as username and keeps the first value when duplicated', () => {
    // duplicate username pairs: second should be ignored (already set).
    const csv = 'Acct,email,a@b.com,username,second,password,pw1,password,pw2,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.login.username).toBe('a@b.com');
    expect(c.login.password).toBe('pw1');
  });

  it('routes unknown fields through processKvp into custom fields', () => {
    const csv = 'Acct,username,bob,password,pw,Security Question,my-pet,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.fields).toEqual([
      { type: 0, name: 'Security Question', value: 'my-pet', linkedId: null },
    ]);
  });

  it('skips the header row and rows with fewer than two columns', () => {
    const csv = ['Title,url,username', 'only-one'].join('\n');
    const payload = parseEnpassCsv(csv);
    expect(payload.ciphers).toHaveLength(0);
  });

  it('treats a two-column row as a secure note', () => {
    const csv = 'Wifi Password,SSID is home';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.name).toBe('Wifi Password');
    expect(c.notes).toBe('SSID is home');
  });

  it('treats a row without login hints as a secure note even with extra columns', () => {
    // No login/card hints -> secure note. Even length so KVP loop runs but
    // type is 2, so pairs flow through processKvp.
    const csv = 'Server,Hostname,db01,Port,5432,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.fields).toEqual([
      { type: 0, name: 'Hostname', value: 'db01', linkedId: null },
      { type: 0, name: 'Port', value: '5432', linkedId: null },
    ]);
  });

  it('parses a credit card item with cardholder/number/cvc/expiry', () => {
    const csv =
      'My Card,cardholder,Jane Doe,number,4111111111111111,cvc,123,expiry date,08/27,type,Visa,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.login).toBeNull();
    expect(c.card.cardholderName).toBe('Jane Doe');
    expect(c.card.number).toBe('4111111111111111');
    expect(c.card.brand).toBe('Visa');
    expect(c.card.code).toBe('123');
    expect(c.card.expMonth).toBe('8');
    expect(c.card.expYear).toBe('2027');
  });

  it('leaves card expiry unset when it does not match the expected pattern', () => {
    const csv = 'Card,number,4111111111111111,expiry date,not-a-date,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.card.expMonth).toBeNull();
    expect(c.card.expYear).toBeNull();
  });

  it('keeps a four-digit expiry year as-is', () => {
    const csv = 'Card,number,4111111111111111,expiry date,08/2027,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.card.expMonth).toBe('8');
    expect(c.card.expYear).toBe('2027');
  });

  it('does not walk field pairs when the row length is odd', () => {
    // odd length (5): the pair loop is skipped entirely.
    const csv = 'Acct,username,bob,password,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.login.username).toBeNull();
    expect(c.login.password).toBeNull();
  });

  it('skips empty field values', () => {
    const csv = 'Acct,username,,password,pw,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.login.username).toBeNull();
    expect(c.login.password).toBe('pw');
  });

  it('falls back to -- for a missing title', () => {
    const csv = ',username,bob,password,pw,note';
    const c = parseEnpassCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('--');
  });
});

// ---------------------------------------------------------------------------
// parseEnpassJson
// ---------------------------------------------------------------------------
describe('parseEnpassJson', () => {
  it('parses a login item with fields and folder assignment', () => {
    const json = JSON.stringify({
      folders: [{ uuid: 'f1', title: 'Work' }],
      items: [
        {
          title: 'GitHub',
          favorite: 1,
          note: 'note here',
          template_type: 'login.default',
          folders: ['f1'],
          fields: [
            { type: 'username', value: 'octocat' },
            { type: 'email', value: 'oct@cat.com' },
            { type: 'password', value: 'hunter2' },
            { type: 'totp', value: 'otpauth://x' },
            { type: 'url', value: 'github.com' },
            { type: 'section', value: 'ignored' },
            { type: 'note', value: 'extra', label: 'Extra', sensitive: 0 },
          ],
        },
      ],
    });
    const payload = parseEnpassJson(json);
    const c = payload.ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.favorite).toBe(true);
    expect(c.notes).toBe('note here');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.totp).toBe('otpauth://x');
    expect(c.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    // The second (email) field is dropped from username (already set) and has no
    // label, so it becomes a custom field with an empty name. The note field
    // keeps its label.
    expect(c.fields).toEqual([
      { type: 0, name: '', value: 'oct@cat.com', linkedId: null },
      { type: 0, name: 'Extra', value: 'extra', linkedId: null },
    ]);
    expect(payload.folders).toEqual([{ name: 'Work' }]);
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('detects a login by a password field even without a login template', () => {
    const json = JSON.stringify({
      items: [
        {
          title: 'Implicit',
          template_type: 'something.else',
          fields: [
            { type: 'password', value: 'pw' },
            { type: 'customField', value: 'extra', label: 'Custom', sensitive: 1 },
          ],
        },
      ],
    });
    const c = parseEnpassJson(json).ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.login.password).toBe('pw');
    expect(c.login.uris).toBeNull();
    // unknown login-field type falls through to processKvp as a hidden field
    expect(c.fields).toEqual([{ type: 1, name: 'Custom', value: 'extra', linkedId: null }]);
  });

  it('rewrites .Android# fields into androidapp:// uris', () => {
    const json = JSON.stringify({
      items: [
        {
          title: 'App',
          template_type: 'login.default',
          fields: [
            { type: 'password', value: 'pw' },
            { type: '.Android#', value: 'com.example.app' },
          ],
        },
      ],
    });
    const c = parseEnpassJson(json).ciphers[0] as any;
    expect(c.login.uris).toEqual([{ uri: 'androidapp://com.example.app', match: null }]);
  });

  it('parses a credit card item including expiry parsing', () => {
    const json = JSON.stringify({
      items: [
        {
          title: 'Card',
          template_type: 'creditcard.default',
          fields: [
            { type: 'ccName', value: 'Jane Doe' },
            { type: 'ccNumber', value: '5500000000000004' },
            { type: 'ccCvc', value: '999' },
            { type: 'ccExpiry', value: '08/27' },
            { type: 'ccType', value: 'ignored' },
            { type: 'section', value: 'ignored' },
          ],
        },
      ],
    });
    const c = parseEnpassJson(json).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.card.cardholderName).toBe('Jane Doe');
    expect(c.card.number).toBe('5500000000000004');
    expect(c.card.brand).toBe('Mastercard');
    expect(c.card.code).toBe('999');
    expect(c.card.expMonth).toBe('8');
    expect(c.card.expYear).toBe('2027');
  });

  it('routes a non-matching ccExpiry value through processKvp', () => {
    const json = JSON.stringify({
      items: [
        {
          title: 'Card',
          template_type: 'creditcard.default',
          fields: [
            { type: 'ccNumber', value: '4111111111111111' },
            { type: 'ccExpiry', value: 'invalid', label: 'Expiry', sensitive: 1 },
          ],
        },
      ],
    });
    const c = parseEnpassJson(json).ciphers[0] as any;
    expect(c.card.expMonth).toBeNull();
    expect(c.fields).toEqual([{ type: 1, name: 'Expiry', value: 'invalid', linkedId: null }]);
  });

  it('parses a secure note item (unknown template, no password)', () => {
    const json = JSON.stringify({
      items: [
        {
          title: 'Note',
          template_type: 'note.default',
          fields: [
            { type: 'text', value: 'detail', label: 'Detail', sensitive: 0 },
            { type: 'section', value: 'ignored' },
          ],
        },
      ],
    });
    const c = parseEnpassJson(json).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.fields).toEqual([{ type: 0, name: 'Detail', value: 'detail', linkedId: null }]);
  });

  it('handles empty/missing folders and items arrays', () => {
    expect(parseEnpassJson('{}').ciphers).toEqual([]);
    const payload = parseEnpassJson(JSON.stringify({ items: [{ title: 'x' }] }));
    // no template_type, no password field -> secure note
    expect((payload.ciphers[0] as any).type).toBe(2);
  });

  it('ignores a folder reference that is not in the folder map', () => {
    const json = JSON.stringify({
      items: [{ title: 'x', template_type: 'login.default', folders: ['missing'], fields: [] }],
    });
    const payload = parseEnpassJson(json);
    expect(payload.folders).toEqual([]);
    expect(payload.folderRelationships).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseKeeperCsv
//
// Columns: folder, title, username, password, url, notes, <shared?>, [k, v]...
// ---------------------------------------------------------------------------
describe('parseKeeperCsv', () => {
  it('parses logins with custom fields, totp, and folders', () => {
    const csv =
      'Work,GitHub,octocat,hunter2,github.com,my note,,TFC:Keeper,otp-secret,API Key,abc123';
    const payload = parseKeeperCsv(csv);
    const c = payload.ciphers[0] as any;
    expect(c.name).toBe('GitHub');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(c.notes).toBe('my note');
    expect(c.login.totp).toBe('otp-secret');
    expect(c.fields).toEqual([{ type: 0, name: 'API Key', value: 'abc123', linkedId: null }]);
    expect(payload.folders).toEqual([{ name: 'Work' }]);
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('skips rows with fewer than six columns', () => {
    const csv = 'Work,GitHub,octocat,hunter2,github.com';
    expect(parseKeeperCsv(csv).ciphers).toHaveLength(0);
  });

  it('does not process custom fields when there are seven or fewer columns', () => {
    const csv = 'Work,GitHub,octocat,hunter2,github.com,note,unused';
    const c = parseKeeperCsv(csv).ciphers[0] as any;
    expect(c.fields).toEqual([]);
  });

  it('skips a custom-field pair with an empty key', () => {
    const csv = 'Work,GitHub,octocat,hunter2,github.com,note,,,orphan-value';
    const c = parseKeeperCsv(csv).ciphers[0] as any;
    expect(c.fields).toEqual([]);
  });

  it('leaves uris null when url is empty', () => {
    const csv = 'Work,GitHub,octocat,hunter2,,note';
    const c = parseKeeperCsv(csv).ciphers[0] as any;
    expect(c.login.uris).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseKeeperJson
// ---------------------------------------------------------------------------
describe('parseKeeperJson', () => {
  it('parses records with custom fields, totp, and folders', () => {
    const json = JSON.stringify({
      records: [
        {
          title: 'GitHub',
          login: 'octocat',
          password: 'hunter2',
          login_url: 'github.com',
          notes: 'my note',
          custom_fields: { 'TFC:Keeper': 'otp-secret', 'API Key': 'abc' },
          folders: [{ folder: 'Work' }, { shared_folder: 'Team' }],
        },
      ],
    });
    const payload = parseKeeperJson(json);
    const c = payload.ciphers[0] as any;
    expect(c.name).toBe('GitHub');
    expect(c.login.username).toBe('octocat');
    expect(c.login.totp).toBe('otp-secret');
    expect(c.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(c.fields).toEqual([{ type: 0, name: 'API Key', value: 'abc', linkedId: null }]);
    expect(payload.folders).toEqual([{ name: 'Work' }, { name: 'Team' }]);
    expect(payload.folderRelationships).toEqual([
      { key: 0, value: 0 },
      { key: 0, value: 1 },
    ]);
  });

  it('handles a record without a folders array', () => {
    const json = JSON.stringify({
      records: [{ title: 'NoFolder', login: 'u', password: 'p' }],
    });
    const payload = parseKeeperJson(json);
    expect(payload.ciphers).toHaveLength(1);
    expect(payload.folders).toEqual([]);
    expect(payload.folderRelationships).toEqual([]);
  });

  it('skips folder entries with neither folder nor shared_folder', () => {
    const json = JSON.stringify({
      records: [{ title: 'x', folders: [{}, { folder: 'Real' }] }],
    });
    const payload = parseKeeperJson(json);
    expect(payload.folders).toEqual([{ name: 'Real' }]);
  });

  it('returns an empty payload when records is missing or not an array', () => {
    expect(parseKeeperJson('{}').ciphers).toEqual([]);
    expect(parseKeeperJson(JSON.stringify({ records: 'nope' })).ciphers).toEqual([]);
  });

  it('handles missing custom_fields and null custom values', () => {
    const json = JSON.stringify({
      records: [{ title: 'x', login: 'u', custom_fields: { Empty: null } }],
    });
    const c = parseKeeperJson(json).ciphers[0] as any;
    // null coerces to '' -> processKvp drops it.
    expect(c.fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseLogMeOnceCsv
//
// Columns: name, url, username, password
// ---------------------------------------------------------------------------
describe('parseLogMeOnceCsv', () => {
  it('parses login rows', () => {
    const csv = 'GitHub,github.com,octocat,hunter2';
    const c = parseLogMeOnceCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.name).toBe('GitHub');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
  });

  it('skips rows with fewer than four columns', () => {
    expect(parseLogMeOnceCsv('GitHub,github.com,octocat').ciphers).toHaveLength(0);
  });

  it('falls back to -- for a missing name and null uris for empty url', () => {
    const c = parseLogMeOnceCsv(',,user,pw').ciphers[0] as any;
    expect(c.name).toBe('--');
    expect(c.login.uris).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseMeldiumCsv (header-based via parseCsv)
// ---------------------------------------------------------------------------
describe('parseMeldiumCsv', () => {
  it('maps named columns onto login ciphers', () => {
    const csv = [
      'DisplayName,Url,UserName,Password,Notes',
      'GitHub,github.com,octocat,hunter2,my note',
    ].join('\n');
    const c = parseMeldiumCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('GitHub');
    expect(c.notes).toBe('my note');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
  });

  it('falls back to -- and null uris when fields are missing', () => {
    const csv = ['DisplayName,Url,UserName,Password,Notes', ',,user,pw,'].join('\n');
    const c = parseMeldiumCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('--');
    expect(c.login.uris).toBeNull();
    expect(c.notes).toBeNull();
  });

  it('returns an empty payload for header-only input', () => {
    expect(parseMeldiumCsv('DisplayName,Url,UserName,Password').ciphers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseProtonPassJson
// ---------------------------------------------------------------------------
describe('parseProtonPassJson', () => {
  it('throws on an encrypted export', () => {
    expect(() => parseProtonPassJson(JSON.stringify({ encrypted: true }))).toThrow(
      /encrypted Proton Pass/
    );
  });

  it('parses a login item with urls, totp, and email split-out', () => {
    const json = JSON.stringify({
      vaults: {
        v1: {
          name: 'Personal',
          items: [
            {
              pinned: true,
              data: {
                type: 'login',
                metadata: { name: 'GitHub', note: 'my note' },
                content: {
                  urls: ['github.com', ''],
                  itemUsername: 'octocat',
                  itemEmail: 'oct@cat.com',
                  password: 'hunter2',
                  totpUri: 'otpauth://x',
                },
                extraFields: [
                  { type: 'text', fieldName: 'Hint', data: { content: 'plain' } },
                  { type: 'hidden', fieldName: 'Secret', data: { content: 'sssh' } },
                  { type: 'totp', fieldName: 'Backup', data: { totpUri: 'otpauth://y' } },
                ],
              },
            },
          ],
        },
      },
    });
    const payload = parseProtonPassJson(json);
    const c = payload.ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.favorite).toBe(true);
    expect(c.name).toBe('GitHub');
    expect(c.notes).toBe('my note');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.totp).toBe('otpauth://x');
    expect(c.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    // username + email present -> email captured as a custom field
    expect(c.fields).toEqual(
      expect.arrayContaining([
        { type: 0, name: 'email', value: 'oct@cat.com', linkedId: null },
        { type: 0, name: 'Hint', value: 'plain', linkedId: null },
        { type: 1, name: 'Secret', value: 'sssh', linkedId: null },
        { type: 1, name: 'Backup', value: 'otpauth://y', linkedId: null },
      ])
    );
    expect(payload.folders).toEqual([{ name: 'Personal' }]);
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('uses email as username when no username is present', () => {
    const json = JSON.stringify({
      vaults: {
        v1: {
          name: '',
          items: [
            {
              data: {
                type: 'login',
                metadata: { name: 'X' },
                content: { itemEmail: 'only@email.com', urls: [] },
              },
            },
          ],
        },
      },
    });
    const c = parseProtonPassJson(json).ciphers[0] as any;
    expect(c.login.username).toBe('only@email.com');
    expect(c.login.uris).toBeNull();
    // email NOT duplicated into fields when it is the username
    expect(c.fields).toEqual([]);
  });

  it('skips trashed items (state === 2)', () => {
    const json = JSON.stringify({
      vaults: {
        v1: {
          name: 'V',
          items: [{ state: 2, data: { type: 'login', metadata: { name: 'gone' } } }],
        },
      },
    });
    expect(parseProtonPassJson(json).ciphers).toEqual([]);
  });

  it('parses a note item', () => {
    const json = JSON.stringify({
      vaults: {
        v1: { name: 'V', items: [{ data: { type: 'note', metadata: { name: 'N', note: 'body' } } }] },
      },
    });
    const c = parseProtonPassJson(json).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.notes).toBe('body');
  });

  it('parses a credit card item with expiry and PIN', () => {
    const json = JSON.stringify({
      vaults: {
        v1: {
          name: 'V',
          items: [
            {
              data: {
                type: 'creditCard',
                metadata: { name: 'Card' },
                content: {
                  cardholderName: 'Jane Doe',
                  number: '4111111111111111',
                  verificationNumber: '123',
                  expirationDate: '202708',
                  pin: '0000',
                },
              },
            },
          ],
        },
      },
    });
    const c = parseProtonPassJson(json).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.card.cardholderName).toBe('Jane Doe');
    expect(c.card.number).toBe('4111111111111111');
    expect(c.card.brand).toBe('Visa');
    expect(c.card.code).toBe('123');
    expect(c.card.expMonth).toBe('8');
    expect(c.card.expYear).toBe('2027');
    expect(c.fields).toEqual([{ type: 1, name: 'PIN', value: '0000', linkedId: null }]);
  });

  it('parses an identity item including extra sections and array fields', () => {
    const json = JSON.stringify({
      vaults: {
        v1: {
          name: 'V',
          items: [
            {
              data: {
                type: 'identity',
                metadata: { name: 'Me' },
                content: {
                  fullName: 'John Fitzgerald Kennedy',
                  email: 'jfk@example.com',
                  phoneNumber: '555-1234',
                  city: 'Boston',
                  floor: '3',
                  county: 'Suffolk',
                  customField: 'kept',
                  arrayField: [{ fieldName: 'Nick', data: { content: 'Jack' }, type: 'text' }],
                  extraSections: [
                    {
                      sectionFields: [
                        { fieldName: 'Code', data: { content: 'XYZ' }, type: 'hidden' },
                      ],
                    },
                  ],
                },
                extraFields: [
                  { fieldName: 'Top', data: { content: 'level' }, type: 'text' },
                ],
              },
            },
          ],
        },
      },
    });
    const c = parseProtonPassJson(json).ciphers[0] as any;
    expect(c.type).toBe(4);
    expect(c.login).toBeNull();
    expect(c.identity.firstName).toBe('John');
    expect(c.identity.middleName).toBe('Fitzgerald');
    expect(c.identity.lastName).toBe('Kennedy');
    expect(c.identity.email).toBe('jfk@example.com');
    expect(c.identity.phone).toBe('555-1234');
    expect(c.identity.city).toBe('Boston');
    expect(c.identity.address3).toBe('3 Suffolk');
    expect(c.fields).toEqual(
      expect.arrayContaining([
        { type: 0, name: 'customField', value: 'kept', linkedId: null },
        { type: 0, name: 'Nick', value: 'Jack', linkedId: null },
        { type: 1, name: 'Code', value: 'XYZ', linkedId: null },
        { type: 0, name: 'Top', value: 'level', linkedId: null },
      ])
    );
  });

  it('uses split full name when explicit name fields are absent', () => {
    const json = JSON.stringify({
      vaults: {
        v1: {
          name: 'V',
          items: [
            {
              data: {
                type: 'identity',
                metadata: { name: 'Me' },
                content: { fullName: 'Ada Lovelace' },
              },
            },
          ],
        },
      },
    });
    const c = parseProtonPassJson(json).ciphers[0] as any;
    expect(c.identity.firstName).toBe('Ada');
    expect(c.identity.lastName).toBe('Lovelace');
    expect(c.identity.address3).toBeNull();
  });

  it('skips items of unknown type', () => {
    const json = JSON.stringify({
      vaults: {
        v1: { name: 'V', items: [{ data: { type: 'sshKey', metadata: { name: 'k' } } }] },
      },
    });
    expect(parseProtonPassJson(json).ciphers).toEqual([]);
  });

  it('handles missing vaults gracefully', () => {
    expect(parseProtonPassJson('{}').ciphers).toEqual([]);
    expect(parseProtonPassJson(JSON.stringify({ vaults: null })).ciphers).toEqual([]);
  });

  it('does not assign a folder when the vault has no name', () => {
    const json = JSON.stringify({
      vaults: {
        v1: { name: '', items: [{ data: { type: 'note', metadata: { name: 'N' } } }] },
      },
    });
    const payload = parseProtonPassJson(json);
    expect(payload.ciphers).toHaveLength(1);
    expect(payload.folders).toEqual([]);
  });
});
