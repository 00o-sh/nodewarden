import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import {
  deleteRemoteBackupFile,
  downloadRemoteBackupFile,
  listRemoteBackupEntries,
  remoteBackupFileExists,
  uploadRemoteBackupFile,
} from '../../src/services/backup-uploader';

// Virtual-hosted-style S3 addressing and directory (CommonPrefixes) listing,
// against a real in-memory S3 server keyed by request path. The uploader signs
// with SigV4; the server stores real bytes and derives its ListBucketResult
// (Contents + CommonPrefixes) from actual stored objects — no fabricated
// responses. Object keys with an ampersand exercise the XML entity decoder.
let store: Map<string, Uint8Array>;
let originalFetch: typeof fetch;

function xmlEncode(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Virtual-hosted server: the bucket is in the hostname, so the object key is the
// full request path. List requests derive Contents/CommonPrefixes from the keys
// actually present in the store.
function s3VirtualServer(s: Map<string, Uint8Array>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method || 'GET').toUpperCase();
    const key = url.pathname;

    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const base = key.endsWith('/') ? key : `${key}/`; // list path, e.g. "/"
      const prefix = url.searchParams.get('prefix') || '';
      const commonPrefixes = new Set<string>();
      const contents: string[] = [];
      for (const k of s.keys()) {
        if (!k.startsWith(base)) continue;
        const rel = k.slice(base.length); // full object key (no bucket prefix)
        if (!rel.startsWith(prefix)) continue;
        const remainder = rel.slice(prefix.length);
        const slash = remainder.indexOf('/');
        if (slash >= 0) {
          commonPrefixes.add(`${prefix}${remainder.slice(0, slash + 1)}`);
        } else {
          contents.push(
            `<Contents><Key>${xmlEncode(rel)}</Key><Size>${s.get(k)!.byteLength}</Size>` +
              `<LastModified>2025-01-01T00:00:00.000Z</LastModified></Contents>`
          );
        }
      }
      const prefixes = [...commonPrefixes]
        .map((p) => `<CommonPrefixes><Prefix>${xmlEncode(p)}</Prefix></CommonPrefixes>`)
        .join('');
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${prefixes}${contents.join('')}</ListBucketResult>`,
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
    if (method === 'DELETE') { s.delete(key); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  };
}

function vhostDestination(endpoint: string) {
  const record = createBackupDestinationRecord('s3', 1);
  (record as any).destination = {
    endpoint, bucket: 'backups', addressingStyle: 'virtual-hosted-style',
    region: 'auto', accessKeyId: 'AKIA-test', secretAccessKey: `sk-${crypto.randomUUID()}`, rootPath: 'nodewarden',
  };
  return record;
}

beforeEach(() => {
  store = new Map();
  originalFetch = globalThis.fetch;
  globalThis.fetch = s3VirtualServer(store) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('S3 virtual-hosted-style addressing', () => {
  it('round-trips a file when the bucket is derived into the hostname', async () => {
    const dest = vhostDestination('https://s3.test');
    const bytes = new TextEncoder().encode('vhost-backup-bytes');
    await uploadRemoteBackupFile(dest, 'backup.zip', bytes, { contentType: 'application/zip' });
    expect([...store.keys()][0]).toBe('/nodewarden/backup.zip');
    expect(await remoteBackupFileExists(dest, 'backup.zip')).toBe(true);
    const dl = await downloadRemoteBackupFile(dest, 'backup.zip');
    expect(new Uint8Array(dl.bytes)).toEqual(bytes);
    await deleteRemoteBackupFile(dest, 'backup.zip');
    expect(await remoteBackupFileExists(dest, 'backup.zip')).toBe(false);
  });

  it('uses the endpoint as-is when it is already bucket-hosted', async () => {
    const dest = vhostDestination('https://backups.s3.test');
    const bytes = new TextEncoder().encode('already-hosted');
    await uploadRemoteBackupFile(dest, 'host.zip', bytes, { contentType: 'application/zip' });
    expect(await remoteBackupFileExists(dest, 'host.zip')).toBe(true);
  });

  it('lists subdirectories (CommonPrefixes) and files, decoding XML entities', async () => {
    const dest = vhostDestination('https://s3.test');
    const data = new TextEncoder().encode('x');
    await uploadRemoteBackupFile(dest, 'top.zip', data, { contentType: 'application/zip' });
    await uploadRemoteBackupFile(dest, 'sub/inner.zip', data, { contentType: 'application/zip' });
    // A pre-existing object whose key literally contains an ampersand (valid S3
    // bucket state): the list response XML-encodes it, exercising the decoder.
    store.set('/nodewarden/a&b.zip', data);

    const result = await listRemoteBackupEntries(dest, '');
    const dirs = result.items.filter((i) => i.isDirectory).map((i) => i.name);
    const files = result.items.filter((i) => !i.isDirectory).map((i) => i.name);
    expect(dirs).toContain('sub');
    expect(files).toContain('top.zip');
    expect(files).toContain('a&b.zip');
  });
});
