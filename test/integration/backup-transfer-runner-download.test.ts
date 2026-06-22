import { env } from 'cloudflare:test';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import { createRemoteBackupTransferSession } from '../../src/services/backup-uploader';

// The BackupTransferRunner DO's remote-attachment download success paths,
// exercised against a real in-memory WebDAV server (store-and-return, no
// fabricated responses). A blob is seeded through the same uploader machinery
// the DO downloads with, so the remote paths line up.
let store: Map<string, Uint8Array>;
let originalFetch: typeof fetch;

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

function webdavDestination() {
  const record = createBackupDestinationRecord('webdav', 1);
  (record as any).destination = {
    baseUrl: 'https://dav.test', username: 'u', password: `pw-${crypto.randomUUID()}`, remotePath: 'nodewarden',
  };
  return record;
}

function runner(name: string) {
  const id = (env as any).BACKUP_TRANSFER_RUNNER.idFromName(name);
  return (env as any).BACKUP_TRANSFER_RUNNER.get(id);
}

function post(stub: any, path: string, body: unknown) {
  return stub.fetch(`https://backup-transfer${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store = new Map();
  originalFetch = globalThis.fetch;
  globalThis.fetch = webDavServer(store) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('backup transfer runner remote attachment download', () => {
  it('downloads a single remote attachment blob', async () => {
    const dest = webdavDestination();
    const blobName = `cipher/${crypto.randomUUID()}`;
    const bytes = new TextEncoder().encode('remote-attachment-bytes');
    await createRemoteBackupTransferSession(dest).putFile(`attachments/${blobName}`, bytes, { contentType: 'application/octet-stream' });

    const res = await post(runner(`dl-${crypto.randomUUID()}`), '/internal/download-remote-attachment', { destination: dest, blobName });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('404s a remote attachment that is not present', async () => {
    const dest = webdavDestination();
    const res = await post(runner(`dl2-${crypto.randomUUID()}`), '/internal/download-remote-attachment', {
      destination: dest, blobName: `cipher/${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
  });

  it('downloads a batch of remote attachments into a zip', async () => {
    const dest = webdavDestination();
    const session = createRemoteBackupTransferSession(dest);
    const names = [`c/${crypto.randomUUID()}`, `c/${crypto.randomUUID()}`];
    const payloads = names.map((_, i) => new TextEncoder().encode(`batch-bytes-${i}`));
    for (let i = 0; i < names.length; i += 1) {
      await session.putFile(`attachments/${names[i]}`, payloads[i], { contentType: 'application/octet-stream' });
    }

    const res = await post(runner(`b-${crypto.randomUUID()}`), '/internal/download-remote-attachment-batch', { destination: dest, blobNames: names });
    expect(res.status).toBe(200);

    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(zip['manifest.json']));
    expect(manifest.entries.length).toBe(2);
    // Each manifest entry points at a file whose bytes match what we seeded.
    for (const entry of manifest.entries) {
      const idx = names.indexOf(entry.blobName);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(zip[entry.path]).toEqual(payloads[idx]);
    }
  });
});
