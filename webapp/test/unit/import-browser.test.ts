import { describe, expect, it } from 'vitest';
import {
  parseAvastCsv,
  parseAvastJson,
  parseAviraCsv,
  parseBitwardenCsv,
  parseChromeCsv,
  parseFirefoxCsv,
  parseSafariCsv,
} from '@/lib/import-formats-browser';

describe('parseChromeCsv (extra branches)', () => {
  it('falls back to "--" name when name and android match are absent', () => {
    const csv = 'name,url,username,password,note\n,,bob,pw,hi';
    const cipher = parseChromeCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('--');
    expect(cipher.notes).toBe('hi');
    expect(cipher.login.uris).toBeNull();
  });

  it('uses the android package id as the name when name is blank', () => {
    const csv = 'name,url,username,password\n,android://hash@com.example.app/,bob,pw';
    const cipher = parseChromeCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('com.example.app');
  });
});

describe('parseFirefoxCsv', () => {
  it('maps url/username/password and derives a name from the host', () => {
    const csv = 'url,username,password\nhttps://www.example.com,alice,s3cret';
    const payload = parseFirefoxCsv(csv);
    expect(payload.ciphers).toHaveLength(1);
    const cipher = payload.ciphers[0] as any;
    expect(cipher.name).toBe('example.com');
    expect(cipher.login.username).toBe('alice');
    expect(cipher.login.password).toBe('s3cret');
    expect(cipher.login.uris).toEqual([{ uri: 'https://www.example.com', match: null }]);
  });

  it('skips the synthetic chrome://FirefoxAccounts row', () => {
    const csv = 'url,username,password\nchrome://FirefoxAccounts,x,y\nhttps://a.test,u,p';
    const payload = parseFirefoxCsv(csv);
    expect(payload.ciphers).toHaveLength(1);
    expect((payload.ciphers[0] as any).login.username).toBe('u');
  });

  it('falls back to hostname column and to "--" name when host cannot be derived', () => {
    const csv = 'url,hostname,username,password\n,,bob,pw';
    const cipher = parseFirefoxCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('--');
    expect(cipher.login.uris).toBeNull();
  });
});

describe('parseSafariCsv', () => {
  it('maps Title/Username/Password/Url/OTPAuth/Notes', () => {
    const csv =
      'Title,Url,Username,Password,Notes,OTPAuth\nExample,https://example.com,alice,pw,my note,otpauth://totp/x';
    const cipher = parseSafariCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('Example');
    expect(cipher.login.username).toBe('alice');
    expect(cipher.login.password).toBe('pw');
    expect(cipher.login.uris).toEqual([{ uri: 'https://example.com', match: null }]);
    expect(cipher.login.totp).toBe('otpauth://totp/x');
    expect(cipher.notes).toBe('my note');
  });

  it('accepts the URL column variant and defaults name to "--"', () => {
    const csv = 'Title,URL,Username,Password\n,https://a.test,u,p';
    const cipher = parseSafariCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('--');
    expect(cipher.login.uris).toEqual([{ uri: 'https://a.test', match: null }]);
  });
});

describe('parseAviraCsv', () => {
  it('maps name/website/username/password', () => {
    const csv = 'name,website,username,password\nExample,https://example.com,alice,pw';
    const cipher = parseAviraCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('Example');
    expect(cipher.login.username).toBe('alice');
    expect(cipher.login.password).toBe('pw');
    expect(cipher.login.uris).toEqual([{ uri: 'https://example.com', match: null }]);
  });

  it('derives the name from the website when name is blank', () => {
    const csv = 'name,website,username,password\n,https://www.example.com,alice,pw';
    const cipher = parseAviraCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('example.com');
  });

  it('uses secondary_username as the username when primary is empty', () => {
    const csv = 'name,website,username,secondary_username,password\nX,https://x.test,,backup,pw';
    const cipher = parseAviraCsv(csv).ciphers[0] as any;
    expect(cipher.login.username).toBe('backup');
    expect(cipher.notes).toBeNull();
  });

  it('puts secondary_username in notes when a primary username exists', () => {
    const csv = 'name,website,username,secondary_username,password\nX,https://x.test,alice,backup,pw';
    const cipher = parseAviraCsv(csv).ciphers[0] as any;
    expect(cipher.login.username).toBe('alice');
    expect(cipher.notes).toBe('backup');
  });
});

describe('parseAvastCsv', () => {
  it('maps name/web/login/password', () => {
    const csv = 'name,web,login,password\nExample,https://example.com,alice,pw';
    const cipher = parseAvastCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('Example');
    expect(cipher.login.username).toBe('alice');
    expect(cipher.login.password).toBe('pw');
    expect(cipher.login.uris).toEqual([{ uri: 'https://example.com', match: null }]);
  });

  it('sets uris to null when web is blank and defaults name to "--"', () => {
    const csv = 'name,web,login,password\n,,alice,pw';
    const cipher = parseAvastCsv(csv).ciphers[0] as any;
    expect(cipher.name).toBe('--');
    expect(cipher.login.uris).toBeNull();
  });
});

