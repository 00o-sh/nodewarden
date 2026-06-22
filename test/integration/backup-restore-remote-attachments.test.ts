import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, url } from './helpers';
import { createRemoteBackupTransferSession } from '../../src/services/backup-uploader';

// Restoring a remote backup whose attachment blobs live outside the archive:
// the restore detects the external blob refs, batch-downloads them from the
// remote via the BACKUP_TRANSFER_RUNNER DO, and restores them into R2. Driven
// against a real in-memory WebDAV server — no mocks.
let session: Session;
let token: string;
let adminId: string;
let destination: any;
let cipherId: string;
let attachmentId: string;
const attachmentBytes = new TextEncoder().encode('remote-restore-attachment-bytes');

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
  session = await authenticate('bkrestatt');
  token = session.accessToken;
  adminId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;

  const cipher = (await (await api('POST', '/api/ciphers', token, {
    type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
  })).json()) as any;
  cipherId = cipher.id;
  const reserve = await api('POST', `/api/ciphers/${cipherId}/attachment/v2`, token, {
    fileName: ENC_STRING, key: ENC_STRING, fileSize: attachmentBytes.byteLength,
  });
  const reserved = (await reserve.json()) as any;
  attachmentId = reserved.attachmentId;
  expect((await SELF.fetch(reserved.url, { method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: attachmentBytes })).status).toBe(201);

  const settings = await api('PUT', '/api/admin/backup/settings', token, {
    destinations: [{
      type: 'webdav', includeAttachments: true,
      destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
      schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
    }],
  });
  expect(settings.status).toBe(200);
  destination = ((await settings.json()) as any).destinations[0];
});

describe('remote restore with external attachment blobs', () => {
  it('downloads attachment blobs from the remote and restores them', async () => {
    // Export an attachments-included backup (references the attachment row +
    // manifest blob, but does not inline the .bin).
    const exp = await SELF.fetch(url('/api/admin/backup/export'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ includeAttachments: true }),
    });
    expect(exp.status).toBe(200);
    const fileName = /filename="([^"]+)"/.exec(exp.headers.get('Content-Disposition') || '')?.[1] || 'backup.zip';
    const archiveBytes = new Uint8Array(await exp.arrayBuffer());

    const store = new Map<string, Uint8Array>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = webDavServer(store) as typeof fetch;
    let status: number;
    try {
      const sessionRemote = createRemoteBackupTransferSession(destination);
      // Seed the archive and the external attachment blob on the remote.
      await sessionRemote.putFile(fileName, archiveBytes, { contentType: 'application/zip' });
      await sessionRemote.putFile(`attachments/${cipherId}/${attachmentId}`, attachmentBytes, { contentType: 'application/octet-stream' });

      const res = await runner(`rsa-${crypto.randomUUID()}`).fetch('https://backup-transfer/internal/restore-remote-backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorUserId: adminId, destinationId: destination.id, path: fileName, replaceExisting: true }),
      });
      status = res.status;
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(status).toBe(200);

    // The attachment blob was restored into R2 and downloads byte-for-byte.
    const meta = (await (await api('GET', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token)).json()) as any;
    const dl = await SELF.fetch(meta.url, { headers: baseHeaders() });
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(attachmentBytes);
  });
});
