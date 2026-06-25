import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPublicSendUrl,
  deriveSendKeyParts,
  importCipherToDraft,
  looksLikeCipherString,
  parseSignalRTextFrames,
  readInviteCodeFromUrl,
  summarizeImportResult,
} from '@/lib/app-support';

const RS = String.fromCharCode(0x1e);

describe('looksLikeCipherString', () => {
  it('accepts a two-part type-2 cipher string', () => {
    expect(looksLikeCipherString('2.aGVsbG8=|d29ybGQ=')).toBe(true);
  });

  it('accepts a three-part cipher string (enc|iv|mac shape)', () => {
    expect(looksLikeCipherString('2.YWJj+/=|ZGVm/=|Z2hp+=')).toBe(true);
  });

  it('accepts a single-digit and multi-digit type prefix', () => {
    expect(looksLikeCipherString('0.abc=|def=')).toBe(true);
    expect(looksLikeCipherString('10.abc=|def=')).toBe(true);
  });

  it('trims surrounding whitespace before testing', () => {
    expect(looksLikeCipherString('  2.abc=|def=  ')).toBe(true);
  });

  it('rejects strings without a leading numeric type', () => {
    expect(looksLikeCipherString('x.abc=|def=')).toBe(false);
    expect(looksLikeCipherString('.abc=|def=')).toBe(false);
  });

  it('rejects strings without the pipe separator', () => {
    expect(looksLikeCipherString('2.abcdef')).toBe(false);
  });

  it('rejects strings with too many parts', () => {
    expect(looksLikeCipherString('2.a=|b=|c=|d=')).toBe(false);
  });

  it('rejects plain text and empty input', () => {
    expect(looksLikeCipherString('just a password')).toBe(false);
    expect(looksLikeCipherString('')).toBe(false);
  });

  it('coerces nullish input to empty and returns false', () => {
    // The function does String(value || '') so undefined/null become ''.
    expect(looksLikeCipherString(undefined as unknown as string)).toBe(false);
    expect(looksLikeCipherString(null as unknown as string)).toBe(false);
  });

  it('rejects characters outside the base64 alphabet inside parts', () => {
    expect(looksLikeCipherString('2.ab c=|def=')).toBe(false);
    expect(looksLikeCipherString('2.ab*c=|def=')).toBe(false);
  });
});

describe('readInviteCodeFromUrl', () => {
  const originalHref = window.location.href;

  function setUrl(url: string) {
    window.history.replaceState({}, '', url);
  }

  afterEach(() => {
    window.history.replaceState({}, '', originalHref);
  });

  it('reads the invite code from the search query', () => {
    setUrl('/?invite=ABC123');
    expect(readInviteCodeFromUrl()).toBe('ABC123');
  });

  it('trims whitespace around the search invite value', () => {
    setUrl('/?invite=' + encodeURIComponent('  spaced  '));
    expect(readInviteCodeFromUrl()).toBe('spaced');
  });

  it('reads the invite code from a hash query string', () => {
    setUrl('/#/register?invite=HASHCODE');
    expect(readInviteCodeFromUrl()).toBe('HASHCODE');
  });

  it('prefers the search query over the hash query', () => {
    setUrl('/?invite=FROMSEARCH#/x?invite=FROMHASH');
    expect(readInviteCodeFromUrl()).toBe('FROMSEARCH');
  });

  it('falls back to the hash when the search invite is blank', () => {
    setUrl('/?invite=%20%20#/x?invite=HASHWIN');
    expect(readInviteCodeFromUrl()).toBe('HASHWIN');
  });

  it('returns empty string when no invite is present', () => {
    setUrl('/?other=1');
    expect(readInviteCodeFromUrl()).toBe('');
  });

  it('returns empty string when the hash has no query part', () => {
    setUrl('/#/justaroute');
    expect(readInviteCodeFromUrl()).toBe('');
  });
});

