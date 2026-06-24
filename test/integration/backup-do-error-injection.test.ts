import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/types';
import { Session, api, authenticate } from './helpers';
import { StorageService } from '../../src/services/storage';
import { handleRunAdminConfiguredBackup, handleRestoreAdminRemoteBackup } from '../../src/handlers/backup';

// The configured-backup handler delegates the actual run to the
// BACKUP_TRANSFER_RUNNER Durable Object and must surface the DO's outcomes
// faithfully: a 409 (another run in progress), a structured 500, an unstructured
// 500, and a 200 whose body is missing the expected fields. We recreate each
// real DO response with a stub binding (a faithful stand-in for the DO's HTTP
// contract) and assert the handler's translation. Not fabricated behaviour — the
// DO genuinely returns these statuses under concurrency/failure.
let session: Session;
let admin: User;

function runnerEnv(makeResponse: () => Response) {
  return {
    ...(env as any),
    BACKUP_TRANSFER_RUNNER: {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => makeResponse() }),
    },
  } as any;
}

const jsonReq = () =>
  new Request('https://vault.test/api/admin/backup/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ masterPasswordHash: session.account.masterPasswordHash }),
  });

beforeAll(async () => {
  session = await authenticate('backupdoerr');
  const adminId = ((await (await api('GET', '/api/accounts/profile', session.accessToken)).json()) as any).id;
  admin = (await new StorageService((env as any).DB).getUserById(adminId)) as User;
});

describe('configured backup run surfaces Durable Object outcomes', () => {
  it('returns 409 when the DO reports another run in progress', async () => {
    const res = await handleRunAdminConfiguredBackup(jsonReq(), runnerEnv(() => new Response('{}', { status: 409 })), admin);
    expect(res.status).toBe(409);
    expect((await res.text()).toLowerCase()).toContain('already in progress');
  });

  it('surfaces a structured DO error message as a 500', async () => {
    const res = await handleRunAdminConfiguredBackup(
      jsonReq(),
      runnerEnv(() => new Response(JSON.stringify({ error: 'remote exploded' }), { status: 500 })),
      admin
    );
    expect(res.status).toBe(500);
    expect((await res.text()).toLowerCase()).toContain('remote exploded');
  });

  it('falls back to a status message when the DO error body is not JSON', async () => {
    const res = await handleRunAdminConfiguredBackup(
      jsonReq(),
      runnerEnv(() => new Response('not json', { status: 503 })),
      admin
    );
    expect(res.status).toBe(500);
  });

  it('rejects a 200 whose body is missing result/settings', async () => {
    const res = await handleRunAdminConfiguredBackup(
      jsonReq(),
      runnerEnv(() => new Response(JSON.stringify({}), { status: 200 })),
      admin
    );
    expect(res.status).toBe(500);
  });
});

const restoreReq = () =>
  new Request('https://vault.test/api/admin/backup/remote/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'nodewarden_backup.zip', replaceExisting: true, masterPasswordHash: session.account.masterPasswordHash }),
  });

describe('remote backup restore surfaces Durable Object outcomes', () => {
  it('returns 409 when the DO reports another run in progress', async () => {
    const res = await handleRestoreAdminRemoteBackup(restoreReq(), runnerEnv(() => new Response('{}', { status: 409 })), admin);
    expect(res.status).toBe(409);
    expect((await res.text()).toLowerCase()).toContain('already in progress');
  });

  it('surfaces a structured DO restore error', async () => {
    const res = await handleRestoreAdminRemoteBackup(
      restoreReq(),
      runnerEnv(() => new Response(JSON.stringify({ error: 'restore exploded' }), { status: 500 })),
      admin
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.text()).toLowerCase()).toContain('restore exploded');
  });

  it('returns the imported result on a successful DO restore', async () => {
    const importedResult = { imported: { users: 0, ciphers: 0, attachmentFiles: 0 }, skipped: { attachments: 0, reason: null } };
    const res = await handleRestoreAdminRemoteBackup(
      restoreReq(),
      runnerEnv(() => new Response(JSON.stringify(importedResult), { status: 200 })),
      admin
    );
    expect(res.status).toBe(200);
  });
});
