import { env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, createCipher } from './helpers';
import { StorageService } from '../../src/services/storage';
import { executeConfiguredBackup } from '../../src/handlers/backup';

// A configured WebDAV destination with retentionCount=1 should prune older
// archives after each successful run. Driven against a real in-memory WebDAV
// server that actually stores/lists/deletes objects (PROPFIND + DELETE), so the
// real pruneRemoteBackupArchives list/sort/delete path runs. No mocks.
let session: Session;
let adminId: string;
let destinationId: string;
let store: Map<string, Uint8Array>;
let originalFetch: typeof fetch;

beforeAll(async () => {
  session = await authenticate('backupretention');
  adminId = ((await (await api('GET', '/api/accounts/profile', session.accessToken)).json()) as any).id;

  store = new Map();
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    let host: string;
    try { host = new URL(raw).host; } catch { return originalFetch(input as any, init); }
    if (host !== 'dav.test') return originalFetch(input as any, init);
    const path = decodeURIComponent(new URL(raw).pathname);
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'MKCOL') return new Response(null, { status: 201 });
    if (method === 'PUT') {
      store.set(path, new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer()));
      return new Response(null, { status: 201 });
    }
    if (method === 'HEAD') return new Response(null, { status: store.has(path) ? 200 : 404 });
    if (method === 'GET') {
      const b = store.get(path);
      return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') { store.delete(path); return new Response(null, { status: 204 }); }
    if (method === 'PROPFIND') {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const items = [...store.keys()].filter((k) => k.startsWith(prefix))
        .map((k) => `<response><href>${k}</href><propstat><prop><resourcetype/><getcontentlength>${store.get(k)!.byteLength}</getcontentlength><getlastmodified>Wed, 01 Jan 2025 00:00:00 GMT</getlastmodified></prop><status>HTTP/1.1 200 OK</status></propstat></response>`).join('');
      return new Response(`<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>${path}</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>${items}</multistatus>`, { status: 207 });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;

  const settings = await api('PUT', '/api/admin/backup/settings', session.accessToken, {
    masterPasswordHash: session.account.masterPasswordHash,
    destinations: [{
      type: 'webdav', includeAttachments: false,
      destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
      schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 1 },
    }],
  });
  destinationId = ((await settings.json()) as any).destinations[0].id;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('configured backup retention pruning', () => {
  it('keeps only retentionCount archives, deleting the oldest', async () => {
    const storage = new StorageService((env as any).DB);

    await executeConfiguredBackup(env as any, storage, adminId, 'manual', destinationId, null, null);
    const archivesAfterFirst = [...store.keys()].filter((k) => k.startsWith('/nodewarden/') && k.endsWith('.zip'));
    expect(archivesAfterFirst.length).toBe(1);
    const firstArchive = archivesAfterFirst[0];

    // Change the DB so the second archive has different content (distinct name).
    await createCipher(session.accessToken, { name: ENC_STRING });
    await executeConfiguredBackup(env as any, storage, adminId, 'manual', destinationId, null, null);

    const archivesAfterSecond = [...store.keys()].filter((k) => k.startsWith('/nodewarden/') && k.endsWith('.zip'));
    // Retention=1: exactly one archive remains and it is not the first one.
    expect(archivesAfterSecond.length).toBe(1);
    expect(archivesAfterSecond).not.toContain(firstArchive);
  });
});
