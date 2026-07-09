import { describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { t } from '@/lib/i18n';
import {
  buildCompleteAdminBackupExport,
  deleteRemoteBackup,
  exportAdminBackup,
  extractBackupFileChecksumPrefix,
  getAdminBackupSettings,
  getAdminBackupSettingsRepairState,
  importAdminBackup,
  inspectRemoteBackupIntegrity,
  listRemoteBackups,
  repairAdminBackupSettings,
  runAdminBackupNow,
  saveAdminBackupSettings,
  verifyBackupFileIntegrity,
} from '@/lib/api/backup';

const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers }));
const fail = (status = 500) => () => Promise.resolve(new Response(null, { status }));

describe('api/backup exportAdminBackup', () => {
  it('POSTs the verification payload and returns bytes + parsed file name', async () => {
    const zipBytes = new Uint8Array([1, 2, 3]);
    const authedFetch = vi.fn(() =>
      Promise.resolve(
        new Response(zipBytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="my_backup.zip"',
          },
        })
      )
    );
    const result = await exportAdminBackup(authedFetch as any, 'HASH', true);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/backup/export');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ includeAttachments: true, masterPasswordHash: 'HASH' });
    expect(result.fileName).toBe('my_backup.zip');
    expect(result.mimeType).toBe('application/zip');
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
  });

  it('defaults includeAttachments to false', async () => {
    const authedFetch = vi.fn(() => Promise.resolve(new Response(new Uint8Array(), { status: 200 })));
    await exportAdminBackup(authedFetch as any, 'HASH');
    expect(JSON.parse(authedFetch.mock.calls[0][1].body)).toEqual({
      includeAttachments: false,
      masterPasswordHash: 'HASH',
    });
  });

  it('falls back to the default file name and mime type when headers are absent', async () => {
    const authedFetch = vi.fn(() => Promise.resolve(new Response(new Uint8Array(), { status: 200 })));
    const result = await exportAdminBackup(authedFetch as any, 'HASH');
    expect(result.fileName).toBe('nodewarden_backup.zip');
    expect(result.mimeType).toBe('application/zip');
  });

  it('throws the localized failure message on error', async () => {
    await expect(exportAdminBackup(vi.fn(fail()) as any, 'HASH')).rejects.toThrow(t('txt_backup_export_failed'));
  });
});

describe('api/backup buildCompleteAdminBackupExport', () => {
  it('fetches each manifest attachment blob and folds it into the rebuilt archive', async () => {
    const manifest = {
      attachmentBlobs: [{ blobName: 'blob-1', cipherId: 'ci1', attachmentId: 'at1' }],
    };
    const zipBytes = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    });
    const attachmentBytes = new Uint8Array([4, 5, 6]);

    const authedFetch = vi.fn((url: string) => {
      if (url === '/api/admin/backup/export') {
        return Promise.resolve(
          new Response(zipBytes, {
            status: 200,
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': 'attachment; filename="my_backup.zip"',
            },
          })
        );
      }
      // /api/admin/backup/blob
      return Promise.resolve(new Response(attachmentBytes, { status: 200 }));
    });

    const result = await buildCompleteAdminBackupExport(authedFetch as any, 'HASH', true);

    // Second call downloads the blob referenced by the manifest (line 252).
    const blobCall = authedFetch.mock.calls.find((c) => c[0] === '/api/admin/backup/blob');
    expect(blobCall).toBeTruthy();
    expect(JSON.parse((blobCall![1] as any).body)).toEqual({
      blobName: 'blob-1',
      masterPasswordHash: 'HASH',
    });

    // The rebuilt archive embeds the fetched blob at the manifest-derived path.
    const rebuilt = unzipSync(result.bytes);
    expect(Array.from(rebuilt['attachments/ci1/at1.bin'])).toEqual([4, 5, 6]);
  });

  it('surfaces a blob download failure', async () => {
    const manifest = { attachmentBlobs: [{ blobName: 'blob-x', cipherId: 'c', attachmentId: 'a' }] };
    const zipBytes = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) });
    const authedFetch = vi.fn((url: string) => {
      if (url === '/api/admin/backup/export') {
        return Promise.resolve(new Response(zipBytes, { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 500 }));
    });
    await expect(buildCompleteAdminBackupExport(authedFetch as any, 'HASH', true)).rejects.toThrow(
      t('txt_backup_export_failed')
    );
  });
});

