import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// The master-password verification gate on the admin backup endpoints has two
// pre-verification branches the happy-path and wrong-password tests don't reach:
// a request with no JSON body at all (so masterPasswordHash defaults to empty),
// and the "masterPasswordHash is required" rejection that precedes any backup
// work. Real auth + D1, no mocks. The session user is the first-registered admin.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('bkverifybranch');
  token = session.accessToken;
});

// POST with an explicit (optionally non-JSON) content type and raw/absent body.
function rawPost(path: string, body?: BodyInit, contentType?: string): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  return SELF.fetch(url(path), { method: 'POST', headers: baseHeaders(headers), body });
}

describe('backup export — verification pre-checks', () => {
  it('400s "masterPasswordHash is required" when the body is not JSON (no hash parsed)', async () => {
    // No application/json content type => the handler never parses a body, so the
    // master password hash is empty and verification fails closed.
    const res = await rawPost('/api/admin/backup/export', 'includeAttachments=false', 'text/plain');
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('masterpasswordhash is required');
  });

  it('400s "masterPasswordHash is required" for a JSON body that omits the hash', async () => {
    const res = await api('POST', '/api/admin/backup/export', token, { includeAttachments: true });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('masterpasswordhash is required');
  });
});

describe('configured run — verification pre-checks', () => {
  it('400s "masterPasswordHash is required" when no JSON body is sent', async () => {
    const res = await rawPost('/api/admin/backup/run');
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('masterpasswordhash is required');
  });
});

describe('attachment blob download — verification pre-checks', () => {
  it('405s a GET regardless of query params (credentials must not be sent in the URL)', async () => {
    // v1.8.0: the blob endpoint is POST-only. A GET is rejected outright so the
    // master-password credential can never be carried in the query string (where
    // it would leak into logs, history and Referer headers).
    const res = await api('GET', '/api/admin/backup/blob?blobName=aaaa/bbbb.bin', token);
    expect(res.status).toBe(405);
    expect((await res.text()).toLowerCase()).toContain('credentials must not be sent in the url');
  });

  it('400s a POST body missing the masterPasswordHash', async () => {
    const res = await api('POST', '/api/admin/backup/blob', token, { blobName: 'aaaa/bbbb.bin' });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('masterpasswordhash is required');
  });

  it('404s a POST for an absent blob once the correct hash is supplied', async () => {
    // v1.8.0: credentials come from the POST body, not the URL. With a valid hash
    // and a well-formed but nonexistent blob name, the handler passes verification
    // and returns 404 for the missing blob.
    const blobName = `${crypto.randomUUID()}/${crypto.randomUUID()}.bin`;
    const res = await api('POST', '/api/admin/backup/blob', token, {
      blobName,
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBe(404);
  });
});
