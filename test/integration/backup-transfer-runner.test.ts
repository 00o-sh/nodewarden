import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// One worker request first so the D1 schema is initialized (the worker's fetch
// handler runs schema init; calling the DO stub directly would otherwise skip
// it and the DB-backed scheduled scan would fail).
beforeAll(async () => {
  await SELF.fetch(url('/api/web-bootstrap'), { headers: baseHeaders() });
});

// Drives the BackupTransferRunner Durable Object's internal request router
// directly through a real DO stub (no mocks) to cover its method/path guards
// and payload-validation branches. Each test uses a fresh DO instance so job
// leases never collide.
function runner(name: string) {
  const id = (env as any).BACKUP_TRANSFER_RUNNER.idFromName(name);
  return (env as any).BACKUP_TRANSFER_RUNNER.get(id);
}

function post(stub: any, path: string, body?: string) {
  return stub.fetch(`https://backup-transfer${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body } : {}),
  });
}

describe('backup transfer runner DO request guards', () => {
  it('404s a non-POST request and an unknown path', async () => {
    const stub = runner(`g-${crypto.randomUUID()}`);
    const get = await stub.fetch('https://backup-transfer/internal/run-scheduled-backups', { method: 'GET' });
    expect(get.status).toBe(404);
    const unknown = await post(stub, '/internal/does-not-exist', '{}');
    expect(unknown.status).toBe(404);
  });

  it('rejects invalid JSON and a manual run without an actor', async () => {
    const stub = runner(`r-${crypto.randomUUID()}`);
    expect((await post(stub, '/internal/run-configured-backup', 'not-json')).status).toBe(400);
    // Valid JSON but no actor on a manual trigger.
    expect((await post(stub, '/internal/run-configured-backup', JSON.stringify({ trigger: 'manual' }))).status).toBe(400);
  });

  it('rejects a restore with invalid JSON or no actor', async () => {
    const stub = runner(`re-${crypto.randomUUID()}`);
    expect((await post(stub, '/internal/restore-remote-backup', '{bad')).status).toBe(400);
    expect((await post(stub, '/internal/restore-remote-backup', JSON.stringify({ path: 'x.zip' }))).status).toBe(400);
  });

  it('rejects malformed attachment download payloads', async () => {
    const stub = runner(`d-${crypto.randomUUID()}`);
    expect((await post(stub, '/internal/download-remote-attachment', 'nope')).status).toBe(400);
    expect((await post(stub, '/internal/download-remote-attachment', JSON.stringify({ destination: {} }))).status).toBe(400);
    expect((await post(stub, '/internal/download-remote-attachment-batch', JSON.stringify({ destination: {}, blobNames: [] }))).status).toBe(400);
  });

  it('rejects malformed attachment upload-chunk payloads', async () => {
    const stub = runner(`u-${crypto.randomUUID()}`);
    expect((await post(stub, '/internal/upload-attachment-chunk', '{bad')).status).toBe(400);
    expect((await post(stub, '/internal/upload-attachment-chunk', JSON.stringify({ attachments: [] }))).status).toBe(400);
  });

  it('runs the scheduled-backup scan with nothing due (completed 0)', async () => {
    const stub = runner(`s-${crypto.randomUUID()}`);
    const res = await post(stub, '/internal/run-scheduled-backups');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.completed).toBe(0);
  });
});
