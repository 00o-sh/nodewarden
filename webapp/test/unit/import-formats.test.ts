import { describe, expect, it } from 'vitest';
import { parseImportPayloadBySource } from '@/lib/import-formats';
import { parseBitwardenCsv, parseChromeCsv } from '@/lib/import-formats-browser';
import {
  cardBrand,
  parseCardExpiry,
  parseCsv,
  parseSerializedUris,
  splitFullName,
} from '@/lib/import-format-shared';

describe('parseCsv', () => {
  it('parses headers and rows, handling quotes and escaped quotes', () => {
    const rows = parseCsv('name,note\n"Acme, Inc.","say ""hi"""\nFoo,bar');
    expect(rows).toEqual([
      { name: 'Acme, Inc.', note: 'say "hi"' },
      { name: 'Foo', note: 'bar' },
    ]);
  });

  it('strips a leading UTF-8 BOM from the first header', () => {
    const rows = parseCsv('﻿name,value\nA,1');
    expect(rows[0]).toEqual({ name: 'A', value: '1' });
  });

  it('returns an empty array for blank input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseChromeCsv', () => {
  it('maps Chrome export columns onto login ciphers', () => {
    const csv = 'name,url,username,password\nExample,https://example.com,alice,s3cret';
    const payload = parseChromeCsv(csv);
    expect(payload.ciphers).toHaveLength(1);
    const cipher = payload.ciphers[0] as any;
    expect(cipher.type).toBe(1);
    expect(cipher.name).toBe('Example');
    expect(cipher.login.username).toBe('alice');
    expect(cipher.login.password).toBe('s3cret');
    expect(cipher.login.uris).toEqual([{ uri: 'https://example.com', match: null }]);
  });

  it('rewrites android:// urls into androidapp:// uris', () => {
    const csv = 'name,url,username,password\n,android://hash@com.example.app/,bob,pw';
    const cipher = parseChromeCsv(csv).ciphers[0] as any;
    expect(cipher.login.uris).toEqual([{ uri: 'androidapp://com.example.app', match: null }]);
  });
});

describe('parseBitwardenCsv', () => {
  it('parses logins and secure notes with folders', () => {
    const csv = [
      'folder,favorite,type,name,notes,login_uri,login_username,login_password,login_totp',
      'Work,1,login,GitHub,my note,https://github.com,octocat,hunter2,',
      'Personal,0,note,Wifi,SSID: home,,,,',
    ].join('\n');
    const payload = parseBitwardenCsv(csv);
    expect(payload.ciphers).toHaveLength(2);

    const login = payload.ciphers[0] as any;
    expect(login.type).toBe(1);
    expect(login.name).toBe('GitHub');
    expect(login.favorite).toBe(true);
    expect(login.login.username).toBe('octocat');
    expect(login.login.uris).toEqual([{ uri: 'https://github.com', match: null }]);

    const note = payload.ciphers[1] as any;
    expect(note.type).toBe(2);
    expect(note.secureNote).toEqual({ type: 0 });

    // Both ciphers were filed under distinct folders.
    expect(payload.folders.map((f) => f.name)).toEqual(['Work', 'Personal']);
    expect(payload.folderRelationships).toEqual([
      { key: 0, value: 0 },
      { key: 1, value: 1 },
    ]);
  });
});

describe('parseImportPayloadBySource dispatcher', () => {
  it('routes a source id to its parser', () => {
    const payload = parseImportPayloadBySource(
      'chrome',
      'name,url,username,password\nX,https://x.test,u,p'
    );
    expect((payload.ciphers[0] as any).name).toBe('X');
  });

  it('throws for sources handled by dedicated flows', () => {
    expect(() => parseImportPayloadBySource('bitwarden_json', '{}')).toThrow();
  });
});

describe('import helpers', () => {
  it('cardBrand detects major networks by prefix', () => {
    expect(cardBrand('4111 1111 1111 1111')).toBe('Visa');
    expect(cardBrand('5500000000000004')).toBe('Mastercard');
    expect(cardBrand('340000000000009')).toBe('Amex');
    expect(cardBrand('6011000000000004')).toBe('Discover');
    expect(cardBrand('')).toBeNull();
  });

  it('parseCardExpiry understands several formats', () => {
    expect(parseCardExpiry('12/2027')).toEqual({ month: '12', year: '2027' });
    expect(parseCardExpiry('03/27')).toEqual({ month: '3', year: '2027' });
    expect(parseCardExpiry('202705')).toEqual({ month: '5', year: '2027' });
    expect(parseCardExpiry('')).toEqual({ month: null, year: null });
  });

  it('splitFullName splits first/middle/last', () => {
    expect(splitFullName('Ada Lovelace')).toEqual({
      firstName: 'Ada',
      middleName: null,
      lastName: 'Lovelace',
    });
    expect(splitFullName('John Fitzgerald Kennedy')).toEqual({
      firstName: 'John',
      middleName: 'Fitzgerald',
      lastName: 'Kennedy',
    });
  });

  it('parseSerializedUris dedupes and normalises', () => {
    expect(parseSerializedUris('example.com\nhttps://example.com')).toEqual([
      'http://example.com',
      'https://example.com',
    ]);
  });
});
