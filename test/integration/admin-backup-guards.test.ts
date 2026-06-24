import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Guard branches of the admin backup HTTP endpoints (remote browse/download/
// integrity/delete/restore, local export, attachment blob, and import): bad
// destination ids, invalid paths/blob names, malformed JSON, and the
// multipart-import validations. The session user is the first-registered admin.
// Real D1 + R2, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('adminbackupguards');
  token = session.accessToken;
});

function authed(method: string, path: string, body?: BodyInit, contentType?: string): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  return SELF.fetch(url(path), { method, headers: baseHeaders(headers), body });
}

describe('admin remote backup browse/download guards', () => {
  it('409s listing with an unknown destination', async () => {
    expect((await api('GET', '/api/admin/backup/remote?destinationId=nope', token)).status).toBe(409);
  });

  it('409s downloading a zip from an unknown destination', async () => {
    expect(
      (
        await api('POST', '/api/admin/backup/remote/download', token, {
          destinationId: 'nope',
          path: 'backup.zip',
          masterPasswordHash: session.account.masterPasswordHash,
        })
      ).status
    ).toBe(409);
  });

  it('409s downloading a non-zip path', async () => {
    expect(
      (
        await api('POST', '/api/admin/backup/remote/download', token, {
          destinationId: 'nope',
          path: 'notazip',
          masterPasswordHash: session.account.masterPasswordHash,
        })
      ).status
    ).toBe(409);
  });

  it('409s an integrity check with an unknown destination', async () => {
    expect((await api('GET', '/api/admin/backup/remote/integrity?destinationId=nope&path=backup.zip', token)).status).toBe(409);
  });

  it('409s deleting from an unknown destination', async () => {
    expect((await api('DELETE', '/api/admin/backup/remote/file?destinationId=nope&path=backup.zip', token)).status).toBe(409);
  });
});

describe('admin remote backup restore guards', () => {
  it('400s a malformed restore payload', async () => {
    expect((await authed('POST', '/api/admin/backup/remote/restore', '{bad', 'application/json')).status).toBe(400);
  });

  it('rejects a restore with a non-zip path', async () => {
    const res = await api('POST', '/api/admin/backup/remote/restore', token, {
      destinationId: 'nope',
      path: 'notazip',
      masterPasswordHash: session.account.masterPasswordHash,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('admin local export / attachment blob guards', () => {
  it('400s an export with a malformed JSON body', async () => {
    expect((await authed('POST', '/api/admin/backup/export', '{bad', 'application/json')).status).toBe(400);
  });

  it('400s a blob download with a missing blob name', async () => {
    expect((await api('GET', '/api/admin/backup/blob', token)).status).toBe(400);
  });

  it('400s a blob download with a traversal blob name', async () => {
    expect((await api('GET', '/api/admin/backup/blob?blobName=attachments/../secret', token)).status).toBe(400);
  });

  it('404s a blob download for an absent blob', async () => {
    expect((await api('GET', `/api/admin/backup/blob?blobName=attachments/${crypto.randomUUID()}/${crypto.randomUUID()}.bin`, token)).status).toBe(404);
  });
});

describe('admin backup import guards', () => {
  it('400s a non-multipart import body', async () => {
    expect((await authed('POST', '/api/admin/backup/import', JSON.stringify({}), 'application/json')).status).toBe(400);
  });

  it('400s a multipart import with no file', async () => {
    const form = new FormData();
    form.set('replaceExisting', '1');
    expect((await authed('POST', '/api/admin/backup/import', form)).status).toBe(400);
  });

  it('rejects a multipart import of a non-zip file', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3, 4, 5])], 'garbage.zip', { type: 'application/zip' }));
    form.set('allowChecksumMismatch', '1');
    const res = await authed('POST', '/api/admin/backup/import', form);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
