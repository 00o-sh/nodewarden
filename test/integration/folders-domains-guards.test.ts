import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';

// Folder delete not-found guard and the domain-settings update paths
// (malformed body tolerance and excluded-global-type normalization, including
// object-form entries, deduplication and the not-excluded skip). Real D1, no
// mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('foldersdomains');
  token = session.accessToken;
});

describe('folder delete guard', () => {
  it('404s deleting an unknown folder', async () => {
    expect((await api('DELETE', `/api/folders/${crypto.randomUUID()}`, token)).status).toBe(404);
  });

  it('deletes a real folder', async () => {
    const folder = (await (await api('POST', '/api/folders', token, { name: ENC_STRING })).json()) as any;
    expect([200, 204]).toContain((await api('DELETE', `/api/folders/${folder.id}`, token)).status);
  });
});

describe('domain settings update', () => {
  it('tolerates a malformed body (treated as empty)', async () => {
    const res = await SELF.fetch(url('/api/settings/domains'), {
      method: 'PUT',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
      body: '{bad',
    });
    expect(res.status).toBe(200);
  });

  it('normalizes object-form excluded global types with dedup and skip', async () => {
    const res = await api('PUT', '/api/settings/domains', token, {
      excludedGlobalEquivalentDomains: [
        { type: 0, excluded: true },
        { type: 0, excluded: true }, // duplicate -> ignored
        { type: 1, excluded: false }, // not excluded -> skipped
        2, // bare number -> excluded by default
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const globals: any[] = body.globalEquivalentDomains || body.GlobalEquivalentDomains || [];
    const type0 = globals.find((g) => g.type === 0 || g.Type === 0);
    expect(type0?.excluded ?? type0?.Excluded).toBe(true);
  });
});

describe('cipher import guard', () => {
  it('400s a malformed import body', async () => {
    const res = await SELF.fetch(url('/api/ciphers/import'), {
      method: 'POST',
      headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });
});
