import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import { createRemoteBackupTransferSession } from '../../src/services/backup-uploader';
import { putBlobObject } from '../../src/services/blob-store';

// The BackupTransferRunner DO's upload-attachment-chunk success path: it reads
// a blob from R2 and streams it to the configured remote destination. Driven
// against a real in-memory WebDAV server with a real R2-seeded blob — no mocks.
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

describe('backup transfer runner upload-attachment-chunk', () => {
  it('streams an R2 blob to the remote destination', async () => {
    const dest = webdavDestination();
    const blobName = `${crypto.randomUUID()}/${crypto.randomUUID()}`;
    const bytes = new TextEncoder().encode('chunk-upload-bytes');
    await putBlobObject(env as any, blobName, bytes, { size: bytes.byteLength, contentType: 'application/octet-stream' });

    const res = await post(runner(`uc-${crypto.randomUUID()}`), '/internal/upload-attachment-chunk', {
      destination: dest, attachments: [{ blobName }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).uploaded).toBe(1);

    // The blob is now retrievable from the remote at attachments/<blobName>.
    const remote = await createRemoteBackupTransferSession(dest).download(`attachments/${blobName}`);
    expect(new Uint8Array(remote.bytes)).toEqual(bytes);
  });

  it('409s when a referenced blob is missing from R2', async () => {
    const res = await post(runner(`uc2-${crypto.randomUUID()}`), '/internal/upload-attachment-chunk', {
      destination: webdavDestination(), attachments: [{ blobName: `${crypto.randomUUID()}/${crypto.randomUUID()}` }],
    });
    expect(res.status).toBe(409);
  });
});
