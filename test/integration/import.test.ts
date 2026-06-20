import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, enc, sync } from './helpers';

// Tier 5: Bitwarden import fidelity. A client import payload (folders + ciphers
// + folderRelationships) must land intact and be reflected in the next sync.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('import');
  token = session.accessToken;
});

function importPayload() {
  return {
    folders: [{ name: enc('work') }, { name: enc('personal') }],
    ciphers: [
      { type: 1, name: enc('gmail'), login: { username: enc('u1'), password: enc('p1') } },
      { type: 1, name: enc('github'), login: { username: enc('u2'), password: enc('p2') } },
      { type: 2, name: enc('note'), secureNote: { type: 0 } },
    ],
    // Put the first cipher in the first folder.
    folderRelationships: [{ key: 0, value: 0 }],
  };
}

describe('Bitwarden import', () => {
  it('imports folders and ciphers and reflects them in sync', async () => {
    const res = await api('POST', '/api/ciphers/import', token, importPayload());
    expect(res.status).toBe(200);

    const vault = (await (await sync(token)).json()) as any;
    expect(vault.folders).toHaveLength(2);
    expect(vault.ciphers).toHaveLength(3);

    // The folder relationship is preserved: exactly one cipher is filed under a folder.
    const folderIds = new Set(vault.folders.map((f: any) => f.id));
    const filed = vault.ciphers.filter((c: any) => c.folderId && folderIds.has(c.folderId));
    expect(filed).toHaveLength(1);

    // Cipher names survive the round-trip.
    const names = vault.ciphers.map((c: any) => c.name).sort();
    expect(names).toEqual([enc('github'), enc('gmail'), enc('note')].sort());
  });

  it('returns a cipher map when requested', async () => {
    const res = await api(
      'POST',
      '/api/ciphers/import?returnCipherMap=1',
      token,
      { folders: [], ciphers: [{ type: 1, name: ENC_STRING }], folderRelationships: [] }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe('import-result');
    expect(body.cipherMap).toHaveLength(1);
    expect(typeof body.cipherMap[0].id).toBe('string');
  });

  it('rejects an invalid JSON body (400)', async () => {
    const { SELF } = await import('cloudflare:test');
    const res = await SELF.fetch('https://vault.test/api/ciphers/import', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '203.0.113.7',
        Origin: 'https://vault.test',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});
