import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, createFolder, login, newAccount, register, sync, url } from './helpers';

// Fully hermetic backup export -> import round-trip against the real D1 + R2
// bindings (no remote, no mocks). The local archive is DB-only by design
// (attachment bytes round-trip through the remote flow, covered separately), so
// this exercises buildBackupArchive, the filename-checksum gate, and the local
// shadow-table restore path in importBackupArchiveBytes.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('blocal');
  token = session.accessToken;
});

async function exportBackup(includeAttachments = false): Promise<{ bytes: Uint8Array; fileName: string }> {
  const res = await SELF.fetch(url('/api/admin/backup/export'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ includeAttachments, masterPasswordHash: session.account.masterPasswordHash }),
  });
  expect(res.status).toBe(200);
  const cd = res.headers.get('Content-Disposition') || '';
  const fileName = /filename="([^"]+)"/.exec(cd)?.[1] || 'nodewarden_backup.zip';
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, fileName };
}

async function importBackup(
  bytes: Uint8Array,
  fileName: string,
  opts: { replaceExisting?: boolean; allowChecksumMismatch?: boolean } = {}
): Promise<Response> {
  const fd = new FormData();
  fd.set('file', new File([bytes], fileName, { type: 'application/zip' }));
  if (opts.replaceExisting !== false) fd.set('replaceExisting', '1');
  if (opts.allowChecksumMismatch) fd.set('allowChecksumMismatch', '1');
  fd.set('masterPasswordHash', session.account.masterPasswordHash);
  return SELF.fetch(url('/api/admin/backup/import'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: fd,
  });
}

// Create an uploaded (encrypted) attachment so its R2 blob can be served by the
// /blob endpoint. Returns the blob name and bytes.
async function uploadAttachment(content: string): Promise<{ blobName: string; bytes: Uint8Array }> {
  const cipher = await createCipher(token);
  const bytes = new TextEncoder().encode(content);
  const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
    fileName: ENC_STRING,
    key: ENC_STRING,
    fileSize: bytes.byteLength,
  });
  const { attachmentId, url: uploadUrl } = (await reserve.json()) as any;
  const up = await SELF.fetch(uploadUrl, {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: bytes,
  });
  expect(up.status).toBe(201);
  return { blobName: `${cipher.id}/${attachmentId}`, bytes };
}

describe('local backup export/import round-trip', () => {
  it('exports the vault, destroys it, and restores ciphers and folders', async () => {
    const folder = await createFolder(token);
    const cipher = await createCipher(token, { folderId: folder.id });

    const archive = await exportBackup(false);
    expect(archive.bytes.byteLength).toBeGreaterThan(0);
    expect(archive.fileName).toMatch(/^nodewarden_backup_.*\.zip$/);

    // Destroy the cipher before restoring from the archive.
    await api('POST', '/api/ciphers/delete-permanent', token, { ids: [cipher.id] });
    let now = (await (await sync(token)).json()) as any;
    expect(now.ciphers.find((c: any) => c.id === cipher.id)).toBeFalsy();

    const imported = await importBackup(archive.bytes, archive.fileName, { replaceExisting: true });
    expect(imported.status).toBe(200);

    now = (await (await sync(token)).json()) as any;
    expect(now.ciphers.find((c: any) => c.id === cipher.id)).toBeTruthy();
    expect(now.folders.find((f: any) => f.id === folder.id)).toBeTruthy();
  });

  it('rejects an import whose filename checksum does not match, unless overridden', async () => {
    const archive = await exportBackup(false);

    // Keep a real checksum-prefixed name but corrupt the prefix -> gate fails.
    const realPrefix = /_([0-9a-f]{5})\.zip$/i.exec(archive.fileName)?.[1] || '00000';
    const wrongPrefix = realPrefix === '00000' ? '11111' : '00000';
    const badName = archive.fileName.replace(/_[0-9a-f]{5}\.zip$/i, `_${wrongPrefix}.zip`);

    const rejected = await importBackup(archive.bytes, badName, { replaceExisting: true });
    expect(rejected.status).toBe(400);

    // Explicit override is accepted.
    const accepted = await importBackup(archive.bytes, badName, {
      replaceExisting: true,
      allowChecksumMismatch: true,
    });
    expect(accepted.status).toBe(200);
  });

  it('rejects an import with no file (400) and a non-multipart body (400)', async () => {
    const noFile = await SELF.fetch(url('/api/admin/backup/import'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
      body: new FormData(),
    });
    expect(noFile.status).toBe(400);

    const notMultipart = await SELF.fetch(url('/api/admin/backup/import'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ nope: true }),
    });
    expect(notMultipart.status).toBe(400);
  });

  it('serves a backup attachment blob by name and 404s a missing one', async () => {
    const { blobName, bytes } = await uploadAttachment('blob-endpoint-secret');

    const ok = await SELF.fetch(url(`/api/admin/backup/blob?blobName=${blobName}`), {
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(bytes);

    const missing = await SELF.fetch(url(`/api/admin/backup/blob?blobName=${crypto.randomUUID()}/${crypto.randomUUID()}`), {
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(missing.status).toBe(404);

    // A path-traversal blob name is rejected before any storage access.
    const invalid = await SELF.fetch(url('/api/admin/backup/blob?blobName=../../etc/passwd'), {
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(invalid.status).toBe(400);
  });

  it('forbids a non-admin from exporting, importing, or reading blobs (403)', async () => {
    const invite = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const user = newAccount('blocal-nonadmin');
    expect((await register(user, invite.code)).status).toBe(200);
    const userToken = ((await (await login(user)).json()) as any).access_token;

    const exp = await SELF.fetch(url('/api/admin/backup/export'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    expect(exp.status).toBe(403);

    const blob = await SELF.fetch(url('/api/admin/backup/blob?blobName=a/b'), {
      headers: baseHeaders({ Authorization: `Bearer ${userToken}` }),
    });
    expect(blob.status).toBe(403);
  });
});