describe('api/backup getAdminBackupSettings', () => {
  it('returns the settings when destinations is an array', async () => {
    const settings = { destinations: [{ id: 'd1' }] };
    const authedFetch = vi.fn(() => jsonResponse(settings));
    expect(await getAdminBackupSettings(authedFetch as any)).toEqual(settings);
    expect(authedFetch).toHaveBeenCalledWith('/api/admin/backup/settings', { method: 'GET' });
  });

  it('throws on an invalid response shape', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    await expect(getAdminBackupSettings(authedFetch as any)).rejects.toThrow(
      t('txt_backup_settings_invalid_response')
    );
  });

  it('throws the load-failed message on error', async () => {
    await expect(getAdminBackupSettings(vi.fn(fail()) as any)).rejects.toThrow(
      t('txt_backup_settings_load_failed')
    );
  });
});

describe('api/backup saveAdminBackupSettings', () => {
  it('PUTs settings merged with the master password hash', async () => {
    const settings = { destinations: [], schedule: { enabled: false } } as any;
    const authedFetch = vi.fn(() => jsonResponse({ destinations: [] }));
    await saveAdminBackupSettings(authedFetch as any, 'HASH', settings);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/backup/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ destinations: [], schedule: { enabled: false }, masterPasswordHash: 'HASH' });
  });

  it('throws the save-failed message on error', async () => {
    await expect(saveAdminBackupSettings(vi.fn(fail()) as any, 'H', { destinations: [] } as any)).rejects.toThrow(
      t('txt_backup_settings_save_failed')
    );
  });
});

describe('api/backup getAdminBackupSettingsRepairState', () => {
  it('returns the repair state', async () => {
    const state = { object: 'backup-settings-repair', needsRepair: true, portable: null };
    const authedFetch = vi.fn(() => jsonResponse(state));
    expect(await getAdminBackupSettingsRepairState(authedFetch as any)).toEqual(state);
    expect(authedFetch).toHaveBeenCalledWith('/api/admin/backup/settings/repair', { method: 'GET' });
  });

  it('throws when needsRepair is not a boolean', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ needsRepair: 'yes' }));
    await expect(getAdminBackupSettingsRepairState(authedFetch as any)).rejects.toThrow(
      t('txt_backup_settings_invalid_response')
    );
  });
});

describe('api/backup repairAdminBackupSettings', () => {
  it('POSTs settings merged with verification material', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ destinations: [] }));
    await repairAdminBackupSettings(
      authedFetch as any,
      { masterPasswordHash: 'H', userVerificationToken: null },
      { destinations: [] } as any
    );
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/backup/settings/repair');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      destinations: [],
      masterPasswordHash: 'H',
      userVerificationToken: null,
    });
  });
});

describe('api/backup runAdminBackupNow', () => {
  const runResult = { object: 'backup-run', result: { fileName: 'f' }, settings: { destinations: [] } };

  it('omits destinationId when not provided', async () => {
    const authedFetch = vi.fn(() => jsonResponse(runResult));
    await runAdminBackupNow(authedFetch as any, 'HASH');
    expect(JSON.parse(authedFetch.mock.calls[0][1].body)).toEqual({ masterPasswordHash: 'HASH' });
  });

  it('includes destinationId when provided and returns the run response', async () => {
    const authedFetch = vi.fn(() => jsonResponse(runResult));
    const result = await runAdminBackupNow(authedFetch as any, 'HASH', 'dest-1');
    expect(JSON.parse(authedFetch.mock.calls[0][1].body)).toEqual({
      destinationId: 'dest-1',
      masterPasswordHash: 'HASH',
    });
    expect(result).toEqual(runResult);
  });

  it('throws on an invalid response', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ object: 'backup-run' }));
    await expect(runAdminBackupNow(authedFetch as any, 'HASH')).rejects.toThrow(
      t('txt_backup_remote_run_invalid_response')
    );
  });
});

describe('api/backup listRemoteBackups', () => {
  const browser = {
    object: 'backup-remote-browser',
    destinationId: 'd1',
    currentPath: '/',
    items: [],
  };

  it('builds the query with destinationId only when path is empty', async () => {
    const authedFetch = vi.fn(() => jsonResponse(browser));
    await listRemoteBackups(authedFetch as any, 'd1');
    expect(authedFetch.mock.calls[0][0]).toBe('/api/admin/backup/remote?destinationId=d1');
  });

  it('adds the path parameter when provided', async () => {
    const authedFetch = vi.fn(() => jsonResponse(browser));
    await listRemoteBackups(authedFetch as any, 'd1', 'sub/dir');
    const url = new URL(authedFetch.mock.calls[0][0] as string, 'https://x');
    expect(url.searchParams.get('destinationId')).toBe('d1');
    expect(url.searchParams.get('path')).toBe('sub/dir');
  });

  it('throws on an invalid response', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ items: [] }));
    await expect(listRemoteBackups(authedFetch as any, 'd1')).rejects.toThrow(
      t('txt_backup_remote_invalid_response')
    );
  });
});

