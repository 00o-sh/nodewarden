import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import {
  downloadRemoteBackupFile,
  pruneRemoteBackupArchives,
  remoteBackupFileExists,
  uploadRemoteBackupFile,
} from '../../src/services/backup-uploader';

// S3 error/prune branches against a real in-memory S3 (path-style) server. The
// uploader signs with SigV4; the server stores real bytes. A configurable
// failure mode exercises the non-2xx error handling.
let store: Map<string, Uint8Array>;
let originalFetch: typeof fetch;
let putStatus = 200;

function s3Server(s: Map<string, Uint8Array>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method || 'GET').toUpperCase();
    const key = url.pathname;

    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') || '';
      const bucketPrefix = key.endsWith('/') ? key : `${key}/`;
      const contents = [...s.keys()]
        .filter((k) => k.startsWith(bucketPrefix) && k.slice(bucketPrefix.length).startsWith(prefix))
        .map((k) => `<Contents><Key>${k.slice(bucketPrefix.length)}</Key><Size>${s.get(k)!.byteLength}</Size><LastModified>2025-01-01T00:00:00.000Z</LastModified></Contents>`)
        .join('');
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${contents}</ListBucketResult>`, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    if (method === 'PUT') {
      if (putStatus !== 200) return new Response('denied', { status: putStatus });
      s.set(key, new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (method === 'HEAD') return new Response(null, { status: s.has(key) ? 200 : 404 });
    if (method === 'GET') {
      const b = s.get(key);
      return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') { s.delete(key); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  };
}

function s3Destination() {
  const record = createBackupDestinationRecord('s3', 1);
  (record as any).destination = {
    endpoint: 'https://s3.test', bucket: 'backups', addressingStyle: 'path-style',
    region: 'auto', accessKeyId: 'AKIA-test', secretAccessKey: `sk-${crypto.randomUUID()}`, rootPath: 'nodewarden',
  };
  return record;
}

beforeEach(() => {
  store = new Map();
  putStatus = 200;
  originalFetch = globalThis.fetch;
  globalThis.fetch = s3Server(store) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('S3 uploader error and prune branches', () => {
  it('throws when an upload is rejected by the server (non-2xx)', async () => {
    putStatus = 403;
    await expect(uploadRemoteBackupFile(s3Destination(), 'x.zip', new Uint8Array(8), { contentType: 'application/zip' })).rejects.toThrow();
  });

  it('throws downloading a missing object and reports it absent', async () => {
    const dest = s3Destination();
    await expect(downloadRemoteBackupFile(dest, 'missing.zip')).rejects.toThrow();
    expect(await remoteBackupFileExists(dest, 'missing.zip')).toBe(false);
  });

  it('prunes S3 archives down to the retention count', async () => {
    const dest = s3Destination();
    for (const name of ['s3_1.zip', 's3_2.zip', 's3_3.zip']) {
      await uploadRemoteBackupFile(dest, name, crypto.getRandomValues(new Uint8Array(8)), { contentType: 'application/zip' });
    }
    expect(store.size).toBe(3);
    const deleted = await pruneRemoteBackupArchives(dest, 1);
    expect(deleted).toBe(2);
    expect(store.size).toBe(1);
  });
});
