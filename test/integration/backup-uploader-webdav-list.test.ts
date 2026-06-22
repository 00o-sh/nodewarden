import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import {
  deleteRemoteBackupFile,
  downloadRemoteBackupFile,
  listRemoteBackupEntries,
  remoteBackupFileExists,
  uploadBackupArchive,
  uploadRemoteBackupFile,
} from '../../src/services/backup-uploader';

// WebDAV directory creation (MKCOL) and PROPFIND directory listing against a
// real in-memory WebDAV server keyed by request path. The server stores real
// bytes and derives its multistatus listing (files + subdirectories) from the
// objects actually present. No mocks.
let store: Map<string, Uint8Array>;
let originalFetch: typeof fetch;
let mkcolStatus = 201;

function xmlResponseFor(basePath: string): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const files: string[] = [];
  const dirs = new Set<string>();
  for (const key of store.keys()) {
    if (!key.startsWith(base)) continue;
    const rel = key.slice(base.length);
    const slash = rel.indexOf('/');
    if (slash >= 0) {
      dirs.add(`${base}${rel.slice(0, slash)}/`);
    } else {
      files.push(
        `<d:response><d:href>${base}${rel}</d:href><d:propstat><d:prop>` +
          `<d:resourcetype/><d:getcontentlength>${store.get(key)!.byteLength}</d:getcontentlength>` +
          `<d:getlastmodified>Wed, 01 Jan 2025 00:00:00 GMT</d:getlastmodified>` +
          `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      );
    }
  }
  const dirResponses = [...dirs].map(
    (href) =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
      `<d:resourcetype><d:collection/></d:resourcetype>` +
      `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
  );
  // Self entry (the collection being listed) plus children.
  const self = `<d:response><d:href>${base}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${self}${dirResponses.join('')}${files.join('')}</d:multistatus>`;
}

function webDavServer(s: Map<string, Uint8Array>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = decodeURIComponent(new URL(raw).pathname);
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'MKCOL') return new Response(null, { status: mkcolStatus });
    if (method === 'PUT') {
      s.set(path, new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer()));
      return new Response(null, { status: 201 });
    }
    if (method === 'PROPFIND') {
      const base = path.replace(/\/+$/, '');
      const hasChildren = [...s.keys()].some((k) => k.startsWith(`${base}/`));
      if (!hasChildren) return new Response(null, { status: 404 });
      return new Response(xmlResponseFor(base), { status: 207, headers: { 'Content-Type': 'application/xml' } });
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

function webDavDestination() {
  const record = createBackupDestinationRecord('webdav', 1);
  // A base URL with its own path segment exercises the response-path stripping.
  (record as any).destination = {
    baseUrl: 'https://dav.test/dav', username: 'u', password: 'p', remotePath: 'nodewarden',
  };
  return record;
}

beforeEach(() => {
  store = new Map();
  mkcolStatus = 201;
  originalFetch = globalThis.fetch;
  globalThis.fetch = webDavServer(store) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('WebDAV uploader directory creation and listing', () => {
  it('creates the remote directory and round-trips a file', async () => {
    const dest = webDavDestination();
    const bytes = new TextEncoder().encode('webdav-backup-bytes');
    await uploadRemoteBackupFile(dest, 'backup.zip', bytes, { contentType: 'application/zip' });
    expect(store.has('/dav/nodewarden/backup.zip')).toBe(true);
    expect(await remoteBackupFileExists(dest, 'backup.zip')).toBe(true);
    const dl = await downloadRemoteBackupFile(dest, 'backup.zip');
    expect(new Uint8Array(dl.bytes)).toEqual(bytes);
    await deleteRemoteBackupFile(dest, 'backup.zip');
    expect(await remoteBackupFileExists(dest, 'backup.zip')).toBe(false);
  });

  it('uploads an archive, creating its remote directory (non-cached path)', async () => {
    const dest = webDavDestination();
    const bytes = new TextEncoder().encode('archive-bytes');
    const result = await uploadBackupArchive(dest, bytes, 'archive.zip');
    expect(result.provider).toBe('webdav');
    expect(store.has('/dav/nodewarden/archive.zip')).toBe(true);
  });

  it('creates nested directories for a nested upload path', async () => {
    const dest = webDavDestination();
    await uploadRemoteBackupFile(dest, 'sub/inner.zip', new TextEncoder().encode('x'), { contentType: 'application/zip' });
    expect(store.has('/dav/nodewarden/sub/inner.zip')).toBe(true);
  });

  it('lists files and subdirectories from a PROPFIND response', async () => {
    const dest = webDavDestination();
    const data = new TextEncoder().encode('x');
    await uploadRemoteBackupFile(dest, 'top.zip', data, { contentType: 'application/zip' });
    await uploadRemoteBackupFile(dest, 'sub/inner.zip', data, { contentType: 'application/zip' });

    const result = await listRemoteBackupEntries(dest, '');
    const dirs = result.items.filter((i) => i.isDirectory).map((i) => i.name);
    const files = result.items.filter((i) => !i.isDirectory).map((i) => i.name);
    expect(dirs).toContain('sub');
    expect(files).toContain('top.zip');
    expect(result.items.find((i) => i.name === 'top.zip')?.size).toBe(data.byteLength);
  });

  it('returns an empty listing for an absent path (404)', async () => {
    const dest = webDavDestination();
    const result = await listRemoteBackupEntries(dest, 'does-not-exist');
    expect(result.items).toEqual([]);
  });

  it('throws when remote directory creation fails', async () => {
    const dest = webDavDestination();
    mkcolStatus = 500;
    await expect(uploadBackupArchive(dest, new TextEncoder().encode('x'), 'backup.zip')).rejects.toThrow(
      /WebDAV directory creation failed/
    );
  });
});
