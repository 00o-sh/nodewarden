import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, url } from './helpers';

// Backup run orchestration branches: retention pruning that actually deletes an
// old archive (against a real in-memory WebDAV server), local export WITH
// attachments, and a successful settings repair.
let session: Session;
let token: string;
let store: Map<string, { bytes: Uint8Array; mtime: number }>;
let originalFetch: typeof fetch;
let clock = 0;

const REMOTE_ROOT = '/nodewarden';

function archiveZips(): string[] {
  return [...store.keys()].filter((k) => k.startsWith(`${REMOTE_ROOT}/`) && k.endsWith('.zip'));
}

async function runBackup(): Promise<Response> {
  return SELF.fetch(url('/api/admin/backup/run'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ masterPasswordHash: session.account.masterPasswordHash }),
  });
}

beforeAll(async () => {
  session = await authenticate('bkorch');
  token = session.accessToken;
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
      store.set(path, { bytes: new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer()), mtime: clock++ });
      return new Response(null, { status: 201 });
    }
    if (method === 'HEAD') return new Response(null, { status: store.has(path) ? 200 : 404 });
    if (method === 'GET') {
      const e = store.get(path);
      return e ? new Response(e.bytes, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') { store.delete(path); return new Response(null, { status: 204 }); }
    if (method === 'PROPFIND') {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const items = [...store.entries()].filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => `<response><href>${k}</href><propstat><prop><resourcetype/><getcontentlength>${v.bytes.byteLength}</getcontentlength><getlastmodified>${new Date(1735689600000 + v.mtime * 1000).toUTCString()}</getlastmodified></prop><status>HTTP/1.1 200 OK</status></propstat></response>`).join('');
      return new Response(`<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>${path}</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>${items}</multistatus>`, { status: 207 });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;

  await api('PUT', '/api/admin/backup/settings', token, {
    masterPasswordHash: session.account.masterPasswordHash,
    destinations: [{
      type: 'webdav',
      label: 'orch',
      destination: { baseUrl: 'https://dav.test', username: 'u', password: `pw-${crypto.randomUUID()}`, remotePath: 'nodewarden' },
      schedule: { enabled: true, intervalHours: 24, retentionCount: 1 },
    }],
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('backup run retention pruning', () => {
  it('prunes older archives down to the retention count on each run', async () => {
    await createCipher(token);
    expect((await runBackup()).status).toBe(200);
    expect(archiveZips().length).toBe(1);

    // A second run uploads a new archive and prunes the previous one
    // (retentionCount is 1), so only the newest archive remains.
    expect((await runBackup()).status).toBe(200);
    expect(archiveZips().length).toBe(1);
  });
});

describe('local export with attachments', () => {
  it('exports a ZIP when attachments are included', async () => {
    const cipher = await createCipher(token);
    const bytes = new TextEncoder().encode('export-attach');
    const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
      fileName: ENC_STRING, key: ENC_STRING, fileSize: bytes.byteLength,
    });
    const { url: uploadUrl } = (await reserve.json()) as any;
    expect((await SELF.fetch(uploadUrl, { method: 'POST', headers: baseHeaders({ Authorization: `Bearer ${token}` }), body: bytes })).status).toBe(201);

    const res = await SELF.fetch(url('/api/admin/backup/export'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ includeAttachments: true, masterPasswordHash: session.account.masterPasswordHash }),
    });
    expect(res.status).toBe(200);
    expect((res.headers.get('Content-Type') || '')).toContain('zip');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});

describe('settings repair', () => {
  it('repairs settings with a valid destination payload', async () => {
    const res = await api('POST', '/api/admin/backup/settings/repair', token, {
      masterPasswordHash: session.account.masterPasswordHash,
      destinations: [{
        type: 'webdav',
        label: 'repaired',
        destination: { baseUrl: 'https://dav.test', username: 'u', password: `pw-${crypto.randomUUID()}`, remotePath: 'nodewarden' },
        schedule: { enabled: false, intervalHours: 24, retentionCount: 30 },
      }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.destinations)).toBe(true);
  });
});
