import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, createCipher, url } from './helpers';

// Local backup import guards: refusing to import into a non-fresh instance
// without replaceExisting, and rejecting a non-archive upload.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('bkimpfresh');
  token = session.accessToken;
});

async function exportBackup(): Promise<{ bytes: Uint8Array; fileName: string }> {
  const res = await SELF.fetch(url('/api/admin/backup/export'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ includeAttachments: false }),
  });
  expect(res.status).toBe(200);
  const fileName = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'nodewarden_backup.zip';
  return { bytes: new Uint8Array(await res.arrayBuffer()), fileName };
}

function importFile(bytes: Uint8Array, fileName: string, replaceExisting: boolean): Promise<Response> {
  const fd = new FormData();
  fd.set('file', new File([bytes], fileName, { type: 'application/zip' }));
  if (replaceExisting) fd.set('replaceExisting', '1');
  fd.set('allowChecksumMismatch', '1');
  return SELF.fetch(url('/api/admin/backup/import'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: fd,
  });
}

describe('local backup import guards', () => {
  it('refuses to import into a non-fresh instance without replaceExisting', async () => {
    await createCipher(token); // makes the instance non-fresh
    const archive = await exportBackup();

    const res = await importFile(archive.bytes, archive.fileName, false);
    expect(res.status).toBeGreaterThanOrEqual(400);

    // With replaceExisting it succeeds (control).
    expect((await importFile(archive.bytes, archive.fileName, true)).status).toBe(200);
  });

  it('rejects a non-archive upload', async () => {
    const res = await importFile(new TextEncoder().encode('this is not a zip'), 'tampered.zip', true);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
