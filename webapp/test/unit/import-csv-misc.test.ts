import { describe, expect, it } from 'vitest';
import {
  parseArcCsv,
  parseAscendoCsv,
  parseBlackberryCsv,
  parseBlurCsv,
  parseButtercupCsv,
  parseCodebookCsv,
  parseDashlaneCsv,
  parseDashlaneJson,
  parseEncryptrCsv,
  parseKeePassCsv,
  parseKeePassXCsv,
  parseKeePassXml,
  parseLastPassCsv,
} from '@/lib/import-formats-csv-misc';

 

describe('parseArcCsv', () => {
  it('maps url/username/password/note onto login ciphers and derives name from url', () => {
    const csv = 'url,username,password,note\nhttps://example.com,alice,s3cret,hello';
    const payload = parseArcCsv(csv);
    expect(payload.ciphers).toHaveLength(1);
    const c = payload.ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.name).toBe('example.com');
    expect(c.login.username).toBe('alice');
    expect(c.login.password).toBe('s3cret');
    expect(c.login.uris).toEqual([{ uri: 'https://example.com', match: null }]);
    expect(c.notes).toBe('hello');
  });

  it('falls back to "--" name and null uris when url is missing', () => {
    const csv = 'url,username,password,note\n,bob,pw,';
    const c = parseArcCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('--');
    expect(c.login.uris).toBeNull();
    expect(c.notes).toBeNull();
  });
});

describe('parseAscendoCsv', () => {
  it('maps name, trailing note, and even key/value pairs into login fields', () => {
    // row: [name, field1, value1, field2, value2, ..., note] (even length, >2)
    const csv = '"Acme","username","alice","password","s3cret","url","example.com","my notes"';
    const c = parseAscendoCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('Acme');
    expect(c.notes).toBe('my notes');
    expect(c.login.username).toBe('alice');
    expect(c.login.password).toBe('s3cret');
    expect(c.login.uris).toEqual([{ uri: 'http://example.com', match: null }]);
  });

  it('skips rows shorter than 2 columns', () => {
    const csv = 'OnlyOne';
    expect(parseAscendoCsv(csv).ciphers).toHaveLength(0);
  });

  it('puts unrecognised key/value pairs into custom fields', () => {
    const csv = '"Acme","Security Question","my answer","trailing note"';
    const c = parseAscendoCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('Acme');
    expect(c.notes).toBe('trailing note');
    expect(c.fields).toEqual([
      { type: 0, name: 'Security Question', value: 'my answer', linkedId: null },
    ]);
  });

  it('skips empty field/value pairs and converts to a note when no login data', () => {
    // even length 4, but the field is empty so the pair is skipped -> no login data
    const csv = '"Acme","","","trailing"';
    const c = parseAscendoCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.notes).toBe('trailing');
  });

  it('does not iterate pairs for odd-length rows', () => {
    // length 3 (odd) -> no pair loop; last cell is the note; no login -> note
    const csv = '"Acme","username","trailing"';
    const c = parseAscendoCsv(csv).ciphers[0] as any;
    expect(c.notes).toBe('trailing');
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
  });
});

describe('parseBlackberryCsv', () => {
  it('parses a login row with favorite and uri', () => {
    const csv = [
      'name,username,password,url,extra,fav,grouping',
      'GitHub,octocat,hunter2,https://github.com,note text,1,login',
    ].join('\n');
    const c = parseBlackberryCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('GitHub');
    expect(c.favorite).toBe(true);
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.uris).toEqual([{ uri: 'https://github.com', match: null }]);
    expect(c.notes).toBe('note text');
  });

  it('skips rows whose grouping is "list"', () => {
    const csv = [
      'name,grouping',
      'Ignore,list',
    ].join('\n');
    expect(parseBlackberryCsv(csv).ciphers).toHaveLength(0);
  });

  it('treats grouping "note" rows as secure notes (no login population)', () => {
    const csv = [
      'name,extra,grouping',
      'Wifi,SSID home,note',
    ].join('\n');
    const c = parseBlackberryCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
    expect(c.notes).toBe('SSID home');
  });

  it('converts a login row with no credentials into a note', () => {
    const csv = [
      'name,username,password,url,grouping',
      'Empty,,,,login',
    ].join('\n');
    const c = parseBlackberryCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
  });
});

