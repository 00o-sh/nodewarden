import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Guard branches of the bulk cipher endpoints (archive / unarchive / delete /
// restore / delete-permanent / move): malformed JSON, missing ids array, and
// the move folder-not-found / permanent-delete short-circuit paths. Real D1,
// no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('cipherbulkguards');
  token = session.accessToken;
});

const BULK_PATHS = [
  '/api/ciphers/delete',
  '/api/ciphers/delete-permanent',
  '/api/ciphers/restore',
  '/api/ciphers/archive',
  '/api/ciphers/unarchive',
  '/api/ciphers/move',
];

function rawPost(path: string, body: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    body,
  });
}

describe('bulk cipher endpoint guards', () => {
  it('rejects a malformed JSON body on every bulk endpoint', async () => {
    for (const path of BULK_PATHS) {
      expect((await rawPost(path, '{bad')).status).toBe(400);
    }
  });

  it('requires an ids array on every bulk endpoint', async () => {
    for (const path of BULK_PATHS) {
      expect((await api('POST', path, token, {})).status).toBe(400);
    }
  });
});

describe('bulk move and permanent-delete edge cases', () => {
  it('404s a move to an unknown folder', async () => {
    const res = await api('POST', '/api/ciphers/move', token, {
      ids: [crypto.randomUUID()],
      folderId: crypto.randomUUID(),
    });
    expect(res.status).toBe(404);
  });

  it('204s a permanent-delete with only blank ids', async () => {
    const res = await api('POST', '/api/ciphers/delete-permanent', token, { ids: ['', '   '] });
    expect(res.status).toBe(204);
  });

  it('204s a permanent-delete of ids the user does not own', async () => {
    const res = await api('POST', '/api/ciphers/delete-permanent', token, { ids: [crypto.randomUUID()] });
    expect(res.status).toBe(204);
  });
});
