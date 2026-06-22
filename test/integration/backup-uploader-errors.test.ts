import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import {
  deleteRemoteBackupFile,
  downloadRemoteBackupFile,
  listRemoteBackupEntries,
  remoteBackupFileExists,
} from '../../src/services/backup-uploader';

// Error handling for the remote download/delete/exists/list operations: when
// the remote returns a non-2xx (non-404) status, each adapter throws a
// descriptive error. Driven against in-memory servers that fail every request.
// No mocks.
let originalFetch: typeof fetch;

// Every request fails with 500.
const failServer = async (): Promise<Response> => new Response('denied', { status: 500 });

function webDavDestination() {
  const record = createBackupDestinationRecord('webdav', 1);
  (record as any).destination = {
    baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden',
  };
  return record;
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
  originalFetch = globalThis.fetch;
  globalThis.fetch = failServer as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('WebDAV remote operation errors', () => {
  const dest = webDavDestination();
  it('throws on a failed download', async () => {
    await expect(downloadRemoteBackupFile(dest, 'backup.zip')).rejects.toThrow(/WebDAV download failed/);
  });
  it('throws on a failed delete', async () => {
    await expect(deleteRemoteBackupFile(dest, 'backup.zip')).rejects.toThrow(/WebDAV delete failed/);
  });
  it('throws on a failed existence check', async () => {
    await expect(remoteBackupFileExists(dest, 'backup.zip')).rejects.toThrow(/WebDAV existence check failed/);
  });
});

describe('S3 remote operation errors', () => {
  const dest = s3Destination();
  it('throws on a failed listing', async () => {
    await expect(listRemoteBackupEntries(dest, '')).rejects.toThrow(/S3 listing failed/);
  });
  it('throws on a failed download', async () => {
    await expect(downloadRemoteBackupFile(dest, 'backup.zip')).rejects.toThrow(/S3 download failed/);
  });
  it('throws on a failed delete', async () => {
    await expect(deleteRemoteBackupFile(dest, 'backup.zip')).rejects.toThrow(/S3 delete failed/);
  });
  it('throws on a failed existence check', async () => {
    await expect(remoteBackupFileExists(dest, 'backup.zip')).rejects.toThrow(/S3 existence check failed/);
  });
});
