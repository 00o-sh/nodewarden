import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENC_STRING, Session, api, authenticate, baseHeaders, createCipher, sync, url } from './helpers';

// Remote backup with attachments against a real in-memory WebDAV server (fetch
// swapped in this isolate, reaching both the worker and the BackupTransferRunner
// DO). Covers the attachment-blob upload, the incremental reuse via the remote
// attachment index, restore with attachments, the safe-skip of a missing
// attachment, and the integrity/download/delete endpoints. No mocks: the bytes
// must survive an actual upload -> store -> download round-trip.
let session: Session;
let token: string;
let store: Map<string, Uint8Array>;
let putCounts: Map<string, number>;
let originalFetch: typeof fetch;

let cipherId: string;
let attachmentId: string;
let attachmentBytes: Uint8Array;
const REMOTE_ROOT = '/nodewarden';

function attachmentStorePath(): string {
  return `${REMOTE_ROOT}/attachments/${cipherId}/${attachmentId}`;
}

function archiveKeys(): string[] {
  return [...store.keys()].filter((k) => k.startsWith(`${REMOTE_ROOT}/`) && k.endsWith('.zip'));
}

function latestArchiveRelPath(): string {
  const keys = archiveKeys().sort();
  return keys[keys.length - 1].replace(`${REMOTE_ROOT}/`, '');
}

async function uploadAttachment(): Promise<void> {
  const cipher = await createCipher(token);
  cipherId = cipher.id;
  attachmentBytes = new TextEncoder().encode(`remote-attachment-${crypto.randomUUID()}`);
  const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
    fileName: ENC_STRING,
    key: ENC_STRING,
    fileSize: attachmentBytes.byteLength,
  });
  const { attachmentId: aid, url: uploadUrl } = (await reserve.json()) as any;
  attachmentId = aid;
  const up = await SELF.fetch(uploadUrl, {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: attachmentBytes,
  });
  expect(up.status).toBe(201);
}

// (Re)apply the working WebDAV destination. A replaceExisting restore re-imports
// the exported (credential-sanitized) backup settings, so the live config is
// re-established before each test that needs a usable destination.
async function reconfigure(): Promise<void> {
  await api('PUT', '/api/admin/backup/settings', token, {
    masterPasswordHash: session.account.masterPasswordHash,
    destinations: [{
      type: 'webdav',
      label: 'attach',
      includeAttachments: true,
      destination: { baseUrl: 'https://dav.test', username: 'u', password: `pw-${crypto.randomUUID()}`, remotePath: 'nodewarden' },
      schedule: { enabled: true, intervalHours: 24, retentionCount: 30 },
    }],
  });
}

async function runBackup(): Promise<Response> {
  return SELF.fetch(url('/api/admin/backup/run'), {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ masterPasswordHash: session.account.masterPasswordHash }),
  });
}

async function downloadAttachmentBytes(): Promise<Uint8Array> {
  const meta = await api('GET', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token);
  expect(meta.status).toBe(200);
  const downloadUrl = ((await meta.json()) as any).url as string;
  const dl = await SELF.fetch(downloadUrl, { headers: baseHeaders() });
  expect(dl.status).toBe(200);
  return new Uint8Array(await dl.arrayBuffer());
}

beforeAll(async () => {
  session = await authenticate('remoteattach');
  token = session.accessToken;
  store = new Map();
  putCounts = new Map();
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
      putCounts.set(path, (putCounts.get(path) || 0) + 1);
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

  await reconfigure();
  await uploadAttachment();
});

beforeEach(async () => {
  await reconfigure();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('remote backup with attachments', () => {
  it('uploads the archive, the attachment blob, and the attachment index', async () => {
    expect((await runBackup()).status).toBe(200);

    // The DB archive landed remotely.
    expect(archiveKeys().length).toBeGreaterThan(0);
    // The attachment blob landed remotely with the exact uploaded bytes.
    const stored = store.get(attachmentStorePath());
    expect(stored).toBeTruthy();
    expect(stored).toEqual(attachmentBytes);
    // The incremental attachment index was written.
    expect(store.has(`${REMOTE_ROOT}/attachments/.nodewarden-attachment-index.v1.json`)).toBe(true);
    // The attachment blob was uploaded exactly once.
    expect(putCounts.get(attachmentStorePath())).toBe(1);
  });

  it('reuses the existing attachment on a second run instead of re-uploading', async () => {
    expect((await runBackup()).status).toBe(200);
    // A new DB archive was uploaded, but the unchanged attachment was not.
    expect(archiveKeys().length).toBeGreaterThanOrEqual(2);
    expect(putCounts.get(attachmentStorePath())).toBe(1);
  });

  it('restores the vault and the attachment bytes from the remote backup', async () => {
    const path = latestArchiveRelPath();
    await api('POST', '/api/ciphers/delete-permanent', token, { ids: [cipherId] });

    const restore = await SELF.fetch(url('/api/admin/backup/remote/restore'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path, replaceExisting: true, masterPasswordHash: session.account.masterPasswordHash }),
    });
    expect(restore.status).toBe(200);

    const after = (await (await sync(token)).json()) as any;
    const restored = after.ciphers.find((c: any) => c.id === cipherId);
    expect(restored).toBeTruthy();
    expect((restored.attachments || []).length).toBe(1);
    expect(await downloadAttachmentBytes()).toEqual(attachmentBytes);
  });

  it('inspects integrity and downloads the remote archive', async () => {
    const path = latestArchiveRelPath();

    const integrity = await SELF.fetch(url(`/api/admin/backup/remote/integrity?path=${encodeURIComponent(path)}`), {
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(integrity.status).toBe(200);
    const integrityBody = (await integrity.json()) as any;
    expect(integrityBody.integrity.matches).toBe(true);

    const download = await SELF.fetch(url('/api/admin/backup/remote/download'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path, masterPasswordHash: session.account.masterPasswordHash }),
    });
    expect(download.status).toBe(200);
    const zipBytes = new Uint8Array(await download.arrayBuffer());
    // ZIP local-file-header magic "PK\x03\x04".
    expect([zipBytes[0], zipBytes[1], zipBytes[2], zipBytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('safely skips a missing attachment on restore (no dirty row)', async () => {
    // Drop the attachment blob from the remote store, then restore again.
    store.delete(attachmentStorePath());
    const path = latestArchiveRelPath();
    await api('POST', '/api/ciphers/delete-permanent', token, { ids: [cipherId] });

    const restore = await SELF.fetch(url('/api/admin/backup/remote/restore'), {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path, replaceExisting: true, masterPasswordHash: session.account.masterPasswordHash }),
    });
    expect(restore.status).toBe(200);

    // The cipher is restored, but the unavailable attachment is dropped cleanly.
    const after = (await (await sync(token)).json()) as any;
    const restored = after.ciphers.find((c: any) => c.id === cipherId);
    expect(restored).toBeTruthy();
    expect((restored.attachments || []).length).toBe(0);
    expect((await api('GET', `/api/ciphers/${cipherId}/attachment/${attachmentId}`, token)).status).toBe(404);
  });

  it('deletes a remote backup file', async () => {
    const path = latestArchiveRelPath();
    const del = await SELF.fetch(url(`/api/admin/backup/remote/file?path=${encodeURIComponent(path)}`), {
      method: 'DELETE',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(del.status).toBe(200);
    expect(store.has(`${REMOTE_ROOT}/${path}`)).toBe(false);
  });
});
