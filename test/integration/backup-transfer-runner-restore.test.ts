import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';
import { createRemoteBackupTransferSession } from '../../src/services/backup-uploader';

// The BackupTransferRunner DO's restore-remote-backup success path: download a
// backup archive from the configured remote and restore it into D1. A real
// backup is exported through the worker, seeded onto an in-memory WebDAV server
// (globalThis.fetch override, scoped to the seed + DO run), then restored. Real
// D1/R2, no mocks.
let session: Session;
let token: string;
let adminId: string;
let destination: any;

function webDavServer(s: Map<string, Uint8Array>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = decodeURIComponent(new URL(raw).pathname);
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'MKCOL') return new Response(null, { status: 201 });
    if (method === 'PUT') {
      s.set(path, new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer()));
      return new Response(null, { status: 201 });
    }
    if (method === 'HEAD') return new Response(null, { status: s.has(path) ? 200 : 404 });
    if (method === 'GET') {
      const b = s.get(path);
      return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') { s.delete(path); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  };
}

function runner(name: string) {
  const id = (env as any).BACKUP_TRANSFER_RUNNER.idFromName(name);
  return (env as any).BACKUP_TRANSFER_RUNNER.get(id);
}

beforeAll(async () => {
  session = await authenticate('bktrest');
  token = session.accessToken;
  adminId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;
  const settings = await api('PUT', '/api/admin/backup/settings', token, {
    destinations: [{
      type: 'webdav',
      destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
      schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
    }],
  });
  expect(settings.status).toBe(200);
  destination = ((await settings.json()) as any).destinations[0];
});

describe('backup transfer runner remote restore', () => {
  it('downloads a remote archive and restores it into the instance', async () => {
    // Export a real backup through the worker (before overriding fetch).
    const exp = await SELF.fetch(url('/api/admin/backup/export'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ includeAttachments: false }),
    });
    expect(exp.status).toBe(200);
    const fileName = /filename="([^"]+)"/.exec(exp.headers.get('Content-Disposition') || '')?.[1] || 'backup.zip';
    const archiveBytes = new Uint8Array(await exp.arrayBuffer());

    const store = new Map<string, Uint8Array>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = webDavServer(store) as typeof fetch;
    let restoreStatus: number;
    let restoreBody: any;
    try {
      // Seed the archive onto the remote at the same relative path the restore reads.
      await createRemoteBackupTransferSession(destination).putFile(fileName, archiveBytes, { contentType: 'application/zip' });

      const res = await runner(`rs-${crypto.randomUUID()}`).fetch('https://backup-transfer/internal/restore-remote-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorUserId: adminId, destinationId: destination.id, path: fileName, replaceExisting: true }),
      });
      restoreStatus = res.status;
      restoreBody = await res.json();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(restoreStatus).toBe(200);
    expect(restoreBody).toBeTruthy();

    // The instance is still usable after the restore (the admin's data round-tripped).
    expect((await api('GET', '/api/sync', token)).status).toBe(200);
  });
});