describe('summarizeImportResult', () => {
  it('summarizes an empty import', () => {
    const summary = summarizeImportResult([], 0);
    expect(summary).toEqual({
      totalItems: 0,
      folderCount: 0,
      typeCounts: [],
      attachmentCount: 0,
      importedAttachmentCount: 0,
      failedAttachments: [],
    });
  });

  it('counts items by type and orders the standard types', () => {
    const summary = summarizeImportResult(
      [
        { type: 3 },
        { type: 1 },
        { type: 1 },
        { type: 2 },
        { type: 5 },
        { type: 4 },
      ],
      2
    );
    expect(summary.totalItems).toBe(6);
    expect(summary.folderCount).toBe(2);
    // Standard order is [1,2,3,4,5] regardless of input order.
    expect(summary.typeCounts.map((x) => x.count)).toEqual([2, 1, 1, 1, 1]);
    expect(summary.typeCounts.map((x) => x.label)).toEqual([
      'Login',
      'Secure Note',
      'Card',
      'Identity',
      'SSH Key',
    ]);
  });

  it('treats a missing or zero type as a Login (type 1)', () => {
    const summary = summarizeImportResult([{}, { type: 0 }, { name: 'x' }], 0);
    expect(summary.typeCounts).toEqual([{ label: 'Login', count: 3 }]);
  });

  it('appends unknown types after the standard ones, labelled Other', () => {
    const summary = summarizeImportResult([{ type: 1 }, { type: 99 }, { type: 99 }], 0);
    expect(summary.typeCounts).toEqual([
      { label: 'Login', count: 1 },
      { label: 'Other', count: 2 },
    ]);
  });

  it('clamps a negative folder count to zero', () => {
    expect(summarizeImportResult([], -5).folderCount).toBe(0);
  });

  it('includes attachment summary data and clamps negatives', () => {
    const summary = summarizeImportResult([{ type: 1 }], 1, {
      total: 5,
      imported: 3,
      failed: [{ fileName: 'a.txt', reason: 'too big' }],
    });
    expect(summary.attachmentCount).toBe(5);
    expect(summary.importedAttachmentCount).toBe(3);
    expect(summary.failedAttachments).toEqual([{ fileName: 'a.txt', reason: 'too big' }]);
  });

  it('defaults attachment fields when summary omitted', () => {
    const summary = summarizeImportResult([{ type: 1 }], 0);
    expect(summary.attachmentCount).toBe(0);
    expect(summary.importedAttachmentCount).toBe(0);
    expect(summary.failedAttachments).toEqual([]);
  });
});

