import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import {
  deleteRemoteBackupFile,
  downloadRemoteBackupFile,
  ensureRemoteRestoreCandidate,
  pruneRemoteBackupArchives,
  uploadRemoteBackupFile,
} from '../../src/services/backup-uploader';

// Retention pruning, restore-candidate validation, and not-found/invalid-path
// error branches of the backup uploader, exercised against a real in-memory
// WebDAV server (store-and-return semantics, no fabricated responses).
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
    if (method === 'PROPFIND') {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const children = [...s.keys()].filter((k) => k.startsWith(prefix));
      const body =
        `<?xml version="1.0" encoding="utf-8"?><multistatus xmlns="DAV:">` +
        `<response><href>${path}</href><propstat><prop><resourcetype><collection/></resourcetype></prop>` +
        `<status>HTTP/1.1 200 OK</status></propstat></response>` +
        children.map((k) =>
          `<response><href>${k}</href><propstat><prop><resourcetype/>` +
          `<getcontentlength>${s.get(k)!.byteLength}</getcontentlength>` +
          `<getlastmodified>Wed, 01 Jan 2025 00:00:00 GMT</getlastmodified></prop>` +
          `<status>HTTP/1.1 200 OK</status></propstat></response>`).join('') +
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
    password: `pw-${crypto.randomUUID()}`,
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

describe('ensureRemoteRestoreCandidate', () => {
  it('accepts a .zip path and rejects others', () => {
    expect(ensureRemoteRestoreCandidate('nodewarden_backup.zip')).toBe('nodewarden_backup.zip');
    expect(() => ensureRemoteRestoreCandidate('notes.txt')).toThrow(/ZIP file/i);
    expect(() => ensureRemoteRestoreCandidate('')).toThrow(/ZIP file/i);
    expect(() => ensureRemoteRestoreCandidate('../escape.zip')).toThrow(/Invalid remote backup path/i);
  });
});

describe('pruneRemoteBackupArchives', () => {
  it('keeps the most recent N archives and deletes the rest', async () => {
    const dest = webdavDestination();
    for (const name of ['backup_1.zip', 'backup_2.zip', 'backup_3.zip', 'backup_4.zip']) {
      await uploadRemoteBackupFile(dest, name, crypto.getRandomValues(new Uint8Array(8)), { contentType: 'application/zip' });
    }
    expect(store.size).toBe(4);

    const deleted = await pruneRemoteBackupArchives(dest, 2);
    expect(deleted).toBe(2);
    expect(store.size).toBe(2);
  });

  it('is a no-op when retention is null or under the limit', async () => {
    const dest = webdavDestination();
    await uploadRemoteBackupFile(dest, 'only.zip', new Uint8Array(4), { contentType: 'application/zip' });
    expect(await pruneRemoteBackupArchives(dest, null)).toBe(0);
    expect(await pruneRemoteBackupArchives(dest, 5)).toBe(0);
    expect(store.size).toBe(1);
  });
});

describe('uploader error branches', () => {
  it('throws downloading a missing file', async () => {
    await expect(downloadRemoteBackupFile(webdavDestination(), 'nope.zip')).rejects.toThrow();
  });

  it('rejects deleting a non-zip path', async () => {
    await expect(deleteRemoteBackupFile(webdavDestination(), 'data.txt')).rejects.toThrow(/ZIP file/i);
  });
});
