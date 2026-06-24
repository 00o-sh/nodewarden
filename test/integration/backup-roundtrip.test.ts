import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, createFolder, enc, sync, url } from './helpers';

// Self-validating backup round-trip through the REAL export/import handlers and
// the REAL archive build/parse/restore code — no mocks. We export the actual
// bytes, destroy the data, then re-import those exact bytes and confirm the
// vault is restored. If the archive format, checksum, parsing, or restore were
// wrong, the round-trip would fail rather than pass against a fabrication.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('backupround');
  token = session.accessToken;
});

async function exportArchive(): Promise<{ bytes: Uint8Array; fileName: string }> {
  const res = await SELF.fetch(url('/api/admin/backup/export'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ includeAttachments: false, masterPasswordHash: session.account.masterPasswordHash }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('application/zip');
  const disposition = res.headers.get('Content-Disposition') || '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'backup.zip';
  return { bytes: new Uint8Array(await res.arrayBuffer()), fileName };
}

async function importArchive(bytes: Uint8Array, fileName: string): Promise<Response> {
  const fd = new FormData();
  fd.append('file', new File([bytes], fileName, { type: 'application/zip' }));
  fd.append('replaceExisting', '1');
  fd.append('masterPasswordHash', session.account.masterPasswordHash);
  // Note: no explicit Content-Type — fetch sets the multipart boundary.
  return SELF.fetch(url('/api/admin/backup/import'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: fd,
  });
}

describe('backup export -> import round-trip', () => {
  it('exports a vault, destroys it, and restores it from the archive', async () => {
    // Seed a vault.
    const folder = await createFolder(token);
    const c1 = await createCipher(token, { folderId: folder.id });
    const c2 = await createCipher(token);
    await api('POST', '/api/sends', token, {
      type: 0, name: enc('s'), key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: enc('x'), hidden: false },
    });

    const before = (await (await sync(token)).json()) as any;
    const cipherIdsBefore = before.ciphers.map((c: any) => c.id).sort();
    expect(cipherIdsBefore).toEqual([c1.id, c2.id].sort());

    // Export the real archive bytes.
    const archive = await exportArchive();
    expect(archive.bytes.byteLength).toBeGreaterThan(0);

    // Destroy the ciphers.
    await api('POST', '/api/ciphers/delete-permanent', token, { ids: [c1.id, c2.id] });
    const emptied = (await (await sync(token)).json()) as any;
    expect(emptied.ciphers).toEqual([]);

    // Restore from the exact exported bytes.
    const restore = await importArchive(archive.bytes, archive.fileName);
    expect(restore.status).toBe(200);

    // The vault is back, with the same ids and folder assignment.
    const after = (await (await sync(token)).json()) as any;
    expect(after.ciphers.map((c: any) => c.id).sort()).toEqual(cipherIdsBefore);
    expect(after.folders.map((f: any) => f.id)).toContain(folder.id);
    const restoredC1 = after.ciphers.find((c: any) => c.id === c1.id);
    expect(restoredC1.folderId).toBe(folder.id);
  });

  it('rejects an import whose filename checksum does not match the bytes', async () => {
    const archive = await exportArchive();
    // Tamper with the bytes so they no longer match the checksum in the name.
    const tampered = new Uint8Array(archive.bytes);
    tampered[tampered.length - 1] ^= 0xff;
    const res = await importArchive(tampered, archive.fileName);
    expect(res.status).toBe(400);
  });

  it('forbids backup export for a non-admin (403)', async () => {
    const { newAccount, register, login } = await import('./helpers');
    const invite = (await (await api('POST', '/api/admin/invites', token, {})).json()) as any;
    const user = newAccount('nonadminbk');
    expect((await register(user, invite.code)).status).toBe(200);
    const userToken = ((await (await login(user)).json()) as any).access_token;

    const res = await SELF.fetch(url('/api/admin/backup/export'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});
