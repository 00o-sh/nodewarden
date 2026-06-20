import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import {
  deleteRemoteBackupFile,
  downloadRemoteBackupFile,
  listRemoteBackupEntries,
  remoteBackupFileExists,
  uploadRemoteBackupFile,
} from '../../src/services/backup-uploader';

// Real in-memory S3 (path-style) server swapped in for fetch. The uploader signs
// requests with SigV4; the server stores/returns real bytes, and the round-trip
// is self-validating (downloaded bytes must equal uploaded bytes).
let store: Map<string, Uint8Array>;
let originalFetch: typeof fetch;

function s3Server(s: Map<string, Uint8Array>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method || 'GET').toUpperCase();
    const key = url.pathname; // path-style: /bucket/<key...>

    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') || '';
      const bucketPrefix = key.endsWith('/') ? key : `${key}/`;
      const contents = [...s.keys()]
        .filter((k) => k.startsWith(bucketPrefix))
        .filter((k) => k.slice(bucketPrefix.length).startsWith(prefix))
        .map(
          (k) =>
            `<Contents><Key>${k.slice(bucketPrefix.length)}</Key><Size>${s.get(k)!.byteLength}</Size>` +
            `<LastModified>2025-01-01T00:00:00.000Z</LastModified></Contents>`
        )
        .join('');
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${contents}</ListBucketResult>`,
        { status: 200, headers: { 'Content-Type': 'application/xml' } }
      );
    }
    if (method === 'PUT') {
      s.set(key, new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (method === 'HEAD') return new Response(null, { status: s.has(key) ? 200 : 404 });
    if (method === 'GET') {
      const b = s.get(key);
      return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') {
      s.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
}

function s3Destination() {
  const record = createBackupDestinationRecord('s3', 1);
  (record as any).destination = {
    endpoint: 'https://s3.test',
    bucket: 'backups',
    addressingStyle: 'path-style',
    region: 'auto',
    accessKeyId: 'AKIA-test',
    secretAccessKey: 'secret-test-key',
    rootPath: 'nodewarden',
  };
  return record;
}

beforeEach(() => {
  store = new Map();
  originalFetch = globalThis.fetch;
  globalThis.fetch = s3Server(store) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('S3 uploader round-trip', () => {
  it('uploads, lists, downloads (bytes match), and deletes', async () => {
    const dest = s3Destination();
    const bytes = crypto.getRandomValues(new Uint8Array(200));
    const fileName = 'nodewarden-backup-s3.zip';

    await uploadRemoteBackupFile(dest, fileName, bytes, { contentType: 'application/zip' });
    expect(await remoteBackupFileExists(dest, fileName)).toBe(true);

    const listing = await listRemoteBackupEntries(dest, '');
    expect(listing.items.map((i) => i.name)).toContain(fileName);

    const downloaded = await downloadRemoteBackupFile(dest, fileName);
    expect(new Uint8Array(downloaded.bytes)).toEqual(bytes);

    await deleteRemoteBackupFile(dest, fileName);
    expect(await remoteBackupFileExists(dest, fileName)).toBe(false);
  });
});
