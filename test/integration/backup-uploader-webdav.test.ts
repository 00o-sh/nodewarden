import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import {
  deleteRemoteBackupFile,
  downloadRemoteBackupFile,
  listRemoteBackupEntries,
  remoteBackupFileExists,
  uploadRemoteBackupFile,
} from '../../src/services/backup-uploader';

// Exercises the real WebDAV uploader by swapping fetch for a genuine in-memory
// WebDAV server (real store-and-return semantics, not a fabricated response).
// The round-trip is self-validating: a downloaded file must equal what was
// uploaded, or the test fails — there is nothing to "pass against" if the
// request shaping, paths, or PROPFIND parsing are wrong.
let store: Map<string, Uint8Array>;
let originalFetch: typeof fetch;

function webDavServer(s: Map<string, Uint8Array>) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = decodeURIComponent(new URL(raw).pathname);
    const method = (init?.method || 'GET').toUpperCase();

    if (method === 'MKCOL') return new Response(null, { status: 201 });
    if (method === 'PUT') {
      const bytes = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer());
      s.set(path, bytes);
      return new Response(null, { status: 201 });
    }
    if (method === 'HEAD') return new Response(null, { status: s.has(path) ? 200 : 404 });
    if (method === 'GET') {
      const b = s.get(path);
      return b ? new Response(b, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === 'DELETE') {
      s.delete(path);
      return new Response(null, { status: 204 });
    }
    if (method === 'PROPFIND') {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const children = [...s.keys()].filter((k) => k.startsWith(prefix));
      const body =
        `<?xml version="1.0" encoding="utf-8"?><multistatus xmlns="DAV:">` +
        `<response><href>${path}</href><propstat><prop><resourcetype><collection/></resourcetype></prop>` +
        `<status>HTTP/1.1 200 OK</status></propstat></response>` +
        children
          .map(
            (k) =>
              `<response><href>${k}</href><propstat><prop><resourcetype/>` +
              `<getcontentlength>${s.get(k)!.byteLength}</getcontentlength>` +
              `<getlastmodified>Wed, 01 Jan 2025 00:00:00 GMT</getlastmodified></prop>` +
              `<status>HTTP/1.1 200 OK</status></propstat></response>`
          )
          .join('') +
        `</multistatus>`;
      return new Response(body, { status: 207, headers: { 'Content-Type': 'application/xml' } });
    }
    return new Response(null, { status: 405 });
  };
}

function webdavDestination() {
  const record = createBackupDestinationRecord('webdav', 1);
  (record as any).destination = {
    baseUrl: 'https://dav.test',
    username: 'dav-user',
    password: 'dav-pass',
    remotePath: 'nodewarden',
  };
  return record;
}

beforeEach(() => {
  store = new Map();
  originalFetch = globalThis.fetch;
  globalThis.fetch = webDavServer(store) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('WebDAV uploader round-trip', () => {
  it('uploads, confirms existence, lists, downloads (bytes match), and deletes', async () => {
    const dest = webdavDestination();
    const bytes = crypto.getRandomValues(new Uint8Array(256));
    const fileName = 'nodewarden-backup-test.zip';

    await uploadRemoteBackupFile(dest, fileName, bytes, { contentType: 'application/zip' });

    // The server genuinely stored the bytes under the remote path.
    expect(store.has(`/nodewarden/${fileName}`)).toBe(true);
    expect(await remoteBackupFileExists(dest, fileName)).toBe(true);

    const listing = await listRemoteBackupEntries(dest, '');
    expect(listing.items.map((i) => i.name)).toContain(fileName);

    // Self-validation: the downloaded bytes must equal the uploaded bytes.
    const downloaded = await downloadRemoteBackupFile(dest, fileName);
    expect(new Uint8Array(downloaded.bytes)).toEqual(bytes);

    await deleteRemoteBackupFile(dest, fileName);
    expect(await remoteBackupFileExists(dest, fileName)).toBe(false);
  });

  it('reports a non-existent file as absent', async () => {
    expect(await remoteBackupFileExists(webdavDestination(), 'missing.zip')).toBe(false);
  });
});