describe('api/backup deleteRemoteBackup', () => {
  it('sends a DELETE with the destination + path + hash', async () => {
    const authedFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    await deleteRemoteBackup(authedFetch as any, 'HASH', 'd1', 'path/x');
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/backup/remote/file');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ destinationId: 'd1', path: 'path/x', masterPasswordHash: 'HASH' });
  });
});

describe('api/backup inspectRemoteBackupIntegrity', () => {
  it('returns the integrity response', async () => {
    const body = { object: 'backup-remote-integrity', integrity: { matches: true }, fileName: 'f.zip' };
    const authedFetch = vi.fn(() => jsonResponse(body));
    expect(await inspectRemoteBackupIntegrity(authedFetch as any, 'H', 'd1', 'p')).toEqual(body);
  });

  it('throws on an incomplete response', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ object: 'x' }));
    await expect(inspectRemoteBackupIntegrity(authedFetch as any, 'H', 'd1', 'p')).rejects.toThrow(
      t('txt_backup_remote_invalid_response')
    );
  });
});

describe('api/backup importAdminBackup', () => {
  it('POSTs a multipart form with flags when requested', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ object: 'instance-backup-import', imported: { config: 1 } }));
    const file = new File([new Uint8Array([1])], 'backup.zip');
    await importAdminBackup(authedFetch as any, 'HASH', file, true, true);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe('/api/admin/backup/import');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('masterPasswordHash')).toBe('HASH');
    expect(form.get('replaceExisting')).toBe('1');
    expect(form.get('allowChecksumMismatch')).toBe('1');
    expect((form.get('file') as File).name).toBe('backup.zip');
  });

  it('omits the flags when not requested', async () => {
    const authedFetch = vi.fn(() => jsonResponse({ imported: { config: 0 } }));
    const file = new File([new Uint8Array([1])], '');
    await importAdminBackup(authedFetch as any, 'HASH', file);
    const form = authedFetch.mock.calls[0][1].body as FormData;
    expect(form.get('replaceExisting')).toBeNull();
    expect(form.get('allowChecksumMismatch')).toBeNull();
    // Empty file name falls back to the default archive name.
    expect((form.get('file') as File).name).toBe('nodewarden_backup.zip');
  });

  it('throws on an invalid response', async () => {
    const authedFetch = vi.fn(() => jsonResponse({}));
    const file = new File([new Uint8Array([1])], 'b.zip');
    await expect(importAdminBackup(authedFetch as any, 'HASH', file)).rejects.toThrow(
      t('txt_backup_import_invalid_response')
    );
  });
});

describe('api/backup file integrity helpers', () => {
  it('extractBackupFileChecksumPrefix reads the 5-hex suffix', () => {
    expect(extractBackupFileChecksumPrefix('nodewarden_backup_20240101_120000_abcde.zip')).toBe('abcde');
    expect(extractBackupFileChecksumPrefix('no_prefix.zip')).toBeNull();
  });

  it('verifyBackupFileIntegrity reports a match against the embedded prefix', async () => {
    const bytes = new Uint8Array([9, 9, 9, 9]);
    // First hash the bytes to learn the real prefix, then embed it in the name.
    const probe = await verifyBackupFileIntegrity(bytes, 'plain.zip');
    expect(probe.hasChecksumPrefix).toBe(false);
    expect(probe.matches).toBe(true); // no embedded prefix -> always matches

    const named = `nodewarden_backup_20240101_120000_${probe.actualPrefix}.zip`;
    const checked = await verifyBackupFileIntegrity(bytes, named);
    expect(checked.hasChecksumPrefix).toBe(true);
    expect(checked.expectedPrefix).toBe(probe.actualPrefix);
    expect(checked.matches).toBe(true);

    const mismatch = await verifyBackupFileIntegrity(bytes, 'nodewarden_backup_20240101_120000_00000.zip');
    expect(mismatch.matches).toBe(false);
  });
});
