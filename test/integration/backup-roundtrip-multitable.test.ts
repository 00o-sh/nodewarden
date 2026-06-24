import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, createFolder, enc, url } from './helpers';

// A backup round-trip whose vault has data in several tables at once (ciphers,
// folders, sends, domain settings). This drives the per-table insert/upsert
// branches of importPreparedBackupRows / buildInsertStatements that an empty or
// ciphers-only backup never reaches. Real D1 + R2, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('bmultitable');
  token = session.accessToken;
});

async function exportBackup(): Promise<{ bytes: Uint8Array; fileName: string }> {
  const res = await SELF.fetch(url('/api/admin/backup/export'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ includeAttachments: false, masterPasswordHash: session.account.masterPasswordHash }),
  });
  expect(res.status).toBe(200);
  const fileName = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'nodewarden_backup.zip';
  return { bytes: new Uint8Array(await res.arrayBuffer()), fileName };
}

async function importBackup(bytes: Uint8Array, fileName: string): Promise<Response> {
  const fd = new FormData();
  fd.set('file', new File([bytes], fileName, { type: 'application/zip' }));
  fd.set('replaceExisting', '1');
  fd.set('masterPasswordHash', session.account.masterPasswordHash);
  return SELF.fetch(url('/api/admin/backup/import'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: fd,
  });
}

describe('multi-table backup round-trip', () => {
  it('restores ciphers, folders, sends and domain settings together', async () => {
    await createFolder(token);
    await createCipher(token, { name: enc('login-1') });
    await createCipher(token, { name: enc('login-2') });
    await api('POST', '/api/sends', token, {
      type: 0,
      name: enc('send'),
      key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: enc('secret'), hidden: false },
    });
    await api('PUT', '/api/settings/domains', token, {
      equivalentDomains: [['example.com', 'example.net']],
      excludedGlobalEquivalentDomains: [],
    });

    // The export captured every populated table; the import processes each of
    // them (driving the per-table insert/upsert branches).
    const { bytes, fileName } = await exportBackup();
    const imported = await importBackup(bytes, fileName);
    expect(imported.status).toBe(200);

    // Core vault data is back after the restore.
    const vault = (await (await api('GET', '/api/sync', token)).json()) as any;
    expect((vault.ciphers || []).length).toBeGreaterThanOrEqual(2);
    expect((vault.folders || []).length).toBeGreaterThanOrEqual(1);
    const domains = (await (await api('GET', '/api/settings/domains', token)).json()) as any;
    expect(JSON.stringify(domains.equivalentDomains || [])).toContain('example.com');
  });
});
