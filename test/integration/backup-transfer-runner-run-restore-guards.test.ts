import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';
import { createRemoteBackupTransferSession } from '../../src/services/backup-uploader';

// The transfer runner's run-configured-backup and restore-remote-backup entries
// validate their payloads (invalid JSON, missing actor) and the restore verifies
// the archive's filename checksum before importing. Each guard is exercised
// directly against the real DO; the checksum case seeds a real in-memory WebDAV
// server with a file whose name does not match its contents. No mocks.
let session: Session;
let token: string;
let adminId: string;
let destination: any;

function runner() {
  const id = (env as any).BACKUP_TRANSFER_RUNNER.idFromName(`rr-${crypto.randomUUID()}`);
  return (env as any).BACKUP_TRANSFER_RUNNER.get(id);
}

function post(path: string, body?: unknown, raw?: string): Promise<Response> {
  return runner().fetch(`https://backup-transfer${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body ?? {}),
  });
}

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
    return new Response(null, { status: 405 });
  };
}

beforeAll(async () => {
  session = await authenticate('bkrunrestore');
  token = session.accessToken;
  adminId = ((await (await api('GET', '/api/accounts/profile', token)).json()) as any).id;
  const settings = await api('PUT', '/api/admin/backup/settings', token, {
    masterPasswordHash: session.account.masterPasswordHash,
    destinations: [{
      type: 'webdav', includeAttachments: false,
      destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
      schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
    }],
  });
  expect(settings.status).toBe(200);
  destination = ((await settings.json()) as any).destinations[0];
});

describe('run-configured-backup guards', () => {
  it('400s an invalid JSON body', async () => {
    expect((await post('/internal/run-configured-backup', undefined, '{bad')).status).toBe(400);
  });
  it('400s a manual run without an actor', async () => {
    expect((await post('/internal/run-configured-backup', { trigger: 'manual' })).status).toBe(400);
  });
});

describe('restore-remote-backup guards', () => {
  it('400s an invalid JSON body', async () => {
    expect((await post('/internal/restore-remote-backup', undefined, '{bad')).status).toBe(400);
  });
  it('400s a restore without an actor', async () => {
    expect((await post('/internal/restore-remote-backup', { path: 'x.zip' })).status).toBe(400);
  });

  it('400s when the archive filename checksum does not match its contents', async () => {
    // A backup filename embeds a 5-hex content-hash prefix (..._<hash>.zip). Seed
    // a payload under a filename whose prefix is deliberately wrong, so the
    // restore's checksum verification rejects it before importing.
    const payload = new TextEncoder().encode('not-a-real-archive');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
    const actualPrefix = Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 5);
    const wrongPrefix = actualPrefix === '00000' ? '00001' : '00000';
    const fileName = `nodewarden_backup_${wrongPrefix}.zip`;

    const store = new Map<string, Uint8Array>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = webDavServer(store) as typeof fetch;
    let status: number;
    try {
      const remote = createRemoteBackupTransferSession(destination);
      await remote.putFile(fileName, payload, { contentType: 'application/zip' });

      const res = await runner().fetch('https://backup-transfer/internal/restore-remote-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorUserId: adminId, destinationId: destination.id, path: fileName, replaceExisting: false }),
      });
      status = res.status;
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(status).toBe(400);
  });
});
