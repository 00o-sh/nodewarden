import { describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';
import { createRemoteBackupTransferSession } from '../../src/services/backup-uploader';

// ensureDestinationConfigReady runs when a remote transfer session is built and
// rejects an incomplete destination at use-time (the settings API accepts
// incomplete destinations, so this is the guard that fires when you actually try
// to use one). createRemoteBackupTransferSession resolves the adapter
// synchronously, so each missing/invalid field throws its specific error. Pure,
// no mocks.
function webdav(over: Record<string, unknown>) {
  const record = createBackupDestinationRecord('webdav', 1) as any;
  record.destination = { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nw', ...over };
  return record;
}

function s3(over: Record<string, unknown>) {
  const record = createBackupDestinationRecord('s3', 1) as any;
  record.destination = {
    endpoint: 'https://s3.test', bucket: 'b', accessKeyId: 'ak', secretAccessKey: 'sk',
    region: 'auto', rootPath: '', ...over,
  };
  return record;
}

describe('remote destination config validation (use-time)', () => {
  it('rejects an incomplete WebDAV destination field by field', () => {
    expect(() => createRemoteBackupTransferSession(webdav({ baseUrl: '' }))).toThrow('WebDAV server URL is required');
    expect(() => createRemoteBackupTransferSession(webdav({ baseUrl: 'ftp://dav.test' }))).toThrow('must start with http');
    expect(() => createRemoteBackupTransferSession(webdav({ username: '' }))).toThrow('WebDAV username is required');
    expect(() => createRemoteBackupTransferSession(webdav({ password: '' }))).toThrow('WebDAV password is required');
  });

  it('accepts a complete WebDAV destination', () => {
    expect(() => createRemoteBackupTransferSession(webdav({}))).not.toThrow();
  });

  it('rejects an incomplete S3 destination field by field', () => {
    expect(() => createRemoteBackupTransferSession(s3({ endpoint: '' }))).toThrow('S3 endpoint is required');
    expect(() => createRemoteBackupTransferSession(s3({ endpoint: 'ftp://s3.test' }))).toThrow('must start with http');
    expect(() => createRemoteBackupTransferSession(s3({ bucket: '' }))).toThrow('S3 bucket is required');
    expect(() => createRemoteBackupTransferSession(s3({ accessKeyId: '' }))).toThrow('S3 access key is required');
    expect(() => createRemoteBackupTransferSession(s3({ secretAccessKey: '' }))).toThrow('S3 secret key is required');
  });

  it('accepts a complete S3 destination', () => {
    expect(() => createRemoteBackupTransferSession(s3({}))).not.toThrow();
  });
});
