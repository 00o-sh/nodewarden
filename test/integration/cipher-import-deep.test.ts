import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, enc, sync } from './helpers';

// Deep Bitwarden import: every cipher type with nested structures, multiple
// folders, and folder relationships. Exercises the import normalization branches.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('importdeep');
  token = session.accessToken;
});

function deepPayload() {
  return {
    folders: [{ name: enc('work') }, { name: enc('home') }],
    ciphers: [
      {
        type: 1,
        name: enc('login'),
        login: {
          username: enc('u'),
          password: enc('p'),
          totp: enc('totp'),
          uris: [{ uri: enc('https'), match: 0 }, { uri: enc('http'), match: null }],
        },
        fields: [{ name: enc('field'), value: enc('val'), type: 0 }],
        passwordHistory: [{ password: enc('old'), lastUsedDate: new Date().toISOString() }],
      },
      { type: 2, name: enc('note'), secureNote: { type: 0 }, notes: enc('text') },
      { type: 3, name: enc('card'), card: { number: enc('4111'), code: enc('123') } },
      { type: 4, name: enc('id'), identity: { firstName: enc('a'), lastName: enc('b') } },
      { type: 5, name: enc('ssh'), sshKey: { privateKey: enc('priv'), publicKey: enc('pub'), keyFingerprint: enc('fp') } },
    ],
    folderRelationships: [{ key: 0, value: 0 }, { key: 2, value: 1 }],
  };
}

describe('deep import', () => {
  it('imports all cipher types with folders and returns a cipher map', async () => {
    const res = await api('POST', '/api/ciphers/import?returnCipherMap=1', token, deepPayload());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('import-result');
    expect(body.cipherMap).toHaveLength(5);
  });

  it('reflects the imported data and folder assignments in sync', async () => {
    const vault = (await (await sync(token)).json()) as any;
    expect(vault.folders.length).toBeGreaterThanOrEqual(2);
    expect(vault.ciphers.length).toBeGreaterThanOrEqual(5);
    // Two ciphers were filed into folders via relationships.
    const filed = vault.ciphers.filter((c: any) => c.folderId);
    expect(filed.length).toBeGreaterThanOrEqual(2);
    // All five types are present.
    const types = new Set(vault.ciphers.map((c: any) => c.type));
    for (const t of [1, 2, 3, 4, 5]) expect(types).toContain(t);
  });
});