describe('parseBlurCsv', () => {
  it('uses label as name and email as username, username column as notes', () => {
    const csv = [
      'label,domain,email,username,password',
      'My Site,example.com,me@example.com,legacyuser,pw',
    ].join('\n');
    const c = parseBlurCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('My Site');
    expect(c.login.username).toBe('me@example.com');
    expect(c.login.password).toBe('pw');
    expect(c.login.uris).toEqual([{ uri: 'http://example.com', match: null }]);
    expect(c.notes).toBe('legacyuser');
  });

  it('treats label "null" as empty and derives name from domain', () => {
    const csv = [
      'label,domain,email,username,password',
      'null,example.com,,user1,pw',
    ].join('\n');
    const c = parseBlurCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('example.com');
    // no email but username present -> username used directly, no notes
    expect(c.login.username).toBe('user1');
    expect(c.notes).toBeNull();
  });

  it('falls back to "--" when label and domain are both missing', () => {
    const csv = [
      'label,domain,email,username,password',
      ',,e@x.com,,pw',
    ].join('\n');
    const c = parseBlurCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('--');
    expect(c.login.uris).toBeNull();
    expect(c.login.username).toBe('e@x.com');
  });

  it('uses email column (and clears notes) when both email and username are absent', () => {
    const csv = [
      'label,domain,email,username,password',
      'Site,example.com,,,pw',
    ].join('\n');
    const c = parseBlurCsv(csv).ciphers[0] as any;
    // !email && username both false -> else branch: username=email(null), notes=username(null)
    expect(c.login.username).toBeNull();
    expect(c.notes).toBeNull();
  });
});