describe('importCipherToDraft', () => {
  it('builds a login draft with uris, totp and dedupe', () => {
    const draft = importCipherToDraft(
      {
        type: 1,
        name: '  My Login  ',
        notes: 'a note',
        favorite: true,
        reprompt: 1,
        login: {
          username: 'bob',
          password: 'pw',
          totp: 'otpauth://x',
          uris: [
            { uri: 'https://a.com', match: 0, foo: 'bar' },
            { uri: 'HTTPS://A.COM', match: 'notnum' }, // duplicate (case-insensitive)
            { uri: '', match: 1 }, // empty, dropped
            { uri: 'https://b.com' },
          ],
          fido2Credentials: [{ credentialId: 'x' }, null, 'nope'],
        },
      },
      'folder-1'
    );
    expect(draft.type).toBe(1);
    expect(draft.name).toBe('My Login');
    expect(draft.notes).toBe('a note');
    expect(draft.favorite).toBe(true);
    expect(draft.reprompt).toBe(true);
    expect(draft.folderId).toBe('folder-1');
    expect(draft.loginUsername).toBe('bob');
    expect(draft.loginPassword).toBe('pw');
    expect(draft.loginTotp).toBe('otpauth://x');
    expect(draft.loginUris).toHaveLength(2);
    expect(draft.loginUris[0]).toMatchObject({
      uri: 'https://a.com',
      match: 0,
      originalUri: 'https://a.com',
    });
    expect((draft.loginUris[0] as { extra: Record<string, unknown> }).extra).toEqual({ foo: 'bar' });
    // Non-numeric match becomes null.
    expect(draft.loginUris[1].match).toBe(null);
    // Only object fido2 credentials survive.
    expect(draft.loginFido2Credentials).toEqual([{ credentialId: 'x' }]);
  });

  it('defaults the name to Untitled when blank', () => {
    const draft = importCipherToDraft({ type: 1, name: '   ' }, null);
    expect(draft.name).toBe('Untitled');
    expect(draft.folderId).toBe('');
  });

  it('provides a single empty uri row when there are no usable uris', () => {
    const draft = importCipherToDraft({ type: 1, login: { uris: [] } }, null);
    expect(draft.loginUris).toEqual([{ uri: '', match: null, originalUri: '', extra: {} }]);
  });

  it('promotes a TOTP-looking custom field into loginTotp and removes it', () => {
    const draft = importCipherToDraft(
      {
        type: 1,
        login: { username: 'u' },
        fields: [
          { name: 'Note', value: 'keep me', type: 0 },
          { name: 'TOTP', value: 'JBSWY3DPEHPK3PXP', type: 1 },
        ],
      },
      null
    );
    expect(draft.loginTotp).toBe('JBSWY3DPEHPK3PXP');
    expect(draft.customFields.map((f) => f.label)).toEqual(['Note']);
  });

  it('recognizes varied totp field name spellings', () => {
    const draft = importCipherToDraft(
      {
        type: 1,
        login: {},
        fields: [{ name: 'Two Factor', value: 'SECRET', type: 0 }],
      },
      null
    );
    expect(draft.loginTotp).toBe('SECRET');
    expect(draft.customFields).toHaveLength(0);
  });

  it('does not override an existing totp with a custom field', () => {
    const draft = importCipherToDraft(
      {
        type: 1,
        login: { totp: 'real' },
        fields: [{ name: 'otp', value: 'fromfield', type: 0 }],
      },
      null
    );
    expect(draft.loginTotp).toBe('real');
    expect(draft.customFields.map((f) => f.label)).toEqual(['otp']);
  });

  it('maps custom field types, dropping unlabeled fields', () => {
    const draft = importCipherToDraft(
      {
        type: 2,
        fields: [
          { name: 'Hidden', value: 'h', type: 1 },
          { name: 'Bool', value: 'true', type: 2 },
          { name: 'Linked', value: 'l', type: 3 },
          { name: 'Text', value: 't', type: 0 },
          { name: 'Weird', value: 'w', type: 99 }, // out of range -> 0
          { name: '   ', value: 'noLabel' }, // dropped
          null, // dropped
        ],
      },
      null
    );
    expect(draft.customFields).toEqual([
      { type: 1, label: 'Hidden', value: 'h' },
      { type: 2, label: 'Bool', value: 'true' },
      { type: 3, label: 'Linked', value: 'l' },
      { type: 0, label: 'Text', value: 't' },
      { type: 0, label: 'Weird', value: 'w' },
    ]);
  });

  it('maps a card cipher', () => {
    const draft = importCipherToDraft(
      {
        type: 3,
        card: {
          cardholderName: 'Jane',
          number: '4111111111111111',
          brand: 'Visa',
          expMonth: '12',
          expYear: '2030',
          code: '123',
        },
      },
      null
    );
    expect(draft).toMatchObject({
      type: 3,
      cardholderName: 'Jane',
      cardNumber: '4111111111111111',
      cardBrand: 'Visa',
      cardExpMonth: '12',
      cardExpYear: '2030',
      cardCode: '123',
    });
  });

  it('maps an identity cipher', () => {
    const draft = importCipherToDraft(
      {
        type: 4,
        identity: {
          title: 'Mr',
          firstName: 'John',
          lastName: 'Doe',
          email: 'j@d.com',
          city: 'Town',
          country: 'US',
        },
      },
      null
    );
    expect(draft.identTitle).toBe('Mr');
    expect(draft.identFirstName).toBe('John');
    expect(draft.identLastName).toBe('Doe');
    expect(draft.identEmail).toBe('j@d.com');
    expect(draft.identCity).toBe('Town');
    expect(draft.identCountry).toBe('US');
  });

  it('maps an ssh key cipher and falls back fingerprint -> keyFingerprint', () => {
    const withKeyFingerprint = importCipherToDraft(
      {
        type: 5,
        sshKey: { privateKey: 'priv', publicKey: 'pub', keyFingerprint: 'fp1' },
      },
      null
    );
    expect(withKeyFingerprint.sshPrivateKey).toBe('priv');
    expect(withKeyFingerprint.sshPublicKey).toBe('pub');
    expect(withKeyFingerprint.sshFingerprint).toBe('fp1');

    const withFingerprint = importCipherToDraft(
      { type: 5, sshKey: { fingerprint: 'fp2' } },
      null
    );
    expect(withFingerprint.sshFingerprint).toBe('fp2');
  });

  it('handles a minimal/empty cipher object', () => {
    const draft = importCipherToDraft({}, null);
    expect(draft.type).toBe(1);
    expect(draft.name).toBe('Untitled');
    expect(draft.loginUris).toEqual([{ uri: '', match: null, originalUri: '', extra: {} }]);
    expect(draft.customFields).toEqual([]);
  });
});

