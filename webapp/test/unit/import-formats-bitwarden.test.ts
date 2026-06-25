import { describe, expect, it } from 'vitest';
import {
  normalizeBitwardenImport,
  normalizeBitwardenEncryptedAccountImport,
  type BitwardenJsonInput,
} from '@/lib/import-formats-bitwarden';

// A realistic, unencrypted Bitwarden personal-account JSON export covering
// folders, a login (with uris/totp/fido2/password history), a card, an
// identity, a secure note, and custom fields.
function fullExport(): BitwardenJsonInput {
  return {
    encrypted: false,
    folders: [
      { id: 'folder-work', name: 'Work' },
      { id: 'folder-personal', name: 'Personal' },
      { id: 'folder-empty', name: '   ' }, // blank name -> dropped
    ],
    items: [
      {
        id: 'login-1',
        type: 1,
        name: 'GitHub',
        notes: 'my note',
        favorite: true,
        reprompt: 1,
        folderId: 'folder-work',
        login: {
          username: 'octocat',
          password: 'hunter2',
          totp: 'JBSWY3DPEHPK3PXP',
          fido2Credentials: [{ credentialId: 'abc', userName: 'octocat' }],
          uris: [
            { uri: 'https://github.com', match: 0 },
            { uri: 'https://gist.github.com', match: null },
          ],
        },
        fields: [
          { name: 'Recovery', value: 'code-123', type: 0, linkedId: null },
          { name: 'Secret', value: 'hidden', type: 1 },
        ],
        passwordHistory: [
          { password: 'old1', lastUsedDate: '2024-01-01T00:00:00Z' },
          { password: null, lastUsedDate: '2024-02-01T00:00:00Z' }, // filtered out
        ],
      },
      {
        id: 'card-1',
        type: 3,
        name: 'My Visa',
        folderId: 'folder-personal',
        card: {
          cardholderName: 'Alice A',
          number: '4111111111111111',
          brand: 'Visa',
          expMonth: '12',
          expYear: '2030',
          code: '123',
        },
      },
      {
        id: 'identity-1',
        type: 4,
        name: 'My Identity',
        identity: {
          title: 'Ms',
          firstName: 'Alice',
          lastName: 'Anderson',
          email: 'alice@example.com',
        },
      },
      {
        id: 'note-1',
        type: 2,
        name: 'Wifi',
        notes: 'SSID: home',
        secureNote: { type: 0 },
      },
    ],
  };
}