describe('parseButtercupCsv', () => {
  it('maps standard columns and routes custom columns to fields, plus group folder', () => {
    const csv = [
      '!group_id,!group_name,!type,title,username,password,url,note,CustomKey',
      'g1,Personal,login,Email,alice,pw,https://mail.com,a note,customval',
    ].join('\n');
    const payload = parseButtercupCsv(csv);
    const c = payload.ciphers[0] as any;
    expect(c.name).toBe('Email');
    expect(c.login.username).toBe('alice');
    expect(c.login.uris).toEqual([{ uri: 'https://mail.com', match: null }]);
    expect(c.notes).toBe('a note');
    expect(c.fields).toEqual([{ type: 0, name: 'CustomKey', value: 'customval', linkedId: null }]);
    expect(payload.folders.map((f) => f.name)).toEqual(['Personal']);
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('accepts alternate-cased URL/Note column names', () => {
    const csv = [
      'title,URL,Notes',
      'Site,http://up.com,upper note',
    ].join('\n');
    const c = parseButtercupCsv(csv).ciphers[0] as any;
    expect(c.login.uris).toEqual([{ uri: 'http://up.com', match: null }]);
    expect(c.notes).toBe('upper note');
  });
});

describe('parseCodebookCsv', () => {
  it('parses login with totp, favorite, folder, and extra processed fields', () => {
    const csv = [
      'Entry,Username,Email,Password,TOTP,Website,Note,Favorite,Category,Phone,PIN,Account,Date',
      'Bank,alice,alice@x.com,pw,otpsecret,bank.com,a note,true,Finance,555-1234,1234,acct1,2020',
    ].join('\n');
    const payload = parseCodebookCsv(csv);
    const c = payload.ciphers[0] as any;
    expect(c.name).toBe('Bank');
    expect(c.favorite).toBe(true);
    expect(c.login.username).toBe('alice');
    expect(c.login.password).toBe('pw');
    expect(c.login.totp).toBe('otpsecret');
    expect(c.login.uris).toEqual([{ uri: 'http://bank.com', match: null }]);
    // Username present, so Email is added as a field; plus Phone/PIN/Account/Date
    const fieldNames = (c.fields as any[]).map((f) => f.name);
    expect(fieldNames).toEqual(['Email', 'Phone', 'PIN', 'Account', 'Date']);
    expect(payload.folders.map((f) => f.name)).toEqual(['Finance']);
  });

  it('uses Email as username when Username is empty and does not add Email field', () => {
    const csv = [
      'Entry,Username,Email,Password,Category',
      'Bank,,alice@x.com,pw,',
    ].join('\n');
    const c = parseCodebookCsv(csv).ciphers[0] as any;
    expect(c.login.username).toBe('alice@x.com');
    expect(c.fields).toEqual([]);
  });

  it('converts to a note when there is no login data', () => {
    const csv = [
      'Entry,Note,Category',
      'Just a note,body text,',
    ].join('\n');
    const c = parseCodebookCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.login).toBeNull();
    expect(c.notes).toBe('body text');
  });
});

describe('parseEncryptrCsv', () => {
  it('parses a Password entry type into a login', () => {
    const csv = [
      'Label,Notes,Text,Entry Type,Username,Password,Site URL',
      'My Login,note1,,Password,alice,pw,https://x.com',
    ].join('\n');
    const c = parseEncryptrCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.name).toBe('My Login');
    expect(c.login.username).toBe('alice');
    expect(c.login.uris).toEqual([{ uri: 'https://x.com', match: null }]);
    expect(c.notes).toBe('note1');
  });

  it('appends Text to existing notes', () => {
    const csv = [
      'Label,Notes,Text,Entry Type',
      'Note Entry,base note,extra text,General',
    ].join('\n');
    const c = parseEncryptrCsv(csv).ciphers[0] as any;
    expect(c.notes).toBe('base note\n\nextra text');
  });

  it('uses Text alone as notes when Notes is empty', () => {
    const csv = [
      'Label,Notes,Text,Entry Type',
      'Note Entry,,only text,General',
    ].join('\n');
    const c = parseEncryptrCsv(csv).ciphers[0] as any;
    // General type -> converts to note (no login data)
    expect(c.type).toBe(2);
    expect(c.notes).toBe('only text');
  });

  it('parses a Credit Card entry with MM/YY expiry', () => {
    const csv = [
      'Label,Entry Type,Name on card,Card Number,CVV,Expiry',
      'My Card,Credit Card,Alice Doe,4111111111111111,123,08/27',
    ].join('\n');
    const c = parseEncryptrCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(3);
    expect(c.login).toBeNull();
    expect(c.card).toEqual({
      cardholderName: 'Alice Doe',
      number: '4111111111111111',
      brand: 'Visa',
      code: '123',
      expMonth: '08',
      expYear: '2027',
    });
  });

  it('parses a Credit Card with a 4-digit expiry year and trailing slash handling', () => {
    const csv = [
      'Label,Entry Type,Card Number,Expiry',
      'My Card,Credit Card,5500000000000004,12/2030',
    ].join('\n');
    const c = parseEncryptrCsv(csv).ciphers[0] as any;
    expect(c.card.brand).toBe('Mastercard');
    expect(c.card.expMonth).toBe('12');
    expect(c.card.expYear).toBe('2030');
  });

  it('leaves card expiry null when there is no slash in expiry', () => {
    const csv = [
      'Label,Entry Type,Card Number,Expiry',
      'My Card,Credit Card,4111111111111111,noexpiry',
    ].join('\n');
    const c = parseEncryptrCsv(csv).ciphers[0] as any;
    expect(c.card.expMonth).toBeNull();
    expect(c.card.expYear).toBeNull();
  });
});

