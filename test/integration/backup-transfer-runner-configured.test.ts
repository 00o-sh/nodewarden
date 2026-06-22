import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// The BackupTransferRunner DO's run-configured-backup success path: export the
// vault and upload the archive to a configured WebDAV destination. The settings
// are configured through the real worker first; the upload itself is captured
// by an in-memory WebDAV server (globalThis.fetch override) only while the DO
// runs, so it never intercepts the worker requests. Real D1/R2, no mocks.
let session: Session;
let token: string;
let adminId: string;
let destinationId: string;

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
  session = await authenticate('bktrun');
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
  destinationId = ((await settings.json()) as any).destinations[0].id;
});

describe('backup transfer runner configured backup', () => {
  it('exports and uploads a backup to the configured WebDAV destination', async () => {
    const store = new Map<string, Uint8Array>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = webDavServer(store) as typeof fetch;
    try {
      const res = await runner(`run-${crypto.randomUUID()}`).fetch('https://backup-transfer/internal/run-configured-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual', actorUserId: adminId, destinationId }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.result.provider).toBe('webdav');
      expect(String(body.result.fileName)).toMatch(/\.zip$/);
      expect(body.result.fileSize).toBeGreaterThan(0);
      // The archive actually landed on the remote.
      const uploaded = [...store.keys()].some((k) => k.includes('/nodewarden/') && k.endsWith('.zip'));
      expect(uploaded).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
