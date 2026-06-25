import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildCompleteAdminBackupExport,
  downloadAdminBackupAttachmentBlob,
  exportAdminBackup,
  getAdminBackupSettings,
  getAdminBackupSettingsRepairState,
  importAdminBackup,
  repairAdminBackupSettings,
  type AdminBackupSettings,
} from '@/lib/api/backup';
import { deriveLoginHash } from '@/lib/api/auth';
import { DEFAULT_ITERATIONS, type ContractSession, registerAndLogin } from './helpers';

// Extra admin-backup contract coverage: webapp `lib/api/backup.ts` functions that
// backup.test.ts does not already exercise and which are reachable WITHOUT a real
// remote S3/WebDAV destination. The first account registered in this isolated
// (per-file) worker is admin, which every /api/admin/backup/* route requires.
//
// Backup mutation/run/export/import endpoints require server-side user
// verification (auth.verifyPassword), so the login hash from deriveLoginHash is
// sent as `masterPasswordHash` (same value used at login).
let ctx: ContractSession;
let masterPasswordHash: string;

beforeAll(async () => {
  ctx = await registerAndLogin('backup-extra-admin');
  const prelogin = await deriveLoginHash(ctx.email, ctx.password, DEFAULT_ITERATIONS);
  masterPasswordHash = prelogin.hash;
});

describe('repairAdminBackupSettings contract', () => {
  it('persists settings through the repair endpoint with master-password verification', async () => {
    const current = await getAdminBackupSettings(ctx.authedFetch);
    const target = current.destinations[0];
    expect(target).toBeTruthy();

    const next: AdminBackupSettings = {
      destinations: current.destinations.map((d) =>
        d.id === target.id ? { ...d, name: 'Repaired Destination' } : d
      ),
    };

    const repaired = await repairAdminBackupSettings(
      ctx.authedFetch,
      { masterPasswordHash },
      next
    );
    const repairedDest = repaired.destinations.find((d) => d.id === target.id);
    expect(repairedDest?.name).toBe('Repaired Destination');

    // Re-read independently to prove the repair persisted, not just echoed.
    const reread = await getAdminBackupSettings(ctx.authedFetch);
    expect(reread.destinations.find((d) => d.id === target.id)?.name).toBe('Repaired Destination');
  });

  it('rejects the repair endpoint with a wrong master password hash (verification guard)', async () => {
    const current = await getAdminBackupSettings(ctx.authedFetch);
    await expect(
      repairAdminBackupSettings(ctx.authedFetch, { masterPasswordHash: 'definitely-not-the-hash' }, current)
    ).rejects.toThrow();
  });

  it('rejects the repair endpoint when no verification material is supplied', async () => {
    const current = await getAdminBackupSettings(ctx.authedFetch);
    await expect(
      repairAdminBackupSettings(ctx.authedFetch, {}, current)
    ).rejects.toThrow();
  });
});

describe('downloadAdminBackupAttachmentBlob contract', () => {
  it('rejects an unknown blob name (reachable 404 guard; no attachments exist)', async () => {
    // The worker resolves the blob from R2; a fresh instance has no attachment
    // blobs, so this exercises the real not-found guard rather than a network hop.
    await expect(
      downloadAdminBackupAttachmentBlob(ctx.authedFetch, `attachments/${crypto.randomUUID()}.bin`)
    ).rejects.toThrow();
  });
});

describe('importAdminBackup contract', () => {
  // The instance is fresh of vault/send data (ensureImportTargetIsFresh only
  // counts ciphers/folders/attachments/sends, not users), so a real exported
  // archive can be re-imported without replaceExisting. We assert the reachable
  // verification + checksum guards first, then a real successful round-trip LAST
  // (it re-imports the same admin user, so the admin session is unaffected).

  it('rejects import with a wrong master password hash (verification guard)', async () => {
    const payload = await buildCompleteAdminBackupExport(ctx.authedFetch, masterPasswordHash, false);
    const file = new File([payload.bytes], payload.fileName, { type: 'application/zip' });
    await expect(
      importAdminBackup(ctx.authedFetch, 'definitely-not-the-hash', file, false)
    ).rejects.toThrow();
  });

  it('rejects a checksum-mismatched filename when allowChecksumMismatch is false', async () => {
    const payload = await exportAdminBackup(ctx.authedFetch, masterPasswordHash, false);
    // Rename so the embedded checksum prefix no longer matches the bytes.
    const tampered = new File([payload.bytes], 'nodewarden_backup_20240101_120000_00000.zip', {
      type: 'application/zip',
    });
    await expect(
      importAdminBackup(ctx.authedFetch, masterPasswordHash, tampered, false, false)
    ).rejects.toThrow();
  });

  it('imports a real exported archive end to end (export -> import round-trip)', async () => {
    const payload = await buildCompleteAdminBackupExport(ctx.authedFetch, masterPasswordHash, false);
    const file = new File([payload.bytes], payload.fileName, { type: 'application/zip' });

    const result = await importAdminBackup(ctx.authedFetch, masterPasswordHash, file, false);
    expect(result.object).toBe('instance-backup-import');
    // The archive contained (at least) the admin user; the import reports it back.
    expect(result.imported.users).toBeGreaterThanOrEqual(1);
    expect(result.skipped.attachments).toBe(0);

    // The admin session still works after re-importing its own instance. The
    // restored backup-settings config was wrapped to the pre-restore instance
    // identity, so the worker now reports it as needing administrator
    // reactivation (repair) — the real post-restore contract.
    const repairState = await getAdminBackupSettingsRepairState(ctx.authedFetch);
    expect(repairState.object).toBe('backup-settings-repair');
    expect(repairState.needsRepair).toBe(true);
  });
});

// NOTE (skipped, require a live remote S3/WebDAV destination this harness cannot
// provide): downloadRemoteBackup, deleteRemoteBackup, inspectRemoteBackupIntegrity,
// and restoreRemoteBackup. listRemoteBackups + runAdminBackupNow remote guards are
// already covered in backup.test.ts. A successful destructive importAdminBackup /
// restore (replaceExisting=true) is intentionally omitted: it would wipe and
// rotate the live admin session mid-suite, so only its reachable guard paths are
// asserted above.
