import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createBackupDestinationRecord } from '../../shared/backup-schema';

// The BACKUP_TRANSFER_RUNNER Durable Object validates every internal request
// before doing any work: wrong method, unknown path, invalid/empty JSON, missing
// destination or blob name, an over-sized batch, and a missing blob each produce
// the documented error status. Driven straight against the real DO, no mocks
// (the WebDAV fetch is only swapped for the one not-found case below).
function runner() {
  const id = (env as any).BACKUP_TRANSFER_RUNNER.idFromName(`val-${crypto.randomUUID()}`);
  return (env as any).BACKUP_TRANSFER_RUNNER.get(id);
}

function post(path: string, body?: unknown, raw?: string): Promise<Response> {
  return runner().fetch(`https://backup-transfer${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body ?? {}),
  });
}

function webdavDestination() {
  const record = createBackupDestinationRecord('webdav', 1) as any;
  record.destination = { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' };
  return record;
}

describe('backup transfer runner request validation', () => {
  it('rejects a non-POST request with 404', async () => {
    const res = await runner().fetch('https://backup-transfer/internal/download-remote-attachment', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown path with 404', async () => {
    expect((await post('/internal/does-not-exist')).status).toBe(404);
  });

  describe('download-remote-attachment', () => {
    it('400s an invalid JSON body', async () => {
      expect((await post('/internal/download-remote-attachment', undefined, '{bad')).status).toBe(400);
    });
    it('400s a body missing destination/blobName', async () => {
      expect((await post('/internal/download-remote-attachment', {})).status).toBe(400);
    });
  });

  describe('download-remote-attachment-batch', () => {
    it('400s an invalid JSON body', async () => {
      expect((await post('/internal/download-remote-attachment-batch', undefined, '{bad')).status).toBe(400);
    });
    it('400s a body missing destination/blobNames', async () => {
      expect((await post('/internal/download-remote-attachment-batch', {})).status).toBe(400);
    });
    it('400s a batch larger than the allowed maximum', async () => {
      const blobNames = Array.from({ length: 41 }, (_, i) => `blob-${i}`);
      expect((await post('/internal/download-remote-attachment-batch', { destination: webdavDestination(), blobNames })).status).toBe(400);
    });
  });

  describe('upload-attachment-chunk', () => {
    it('400s an invalid JSON body', async () => {
      expect((await post('/internal/upload-attachment-chunk', undefined, '{bad')).status).toBe(400);
    });
    it('400s a body missing destination/attachments', async () => {
      expect((await post('/internal/upload-attachment-chunk', {})).status).toBe(400);
    });
    it('400s an attachment entry without a blob name', async () => {
      const res = await post('/internal/upload-attachment-chunk', { destination: webdavDestination(), attachments: [{}] });
      expect(res.status).toBe(400);
    });
    it('409s when the referenced blob is missing from storage', async () => {
      const res = await post('/internal/upload-attachment-chunk', {
        destination: webdavDestination(),
        attachments: [{ blobName: `missing-${crypto.randomUUID()}` }],
      });
      expect(res.status).toBe(409);
    });
  });
});