describe('parseKeePassXCsv', () => {
  it('parses standard columns, totp, folder (Root/ stripped) and extra fields', () => {
    const csv = [
      'Group,Title,Username,Password,URL,Notes,TOTP,Extra',
      'Root/Work,GitHub,octocat,hunter2,https://github.com,my note,otpval,extraval',
    ].join('\n');
    const payload = parseKeePassXCsv(csv);
    const c = payload.ciphers[0] as any;
    expect(c.name).toBe('GitHub');
    expect(c.login.username).toBe('octocat');
    expect(c.login.totp).toBe('otpval');
    expect(c.login.uris).toEqual([{ uri: 'https://github.com', match: null }]);
    expect(c.notes).toBe('my note');
    expect(c.fields).toEqual([{ type: 0, name: 'Extra', value: 'extraval', linkedId: null }]);
    expect(payload.folders.map((f) => f.name)).toEqual(['Work']);
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('skips rows without a Title', () => {
    const csv = [
      'Group,Title,Username',
      'Work,,nobody',
    ].join('\n');
    expect(parseKeePassXCsv(csv).ciphers).toHaveLength(0);
  });
});

describe('parseKeePassCsv', () => {
  it('maps Account/Login Name/Password/Web Site/Comments', () => {
    const csv = [
      'Account,Login Name,Password,Web Site,Comments',
      'GitHub,octocat,hunter2,https://github.com,my note',
    ].join('\n');
    const c = parseKeePassCsv(csv).ciphers[0] as any;
    expect(c.name).toBe('GitHub');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.uris).toEqual([{ uri: 'https://github.com', match: null }]);
    expect(c.notes).toBe('my note');
  });

  it('skips rows without an Account', () => {
    const csv = [
      'Account,Password',
      ',pw',
    ].join('\n');
    expect(parseKeePassCsv(csv).ciphers).toHaveLength(0);
  });
});

describe('parseLastPassCsv', () => {
  it('parses a login row with totp, favorite, and folder', () => {
    const csv = [
      'url,username,password,totp,extra,name,grouping,fav',
      'https://github.com,octocat,hunter2,otp1,my note,GitHub,Work,1',
    ].join('\n');
    const payload = parseLastPassCsv(csv);
    const c = payload.ciphers[0] as any;
    expect(c.type).toBe(1);
    expect(c.name).toBe('GitHub');
    expect(c.favorite).toBe(true);
    expect(c.login.username).toBe('octocat');
    expect(c.login.totp).toBe('otp1');
    expect(c.login.uris).toEqual([{ uri: 'https://github.com', match: null }]);
    expect(payload.folders.map((f) => f.name)).toEqual(['Work']);
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('parses a secure note (url http://sn) into a type-2 cipher', () => {
    const csv = [
      'url,username,password,totp,extra,name,grouping,fav',
      'http://sn,,,,SSID: home,Wifi,Personal,0',
    ].join('\n');
    const payload = parseLastPassCsv(csv);
    const c = payload.ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.name).toBe('Wifi');
    expect(c.notes).toBe('SSID: home');
    expect(c.secureNote).toEqual({ type: 0 });
    expect(c.favorite).toBe(false);
    expect(payload.folders.map((f) => f.name)).toEqual(['Personal']);
  });
});

describe('parseDashlaneCsv', () => {
  it('parses a credentials export (first column "username") into a login', () => {
    const csv = [
      'username,title,password,otpUrl,otpSecret,url,note,category',
      'alice,My Login,pw,,otpsec,https://x.com,a note,Work',
    ].join('\n');
    const payload = parseDashlaneCsv(csv);
    const c = payload.ciphers[0] as any;
    expect(c.name).toBe('My Login');
    expect(c.login.username).toBe('alice');
    expect(c.login.totp).toBe('otpsec');
    expect(c.login.uris).toEqual([{ uri: 'https://x.com', match: null }]);
    expect(c.notes).toBe('a note');
    expect(payload.folders.map((f) => f.name)).toEqual(['Work']);
  });

  it('parses a secure-notes export (columns title,note) into a type-2 cipher', () => {
    const csv = [
      'title,note',
      'My Note,note body',
    ].join('\n');
    const c = parseDashlaneCsv(csv).ciphers[0] as any;
    expect(c.type).toBe(2);
    expect(c.name).toBe('My Note');
    expect(c.notes).toBe('note body');
    expect(c.secureNote).toEqual({ type: 0 });
  });

  it('ignores rows whose first column is neither username nor (title,note)', () => {
    const csv = [
      'something,else',
      'a,b',
    ].join('\n');
    expect(parseDashlaneCsv(csv).ciphers).toHaveLength(0);
  });
});

describe('parseDashlaneJson', () => {
  it('parses AUTHENTIFIANT array entries into login ciphers', () => {
    const json = JSON.stringify({
      AUTHENTIFIANT: [
        {
          title: 'GitHub',
          login: 'octocat',
          password: 'hunter2',
          domain: 'github.com',
          note: 'my note',
        },
      ],
    });
    const c = parseDashlaneJson(json).ciphers[0] as any;
    expect(c.name).toBe('GitHub');
    expect(c.login.username).toBe('octocat');
    expect(c.login.password).toBe('hunter2');
    expect(c.login.uris).toEqual([{ uri: 'http://github.com', match: null }]);
    expect(c.notes).toBe('my note');
  });

  it('falls back through secondaryLogin and email for the username', () => {
    const json = JSON.stringify({
      AUTHENTIFIANT: [
        { title: 'A', secondaryLogin: 'second@x.com', domain: 'a.com' },
        { title: 'B', email: 'b@x.com', domain: 'b.com' },
      ],
    });
    const ciphers = parseDashlaneJson(json).ciphers as any[];
    expect(ciphers[0].login.username).toBe('second@x.com');
    expect(ciphers[1].login.username).toBe('b@x.com');
  });

  it('skips non-object entries and returns empty when AUTHENTIFIANT is absent', () => {
    const json = JSON.stringify({ AUTHENTIFIANT: [null, 'string', 42] });
    expect(parseDashlaneJson(json).ciphers).toHaveLength(0);
    expect(parseDashlaneJson('{}').ciphers).toHaveLength(0);
  });

  it('handles missing domain (null uris)', () => {
    const json = JSON.stringify({ AUTHENTIFIANT: [{ title: 'NoDomain', login: 'x' }] });
    const c = parseDashlaneJson(json).ciphers[0] as any;
    expect(c.login.uris).toBeNull();
  });
});

describe('parseKeePassXml', () => {
  it('parses entries, nested groups into folders, totp, notes and custom fields', () => {
    const xml = `<?xml version="1.0"?>
<KeePassFile>
  <Root>
    <Group>
      <Name>RootGroup</Name>
      <Entry>
        <String><Key>Title</Key><Value>Top Entry</Value></String>
        <String><Key>UserName</Key><Value>alice</Value></String>
        <String><Key>Password</Key><Value Protected="True">pw</Value></String>
        <String><Key>URL</Key><Value>https://x.com</Value></String>
        <String><Key>otp</Key><Value>key=ABC123</Value></String>
        <String><Key>Notes</Key><Value>line one</Value></String>
        <String><Key>Custom</Key><Value Protected="True">secret</Value></String>
        <String><Key>Plain</Key><Value>visible</Value></String>
        <String><Key>Empty</Key><Value></Value></String>
      </Entry>
      <Group>
        <Name>Sub</Name>
        <Entry>
          <String><Key>Title</Key><Value>Child Entry</Value></String>
          <String><Key>UserName</Key><Value>bob</Value></String>
        </Entry>
      </Group>
    </Group>
  </Root>
</KeePassFile>`;
    const payload = parseKeePassXml(xml);
    expect(payload.ciphers).toHaveLength(2);
    const top = payload.ciphers[0] as any;
    expect(top.name).toBe('Top Entry');
    expect(top.login.username).toBe('alice');
    expect(top.login.password).toBe('pw');
    expect(top.login.totp).toBe('ABC123');
    expect(top.login.uris).toEqual([{ uri: 'https://x.com', match: null }]);
    expect(top.notes).toBe('line one');
    // Custom field marked Protected -> hidden type 1; Plain -> type 0; empty skipped
    expect(top.fields).toEqual([
      { type: 1, name: 'Custom', value: 'secret', linkedId: null },
      { type: 0, name: 'Plain', value: 'visible', linkedId: null },
    ]);

    // The matched rootGroup (RootGroup) is walked as isRoot -> not a folder and
    // not part of the prefix; only the nested "Sub" group becomes a folder.
    expect(payload.folders.map((f) => f.name)).toEqual(['Sub']);
    const child = payload.ciphers[1] as any;
    expect(child.name).toBe('Child Entry');
    // child filed under the "Sub" folder (index 0)
    expect(payload.folderRelationships).toContainEqual({ key: 1, value: 0 });
  });

  it('builds nested folder prefixes, dedupes repeated folders, and handles empty URL + ProtectInMemory fields', () => {
    const xml = `<?xml version="1.0"?>
<KeePassFile>
  <Root>
    <Group>
      <Name>Database</Name>
      <Group>
        <Name>Level1</Name>
        <Group>
          <Name>Level2</Name>
          <Entry>
            <String><Key>Title</Key><Value>A</Value></String>
            <String><Key>URL</Key><Value></Value></String>
            <String><Key>Hidden</Key><Value ProtectInMemory="true">h</Value></String>
          </Entry>
          <Entry>
            <String><Key>Title</Key><Value>B</Value></String>
          </Entry>
        </Group>
      </Group>
    </Group>
  </Root>
</KeePassFile>`;
    const payload = parseKeePassXml(xml);
    // rootGroup = Database (isRoot, excluded). Nested prefixes accumulate.
    expect(payload.folders.map((f) => f.name)).toEqual(['Level1', 'Level1/Level2']);
    const a = payload.ciphers[0] as any;
    // empty URL -> null uris
    expect(a.login.uris).toBeNull();
    // ProtectInMemory marks the custom field as hidden (type 1)
    expect(a.fields).toEqual([{ type: 1, name: 'Hidden', value: 'h', linkedId: null }]);
    // both entries in the same Level2 folder (the folder is reused, not duplicated)
    expect(payload.folderRelationships).toEqual([
      { key: 0, value: 1 },
      { key: 1, value: 1 },
    ]);
  });

  it('throws on invalid XML', () => {
    expect(() => parseKeePassXml('<not><closed>')).toThrow();
  });

  it('throws when the KeePass structure is missing', () => {
    const xml = '<?xml version="1.0"?><Something><Else/></Something>';
    expect(() => parseKeePassXml(xml)).toThrow('Invalid KeePass XML structure');
  });

  it('uses "-" as group name fallback and accumulates multiple Notes lines', () => {
    const xml = `<?xml version="1.0"?>
<KeePassFile>
  <Root>
    <Group>
      <Name>Outer</Name>
      <Group>
        <Entry>
          <String><Key>Title</Key><Value>E</Value></String>
          <String><Key>Notes</Key><Value>first</Value></String>
          <String><Key>Notes</Key><Value>second</Value></String>
        </Entry>
      </Group>
    </Group>
  </Root>
</KeePassFile>`;
    const payload = parseKeePassXml(xml);
    // Outer is the matched rootGroup (isRoot, not a folder); the unnamed nested
    // group falls back to "-" with no prefix.
    expect(payload.folders.map((f) => f.name)).toEqual(['-']);
    const c = payload.ciphers[0] as any;
    expect(c.notes).toBe('first\nsecond');
  });
});