describe('normalizeBitwardenImport', () => {
  it('parses a full export into a CiphersImportPayload', () => {
    const payload = normalizeBitwardenImport(fullExport());

    // Blank-named folder is dropped; only two real folders survive.
    expect(payload.folders).toEqual([{ name: 'Work' }, { name: 'Personal' }]);
    expect(payload.ciphers).toHaveLength(4);
  });

  it('maps login fields, uris, fido2, fields and filtered password history', () => {
    const payload = normalizeBitwardenImport(fullExport());
    const login = payload.ciphers[0] as any;

    expect(login.id).toBe('login-1');
    expect(login.type).toBe(1);
    expect(login.name).toBe('GitHub');
    expect(login.notes).toBe('my note');
    expect(login.favorite).toBe(true);
    expect(login.reprompt).toBe(1);

    expect(login.login.username).toBe('octocat');
    expect(login.login.password).toBe('hunter2');
    expect(login.login.totp).toBe('JBSWY3DPEHPK3PXP');
    expect(login.login.fido2Credentials).toEqual([{ credentialId: 'abc', userName: 'octocat' }]);
    expect(login.login.uris).toEqual([
      { uri: 'https://github.com', match: 0 },
      { uri: 'https://gist.github.com', match: null },
    ]);

    expect(login.fields).toEqual([
      { name: 'Recovery', value: 'code-123', type: 0, linkedId: null },
      { name: 'Secret', value: 'hidden', type: 1, linkedId: null },
    ]);

    // Entry with null password is filtered out of passwordHistory.
    expect(login.passwordHistory).toEqual([
      { password: 'old1', lastUsedDate: '2024-01-01T00:00:00Z' },
    ]);
  });

  it('passes card, identity and secureNote through unchanged', () => {
    const payload = normalizeBitwardenImport(fullExport());
    const card = payload.ciphers[1] as any;
    const identity = payload.ciphers[2] as any;
    const note = payload.ciphers[3] as any;

    expect(card.type).toBe(3);
    expect(card.card.number).toBe('4111111111111111');
    expect(card.login).toBeNull();

    expect(identity.type).toBe(4);
    expect(identity.identity.email).toBe('alice@example.com');

    expect(note.type).toBe(2);
    expect(note.secureNote).toEqual({ type: 0 });
  });

  it('builds folderRelationships only for resolvable folder ids', () => {
    const payload = normalizeBitwardenImport(fullExport());
    // login-1 -> Work (index 0); card-1 -> Personal (index 1).
    // identity-1 and note-1 have no folderId.
    expect(payload.folderRelationships).toEqual([
      { key: 0, value: 0 },
      { key: 1, value: 1 },
    ]);
  });

  it('ignores folder links that reference an unknown folder id', () => {
    // Two folders so the "sole folder auto-file" branch does not apply.
    const payload = normalizeBitwardenImport({
      folders: [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ],
      items: [{ type: 1, name: 'X', folderId: 'does-not-exist' }],
    });
    expect(payload.folderRelationships).toEqual([]);
  });

  it('auto-files every cipher into a sole folder when no explicit links exist', () => {
    const payload = normalizeBitwardenImport({
      folders: [{ id: 'only', name: 'Only' }],
      items: [
        { type: 1, name: 'A' },
        { type: 1, name: 'B' },
      ],
    });
    expect(payload.folderRelationships).toEqual([
      { key: 0, value: 0 },
      { key: 1, value: 0 },
    ]);
  });

  it('does NOT auto-file when an explicit link already exists', () => {
    const payload = normalizeBitwardenImport({
      folders: [{ id: 'only', name: 'Only' }],
      items: [
        { type: 1, name: 'A', folderId: 'only' },
        { type: 1, name: 'B' },
      ],
    });
    // Only the explicit link is present; B is not auto-filed.
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 0 }]);
  });

  it('applies defaults for missing fields', () => {
    const payload = normalizeBitwardenImport({ items: [{}] });
    const cipher = payload.ciphers[0] as any;
    expect(cipher.id).toBeNull();
    expect(cipher.type).toBe(1);
    expect(cipher.name).toBe('Untitled');
    expect(cipher.notes).toBeNull();
    expect(cipher.favorite).toBe(false);
    expect(cipher.reprompt).toBe(0);
    expect(cipher.login).toBeNull();
    expect(cipher.fields).toBeNull();
    expect(cipher.passwordHistory).toBeNull();
  });

  it('handles a login with non-array uris/fido2 by emitting null', () => {
    const payload = normalizeBitwardenImport({
      items: [{ type: 1, name: 'X', login: { username: 'u' } }],
    });
    const cipher = payload.ciphers[0] as any;
    expect(cipher.login.uris).toBeNull();
    expect(cipher.login.fido2Credentials).toBeNull();
    expect(cipher.login.username).toBe('u');
  });

  it('tolerates missing folders/items arrays', () => {
    const payload = normalizeBitwardenImport({});
    expect(payload).toEqual({ ciphers: [], folders: [], folderRelationships: [] });
  });

  it('throws on a non-object input', () => {
    expect(() => normalizeBitwardenImport(null)).toThrow('Invalid Bitwarden JSON');
    expect(() => normalizeBitwardenImport('nope')).toThrow('Invalid Bitwarden JSON');
  });

  it('throws when the export is marked encrypted', () => {
    expect(() => normalizeBitwardenImport({ encrypted: true })).toThrow(
      'Encrypted export requires encrypted import flow.'
    );
  });

  it('coerces non-numeric type/reprompt back to defaults', () => {
    const payload = normalizeBitwardenImport({
      items: [{ type: 0 as any, name: 'Z', reprompt: 'x' as any }],
    });
    const cipher = payload.ciphers[0] as any;
    expect(cipher.type).toBe(1); // Number(0||1)||1
    expect(cipher.reprompt).toBe(0); // Number('x'??0)||0 -> NaN -> 0
  });
});

describe('normalizeBitwardenEncryptedAccountImport', () => {
  it('passes through items verbatim and maps legacy folder ids', () => {
    const payload = normalizeBitwardenEncryptedAccountImport({
      folders: [
        { id: 'f1', name: '2.encName1==' },
        { id: 'f2', name: '2.encName2==' },
      ],
      items: [
        { id: 'i1', name: '2.encItem1==', folderId: 'f2' },
        { id: 'i2', name: '2.encItem2==' },
      ],
    });
    expect(payload.folders).toEqual([{ name: '2.encName1==' }, { name: '2.encName2==' }]);
    // i1 -> folder index 1 (f2); i2 unlinked.
    expect(payload.folderRelationships).toEqual([{ key: 0, value: 1 }]);
    // Items are spread through unchanged.
    expect((payload.ciphers[0] as any).name).toBe('2.encItem1==');
    expect((payload.ciphers[0] as any).id).toBe('i1');
  });

  it('throws for an encrypted organization export (collections, no folders)', () => {
    expect(() =>
      normalizeBitwardenEncryptedAccountImport({
        collections: [{ id: 'c1', name: 'Coll' }],
        items: [],
      })
    ).toThrow('Encrypted organization export is not supported yet.');
  });

  it('tolerates missing folder name as empty string', () => {
    const payload = normalizeBitwardenEncryptedAccountImport({
      folders: [{ id: 'f1' }],
      items: [],
    });
    expect(payload.folders).toEqual([{ name: '' }]);
  });
});