describe('parseAvastJson', () => {
  it('maps logins, notes, and cards', () => {
    const json = JSON.stringify({
      logins: [
        { custName: 'Example', note: 'a note', url: 'https://example.com', pwd: 'pw', loginName: 'alice' },
      ],
      notes: [{ label: 'My Note', text: 'secret text' }],
      cards: [
        {
          custName: 'My Card',
          note: 'card note',
          holderName: 'Alice A',
          cardNumber: '4111111111111111',
          cvv: '123',
          expirationDate: { month: '12', year: '2030' },
        },
      ],
    });
    const payload = parseAvastJson(json);
    expect(payload.ciphers).toHaveLength(3);

    const login = payload.ciphers[0] as any;
    expect(login.type).toBe(1);
    expect(login.name).toBe('Example');
    expect(login.notes).toBe('a note');
    expect(login.login.username).toBe('alice');
    expect(login.login.password).toBe('pw');
    expect(login.login.uris).toEqual([{ uri: 'https://example.com', match: null }]);

    const note = payload.ciphers[1] as any;
    expect(note.type).toBe(2);
    expect(note.name).toBe('My Note');
    expect(note.notes).toBe('secret text');
    expect(note.secureNote).toEqual({ type: 0 });

    const card = payload.ciphers[2] as any;
    expect(card.type).toBe(3);
    expect(card.name).toBe('My Card');
    expect(card.card.cardholderName).toBe('Alice A');
    expect(card.card.number).toBe('4111111111111111');
    expect(card.card.code).toBe('123');
    expect(card.card.brand).toBe('Visa');
    expect(card.card.expMonth).toBe('12');
    expect(card.card.expYear).toBe('2030');
  });

  it('handles missing sections and missing fields gracefully', () => {
    const payload = parseAvastJson('{}');
    expect(payload.ciphers).toEqual([]);

    const partial = parseAvastJson(JSON.stringify({ logins: [{}], cards: [{}] }));
    const login = partial.ciphers[0] as any;
    expect(login.name).toBe('--');
    expect(login.login.uris).toBeNull();
    const card = partial.ciphers[1] as any;
    expect(card.name).toBe('--');
    expect(card.card.number).toBeNull();
    expect(card.card.brand).toBeNull();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAvastJson('not json')).toThrow();
  });
});

describe('parseBitwardenCsv (extra branches)', () => {
  it('falls back to non-prefixed username/password/totp/uri columns', () => {
    const csv = [
      'type,name,username,password,totp,uri',
      'login,Example,alice,pw,JBSWY3DPEHPK3PXP,https://example.com',
    ].join('\n');
    const cipher = parseBitwardenCsv(csv).ciphers[0] as any;
    expect(cipher.login.username).toBe('alice');
    expect(cipher.login.password).toBe('pw');
    expect(cipher.login.totp).toBe('JBSWY3DPEHPK3PXP');
    expect(cipher.login.uris).toEqual([{ uri: 'https://example.com', match: null }]);
  });

  it('applies custom fields parsed from the fields column', () => {
    const csv = ['type,name,fields', 'login,Example,"PIN: 1234\nSecret: shh"'].join('\n');
    const cipher = parseBitwardenCsv(csv).ciphers[0] as any;
    expect(cipher.fields).toEqual([
      { type: 0, name: 'PIN', value: '1234', linkedId: null },
      { type: 0, name: 'Secret', value: 'shh', linkedId: null },
    ]);
  });

  it('treats rows without a type column as logins', () => {
    const csv = ['name,login_username,login_password', 'Example,alice,pw'].join('\n');
    const cipher = parseBitwardenCsv(csv).ciphers[0] as any;
    expect(cipher.type).toBe(1);
    expect(cipher.login.username).toBe('alice');
  });

  it('handles secure note rows including custom fields and folders', () => {
    const csv = [
      'folder,type,name,notes,fields',
      'Personal,securenote,Wifi,SSID details,"Key: abc"',
    ].join('\n');
    const payload = parseBitwardenCsv(csv);
    const note = payload.ciphers[0] as any;
    expect(note.type).toBe(2);
    expect(note.name).toBe('Wifi');
    expect(note.secureNote).toEqual({ type: 0 });
    expect(note.fields).toEqual([{ type: 0, name: 'Key', value: 'abc', linkedId: null }]);
    expect(payload.folders).toEqual([{ name: 'Personal' }]);
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });
});
