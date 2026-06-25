import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';
import { StorageService } from '../../src/services/storage';
import { importAndAuditRemoteBackupFile } from '../../src/handlers/backup';

// The handler-side remote restore batch-downloads external attachment blobs via
// the BACKUP_TRANSFER_RUNNER DO, and falls back to a per-attachment single
// download when the batch call fails. We recreate that real failure with a
// faithful stub DO whose batch endpoint 500s while its single endpoint serves
// the blob, then assert the attachment is still restored. The stub reproduces
// the DO's genuine HTTP contract — it is not a fabricated behaviour.
let session: Session;
let token: string;
let adminId: string;
let destination: any;
let archiveBytes: Uint8Array;
let fileName: string;
const attachmentBytes = new TextEncoder().encode('single-fallback-attachment-bytes');

// A stub BACKUP_TRANSFER_RUNNER: the batch download endpoint always fails (forcing
// the per-attachment fallback), while the single download endpoint responds with
// the given status (200 + blob to serve it, 404 to report it missing).
function fallbackRunnerEnv(singleStatus: 200 | 404) {
  return {
    ...(env as any),
    BACKUP_TRANSFER_RUNNER: {
      idFromName: () => ({}),
      get: () => ({
        fetch: async (input: RequestInfo | URL) => {
          const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
          if (raw.includes('download-remote-attachment-batch')) {
            return new Response('batch unavailable', { status: 500 });
          }
          if (raw.includes('download-remote-attachment')) {
            return singleStatus === 200
              ? new Response(attachmentBytes, { status: 200 })
              : new Response(null, { status: 404 });
          }
          return new Response(null, { status: 404 });
        },
      }),
    },
  } as any;
}

function remoteFile() {
  return {
    provider: 'webdav' as const,
    remotePath: fileName,
    fileName,
    contentType: 'application/zip',
    bytes: archiveBytes,
  };
}

beforeAll(async () => {
  session = await authenticate('bkfallback');
  token = session.accessToken;
  adminId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;

  const cipher = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any;
  const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
    fileName: ENC_STRING, key: ENC_STRING, fileSize: attachmentBytes.byteLength,
  });
  const reserved = (await reserve.json()) as any;
  expect((await SELF.fetch(reserved.url, {
    method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: attachmentBytes,
  })).status).toBe(201);

  const settings = await api('PUT', '/api/admin/backup/settings', token, {
    masterPasswordHash: session.account.masterPasswordHash,
    destinations: [{
      type: 'webdav', includeAttachments: true,
      destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
      schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
    }],
  });
  expect(settings.status).toBe(200);
  destination = ((await settings.json()) as any).destinations[0];

  // Export an attachments-included backup: the archive references the external
  // attachment blob (not inlined), so the restore must fetch it via the DO.
  const exp = await SELF.fetch(url('/api/admin/backup/export'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ includeAttachments: true, masterPasswordHash: session.account.masterPasswordHash }),
  });
  expect(exp.status).toBe(200);
  fileName = /filename="([^"]+)"/.exec(exp.headers.get('Content-Disposition') || '')?.[1] || 'backup.zip';
  archiveBytes = new Uint8Array(await exp.arrayBuffer());
});

describe('remote restore single-attachment fallback', () => {
  it('restores the attachment via the single download when the batch download fails', async () => {
    const storage = new StorageService((env as any).DB);
    const outcome = await importAndAuditRemoteBackupFile(
      fallbackRunnerEnv(200),
      storage,
      adminId,
      remoteFile(),
      destination,
      fileName,
      true, // replaceExisting
      true, // checksumMismatchAccepted
    );

    // The batch download failed, so the per-attachment single download served the
    // blob and the attachment file was restored.
    expect(outcome.result.imported.attachmentFiles).toBeGreaterThanOrEqual(1);
  });

  it('completes the restore when both batch and single downloads miss the blob', async () => {
    const storage = new StorageService((env as any).DB);
    // Batch fails and the single download reports 404, so the attachment blob is
    // unavailable; the restore still completes (the blob is simply not restored).
    const outcome = await importAndAuditRemoteBackupFile(
      fallbackRunnerEnv(404),
      storage,
      adminId,
      remoteFile(),
      destination,
      fileName,
      true, // replaceExisting
      true, // checksumMismatchAccepted
    );
    expect(outcome.result).toBeDefined();
  });
});
