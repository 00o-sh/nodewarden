import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import {
  deleteRemoteBackupFile,
  downloadRemoteBackupFile,
  listRemoteBackupEntries,
  remoteBackupFileExists,
  uploadRemoteBackupFile,
} from '../../src/services/backup-uploader';

// Exercises the S3 virtual-hosted-style addressing branches of the uploader
// (s3BucketBaseUrl / isBucketHostedS3Endpoint / s3ObjectUrl) end to end against
// an in-memory S3 server that stores and returns real bytes — no mocks. Covers
// both the "endpoint already hosts the bucket" branch and the
// "promote bucket to a subdomain" branch, plus PUT/GET/HEAD/DELETE/list.
let originalFetch: typeof fetch;
let store: Map<string, Uint8Array>;

function s3Destination(endpoint: string) {
  const record = createBackupDestinationRecord('s3', 1);
  (record as any).destination = {
    endpoint,
    bucket: 'backups',
    addressingStyle: 'virtual-hosted-style',
    region: 'auto',
    accessKeyId: 'AKIA-test',
    secretAccessKey: `sk-${crypto.randomUUID()}`,
    rootPath: 'nodewarden',
  };
  return record;
}

function s3Server(s: Map<string, Uint8Array>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const url = new URL(raw);
    // Accept any *.s3.test (bucket-as-subdomain) host.
    if (!url.host.endsWith('s3.test')) return originalFetch(input as any, init);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const method = (init?.method || 'GET').toUpperCase();

    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') || '';
      const contents = [...s.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => `<Contents><Key>${k}</Key><Size>${s.get(k)!.byteLength}</Size><LastModified>2025-01-01T00:00:00.000Z</LastModified></Contents>`)
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
      const bytes = s.get(key);
      return bytes ? new Response(bytes, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') {
      s.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;
}

beforeEach(() => {
  store = new Map();
  originalFetch = globalThis.fetch;
  globalThis.fetch = s3Server(store);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('S3 virtual-hosted-style addressing', () => {
  it('round-trips a file when the bucket must be promoted to a subdomain', async () => {
    // endpoint host is plain s3.test, so the uploader rewrites it to backups.s3.test.
    const dest = s3Destination('https://s3.test');
    const bytes = new TextEncoder().encode('virtual-hosted-payload');

    await uploadRemoteBackupFile(dest, 'backup_v.zip', bytes, { contentType: 'application/zip' });
    expect(await remoteBackupFileExists(dest, 'backup_v.zip')).toBe(true);

    const downloaded = await downloadRemoteBackupFile(dest, 'backup_v.zip');
    expect(new TextDecoder().decode(downloaded.bytes)).toBe('virtual-hosted-payload');

    const listing = await listRemoteBackupEntries(dest, '');
    expect(listing.items.some((i) => i.name === 'backup_v.zip')).toBe(true);

    await deleteRemoteBackupFile(dest, 'backup_v.zip');
    expect(await remoteBackupFileExists(dest, 'backup_v.zip')).toBe(false);
  });

  it('uses the endpoint as-is when it already hosts the bucket as a subdomain', async () => {
    // endpoint host already starts with the bucket name, so no rewrite happens.
    const dest = s3Destination('https://backups.s3.test');
    const bytes = new TextEncoder().encode('already-bucket-hosted');

    await uploadRemoteBackupFile(dest, 'b.zip', bytes);
    const downloaded = await downloadRemoteBackupFile(dest, 'b.zip');
    expect(new TextDecoder().decode(downloaded.bytes)).toBe('already-bucket-hosted');
  });
});
