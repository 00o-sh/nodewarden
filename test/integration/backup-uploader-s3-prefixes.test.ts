import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import { listRemoteBackupEntries } from '../../src/services/backup-uploader';

// An S3 list response with both CommonPrefixes (subdirectories) and Contents
// (files) drives the directory-prefix branch of listS3Entries and entity
// decoding of the XML element text. Real SigV4-signed request against an
// in-memory S3 server; no mocks.
let originalFetch: typeof fetch;

function s3Destination() {
  const record = createBackupDestinationRecord('s3', 1);
  (record as any).destination = {
    endpoint: 'https://s3.test',
    bucket: 'backups',
    addressingStyle: 'path-style',
    region: 'auto',
    accessKeyId: 'AKIA-test',
    secretAccessKey: `sk-${crypto.randomUUID()}`,
    rootPath: 'nodewarden',
  };
  return record;
}

const LIST_XML =
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
  `<CommonPrefixes><Prefix>nodewarden/daily &amp; weekly/</Prefix></CommonPrefixes>` +
  `<Contents><Key>nodewarden/backup_2025.zip</Key><Size>2048</Size><LastModified>2025-01-01T00:00:00.000Z</LastModified></Contents>` +
  `</ListBucketResult>`;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const url = new URL(raw);
    if (url.host !== 's3.test') return originalFetch(input as any, init);
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      return new Response(LIST_XML, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('S3 listing with subdirectories', () => {
  it('returns both directory prefixes and file entries', async () => {
    const listing = await listRemoteBackupEntries(s3Destination(), '');
    const dirs = listing.items.filter((i) => i.isDirectory).map((i) => i.name);
    const files = listing.items.filter((i) => !i.isDirectory).map((i) => i.name);
    // The CommonPrefixes entry is decoded ("&amp;" -> "&") and surfaced as a dir.
    expect(dirs).toContain('daily & weekly');
    expect(files).toContain('backup_2025.zip');
  });
});