describe('buildPublicSendUrl', () => {
  it('constructs the hash-routed public send url', () => {
    expect(buildPublicSendUrl('https://vault.example.com', 'access123', 'keyABC')).toBe(
      'https://vault.example.com/#/send/access123/keyABC'
    );
  });

  it('handles empty parts without throwing', () => {
    expect(buildPublicSendUrl('', '', '')).toBe('/#/send//');
  });
});

describe('parseSignalRTextFrames', () => {
  it('parses multiple record-separated JSON frames', () => {
    const raw =
      JSON.stringify({ type: 1, target: 'Sync', arguments: [] }) +
      RS +
      JSON.stringify({ type: 6 }) +
      RS;
    const frames = parseSignalRTextFrames(raw);
    expect(frames).toHaveLength(2);
    expect(frames[0].target).toBe('Sync');
    expect(frames[1].type).toBe(6);
  });

  it('ignores blank frames and trims whitespace', () => {
    const raw = '  ' + RS + RS + JSON.stringify({ type: 1 }) + RS + '   ';
    expect(parseSignalRTextFrames(raw)).toHaveLength(1);
  });

  it('drops frames that are not valid JSON', () => {
    const raw = '{not json}' + RS + JSON.stringify({ type: 1 });
    const frames = parseSignalRTextFrames(raw);
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(1);
  });

  it('returns an empty array for empty input', () => {
    expect(parseSignalRTextFrames('')).toEqual([]);
  });

  it('parses a single frame without a trailing separator', () => {
    expect(parseSignalRTextFrames(JSON.stringify({ type: 1 }))).toHaveLength(1);
  });
});

describe('deriveSendKeyParts', () => {
  it('splits a 64-byte key directly into enc and mac halves', async () => {
    const material = new Uint8Array(64);
    for (let i = 0; i < 64; i++) material[i] = i;
    const { enc, mac } = await deriveSendKeyParts(material);
    expect(enc).toHaveLength(32);
    expect(mac).toHaveLength(32);
    expect(Array.from(enc)).toEqual(Array.from(material.slice(0, 32)));
    expect(Array.from(mac)).toEqual(Array.from(material.slice(32, 64)));
  });

  it('splits keys longer than 64 bytes by taking the first 64', async () => {
    const material = new Uint8Array(100);
    for (let i = 0; i < 100; i++) material[i] = i % 256;
    const { enc, mac } = await deriveSendKeyParts(material);
    expect(Array.from(enc)).toEqual(Array.from(material.slice(0, 32)));
    expect(Array.from(mac)).toEqual(Array.from(material.slice(32, 64)));
  });

  it('derives a deterministic 64-byte key via HKDF for short material', async () => {
    const material = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const a = await deriveSendKeyParts(material);
    const b = await deriveSendKeyParts(material);
    expect(a.enc).toHaveLength(32);
    expect(a.mac).toHaveLength(32);
    expect(Array.from(a.enc)).toEqual(Array.from(b.enc));
    expect(Array.from(a.mac)).toEqual(Array.from(b.mac));
    // enc and mac halves should differ.
    expect(Array.from(a.enc)).not.toEqual(Array.from(a.mac));
  });

  it('produces different derived keys for different short material', async () => {
    const a = await deriveSendKeyParts(new Uint8Array([1, 2, 3]));
    const b = await deriveSendKeyParts(new Uint8Array([4, 5, 6]));
    expect(Array.from(a.enc)).not.toEqual(Array.from(b.enc));
  });
});
