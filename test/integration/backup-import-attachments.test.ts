import { unzipSync, zipSync } from 'fflate';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, createFolder, url } from './helpers';

// A full local backup export/import round-trip that includes an attachment, so
// the restore exercises the blob-file restore path (not just db.json rows).
// Real D1/R2, replaceExisting restore — no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('bkimpattach');
  token = session.accessToken;
});

async function exportBackup(): Promise<{ bytes: Uint8Array; fileName: string }> {
  const res = await SELF.fetch(url('/api/admin/backup/export'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ includeAttachments: true }),
  });
  expect(res.status).toBe(200);
  const fileName = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'backup.zip';
  return { bytes: new Uint8Array(await res.arrayBuffer()), fileName };
}

function importFile(bytes: Uint8Array, fileName: string): Promise<Response> {
  const fd = new FormData();
  fd.set('file', new File([bytes], fileName, { type: 'application/zip' }));
  fd.set('replaceExisting', '1');
  fd.set('allowChecksumMismatch', '1');
  return SELF.fetch(url('/api/admin/backup/import'), {
    method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: fd,
  });
}

describe('backup import with attachments', () => {
  it('round-trips ciphers, folders, and attachment blobs', async () => {
    const folder = await createFolder(token);
    const cipher = await createCipher(token, { folderId: folder.id });
    const attachmentBytes = new TextEncoder().encode('restore-me-attachment-bytes');
    const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
      fileName: ENC_STRING, key: ENC_STRING, fileSize: attachmentBytes.byteLength,
    });
    const { attachmentId, url: uploadUrl } = (await reserve.json()) as any;
    expect((await SELF.fetch(uploadUrl, { method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: attachmentBytes })).status).toBe(201);

    // The local export records the attachment row but leaves blob bytes for
    // remote destinations, so complete the archive with the .bin the manifest
    // references — exercising the blob-file restore path on import.
    const archive = await exportBackup();
    const entries = unzipSync(archive.bytes);
    entries[`attachments/${cipher.id}/${attachmentId}.bin`] = attachmentBytes;
    const completed = zipSync(entries);
    expect((await importFile(completed, archive.fileName)).status).toBe(200);

    // The folder, cipher, and attachment survive the restore.
    expect((await api('GET', `/api/folders/${folder.id}`, token)).status).toBe(200);
    const restoredCipher = (await (await api('GET', `/api/ciphers/${cipher.id}`, token)).json()) as any;
    expect(restoredCipher.folderId).toBe(folder.id);

    // The attachment blob is downloadable and matches the original bytes.
    const meta = (await (await api('GET', `/api/ciphers/${cipher.id}/attachment/${attachmentId}`, token)).json()) as any;
    const dl = await SELF.fetch(meta.url, { headers: baseHeaders() });
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(attachmentBytes);
  });
});
