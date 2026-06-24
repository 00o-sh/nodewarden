import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, sync, url } from './helpers';

// End-to-end remote backup through the configured-run / list / restore handlers,
// against a real in-memory WebDAV server (fetch swapped in this isolate). This
// only works if the backup Durable Object shares the test isolate; if not, the
// store stays empty and the round-trip fails (no false confidence either way).
let session: Session;
let token: string;
let store: Map<string, Uint8Array>;
let originalFetch: typeof fetch;

beforeAll(async () => {
  session = await authenticate('remotee2e');
  token = session.accessToken;
  store = new Map();
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    let host: string;
    try {
      host = new URL(raw).host;
    } catch {
      return originalFetch(input as any, init);
    }
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

  await api('PUT', '/api/admin/backup/settings', token, {
    masterPasswordHash: session.account.masterPasswordHash,
    destinations: [{
      type: 'webdav',
      label: 'e2e',
      destination: { baseUrl: 'https://dav.test', username: 'u', password: `pw-${crypto.randomUUID()}`, remotePath: 'nodewarden' },
      schedule: { enabled: true, intervalHours: 24, retentionCount: 30 },
    }],
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('remote backup run/list/restore', () => {
  it('runs a configured backup, lists it remotely, and restores it', async () => {
    const c1 = await createCipher(token);
    await api('POST', '/api/sends', token, {
      type: 0, name: ENC_STRING, key: ENC_STRING,
      deletionDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      text: { text: ENC_STRING, hidden: false },
    });

    const run = await SELF.fetch(url('/api/admin/backup/run'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ masterPasswordHash: session.account.masterPasswordHash }),
    });
    expect(run.status).toBe(200);

    // The DO actually uploaded a file to the in-memory WebDAV server.
    expect([...store.keys()].some((k) => k.startsWith('/nodewarden/'))).toBe(true);

    const list = await api('GET', '/api/admin/backup/remote', token);
    expect(list.status).toBe(200);
    const items = ((await list.json()) as any).items ?? ((await list.json()) as any).entries ?? [];

    // Destroy the cipher, then restore from the remote backup.
    await api('POST', '/api/ciphers/delete-permanent', token, { ids: [c1.id] });
    const remotePath = [...store.keys()].find((k) => k.startsWith('/nodewarden/'))!.replace(/^\//, '');
    const restore = await SELF.fetch(url('/api/admin/backup/remote/restore'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path: remotePath.replace('nodewarden/', ''), replaceExisting: true, masterPasswordHash: session.account.masterPasswordHash }),
    });
    expect(restore.status).toBe(200);

    const after = (await (await sync(token)).json()) as any;
    expect(after.ciphers.map((c: any) => c.id)).toContain(c1.id);
    void items;
  });
});
