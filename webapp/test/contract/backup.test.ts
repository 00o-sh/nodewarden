import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildCompleteAdminBackupExport,
  exportAdminBackup,
  extractBackupFileChecksumPrefix,
  getAdminBackupSettings,
  getAdminBackupSettingsRepairState,
  listRemoteBackups,
  runAdminBackupNow,
  saveAdminBackupSettings,
  verifyBackupFileIntegrity,
  type AdminBackupSettings,
} from '@/lib/api/backup';
import { deriveLoginHash } from '@/lib/api/auth';
import { unzipSync } from 'fflate';
import { DEFAULT_ITERATIONS, type ContractSession, registerAndLogin } from './helpers';

// Admin backup contract tests. The FIRST account registered in this isolated
// (per-file) worker becomes role 'admin' (accounts.ts userCount===0), which the
// /api/admin/backup/* endpoints require. We drive the real webapp backup api
// client against the real worker.
//
// The admin backup mutation/run/export endpoints additionally require server-
// side user verification (requireBackupUserVerification -> auth.verifyPassword),
// so we must send the login hash as `masterPasswordHash`. That hash is exactly
// what deriveLoginHash(email, password) produces (the same value used at login).
let ctx: ContractSession;
let masterPasswordHash: string;

beforeAll(async () => {
  ctx = await registerAndLogin('backup-admin');
  const prelogin = await deriveLoginHash(ctx.email, ctx.password, DEFAULT_ITERATIONS);
  masterPasswordHash = prelogin.hash;
});

describe('admin backup settings contract', () => {
  it('returns default settings (a single, unconfigured webdav destination)', async () => {
    const settings = await getAdminBackupSettings(ctx.authedFetch);
    expect(Array.isArray(settings.destinations)).toBe(true);
    // Default seed creates exactly one webdav destination with empty credentials.
    expect(settings.destinations.length).toBeGreaterThanOrEqual(1);
    const webdav = settings.destinations.find((d) => d.type === 'webdav');
    expect(webdav).toBeTruthy();
    expect(webdav?.schedule.enabled).toBe(false);
  });

  it('round-trips saveAdminBackupSettings -> getAdminBackupSettings', async () => {
    const current = await getAdminBackupSettings(ctx.authedFetch);
    const target = current.destinations[0];
    expect(target).toBeTruthy();

    // Mutate a non-secret, observable field so we can confirm persistence on read.
    const next: AdminBackupSettings = {
      destinations: current.destinations.map((d) =>
        d.id === target.id
          ? {
              ...d,
              name: 'Round Trip Destination',
              schedule: { ...d.schedule, intervalHours: 12, retentionCount: 7 },
            }
          : d
      ),
    };

    const saved = await saveAdminBackupSettings(ctx.authedFetch, masterPasswordHash, next);
    const savedDest = saved.destinations.find((d) => d.id === target.id);
    expect(savedDest?.name).toBe('Round Trip Destination');
    expect(savedDest?.schedule.intervalHours).toBe(12);
    expect(savedDest?.schedule.retentionCount).toBe(7);

    // Re-read independently to prove the values are persisted, not just echoed.
    const reread = await getAdminBackupSettings(ctx.authedFetch);
    const rereadDest = reread.destinations.find((d) => d.id === target.id);
    expect(rereadDest?.name).toBe('Round Trip Destination');
    expect(rereadDest?.schedule.intervalHours).toBe(12);
    expect(rereadDest?.schedule.retentionCount).toBe(7);
  });

  it('rejects saveAdminBackupSettings with a wrong master password hash', async () => {
    const current = await getAdminBackupSettings(ctx.authedFetch);
    await expect(
      saveAdminBackupSettings(ctx.authedFetch, 'definitely-not-the-hash', current)
    ).rejects.toThrow();
  });

  it('reports repair state (settings are readable, so no repair needed)', async () => {
    const state = await getAdminBackupSettingsRepairState(ctx.authedFetch);
    expect(state.object).toBe('backup-settings-repair');
    expect(typeof state.needsRepair).toBe('boolean');
    // The worker can decrypt/read its own settings here, so no repair is required.
    expect(state.needsRepair).toBe(false);
  });
});

describe('admin backup local export contract', () => {
  it('exportAdminBackup produces a valid zip of the local instance', async () => {
    const payload = await exportAdminBackup(ctx.authedFetch, masterPasswordHash, false);
    expect(payload.fileName).toMatch(/nodewarden_backup_.*\.zip$/i);
    expect(payload.mimeType).toContain('zip');
    expect(payload.bytes.byteLength).toBeGreaterThan(0);

    // The archive is a real zip: it must contain a manifest.json entry.
    const entries = unzipSync(payload.bytes);
    expect(Object.keys(entries)).toContain('manifest.json');
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as {
      tableCounts?: { users?: number };
    };
    // We registered (at least) one admin user, so the export reflects real data.
    expect(manifest.tableCounts?.users).toBeGreaterThanOrEqual(1);
  });

  it('rejects exportAdminBackup with a wrong master password hash', async () => {
    await expect(
      exportAdminBackup(ctx.authedFetch, 'definitely-not-the-hash', false)
    ).rejects.toThrow();
  });

  it('buildCompleteAdminBackupExport (no attachments) returns the export and emits a save progress event', async () => {
    const events: string[] = [];
    const payload = await buildCompleteAdminBackupExport(
      ctx.authedFetch,
      masterPasswordHash,
      false,
      (event) => {
        events.push(event.step);
      }
    );
    expect(payload.fileName).toMatch(/nodewarden_backup_.*\.zip$/i);
    expect(payload.bytes.byteLength).toBeGreaterThan(0);
    // The no-attachments branch short-circuits to a single save progress event.
    expect(events).toContain('export_client_save');
    const entries = unzipSync(payload.bytes);
    expect(Object.keys(entries)).toContain('manifest.json');
  });
});

describe('backup file integrity pure helpers', () => {
  it('extractBackupFileChecksumPrefix parses the trailing checksum hex', () => {
    expect(extractBackupFileChecksumPrefix('nodewarden_backup_20240101_120000_a1b2c.zip')).toBe('a1b2c');
    // Case is normalized to lowercase.
    expect(extractBackupFileChecksumPrefix('nodewarden_backup_20240101_120000_A1B2C.zip')).toBe('a1b2c');
    // No checksum suffix -> null.
    expect(extractBackupFileChecksumPrefix('nodewarden_backup_20240101_120000.zip')).toBeNull();
    // Wrong length (4 hex, not 5) -> null.
    expect(extractBackupFileChecksumPrefix('nodewarden_backup_20240101_120000_a1b2.zip')).toBeNull();
    // Non-hex characters -> null.
    expect(extractBackupFileChecksumPrefix('nodewarden_backup_20240101_120000_zzzzz.zip')).toBeNull();
    // Empty / non-string-ish input -> null.
    expect(extractBackupFileChecksumPrefix('')).toBeNull();
  });

  it('verifyBackupFileIntegrity matches when the filename prefix equals the sha256 prefix', async () => {
    const bytes = new TextEncoder().encode('hello backup contract');
    // First compute the real checksum prefix via a name with no checksum suffix.
    const baseline = await verifyBackupFileIntegrity(bytes, 'nodewarden_backup_20240101_120000.zip');
    expect(baseline.hasChecksumPrefix).toBe(false);
    expect(baseline.expectedPrefix).toBeNull();
    expect(baseline.actualPrefix).toMatch(/^[0-9a-f]{5}$/);
    // No prefix to check against => matches is true.
    expect(baseline.matches).toBe(true);

    const goodName = `nodewarden_backup_20240101_120000_${baseline.actualPrefix}.zip`;
    const good = await verifyBackupFileIntegrity(bytes, goodName);
    expect(good.hasChecksumPrefix).toBe(true);
    expect(good.expectedPrefix).toBe(baseline.actualPrefix);
    expect(good.actualPrefix).toBe(baseline.actualPrefix);
    expect(good.matches).toBe(true);
  });

  it('verifyBackupFileIntegrity reports a mismatch when bytes do not match the filename prefix', async () => {
    const bytes = new TextEncoder().encode('hello backup contract');
    const baseline = await verifyBackupFileIntegrity(bytes, 'nodewarden_backup_20240101_120000.zip');
    // Pick a deliberately wrong 5-hex prefix (flip the first nibble).
    const flipped = baseline.actualPrefix[0] === '0' ? '1' : '0';
    const wrongPrefix = `${flipped}${baseline.actualPrefix.slice(1)}`;
    const wrongName = `nodewarden_backup_20240101_120000_${wrongPrefix}.zip`;
    const result = await verifyBackupFileIntegrity(bytes, wrongName);
    expect(result.hasChecksumPrefix).toBe(true);
    expect(result.expectedPrefix).toBe(wrongPrefix);
    expect(result.actualPrefix).toBe(baseline.actualPrefix);
    expect(result.matches).toBe(false);
  });

  it('the real exported archive satisfies verifyBackupFileIntegrity against its own filename', async () => {
    const payload = await exportAdminBackup(ctx.authedFetch, masterPasswordHash, false);
    const integrity = await verifyBackupFileIntegrity(payload.bytes, payload.fileName);
    // The worker embeds a checksum prefix in the file name; it must validate.
    expect(integrity.hasChecksumPrefix).toBe(true);
    expect(integrity.matches).toBe(true);
  });
});

describe('admin backup remote-destination guard paths', () => {
  // Remote-destination happy paths (a successful run/list/download) require a
  // real S3/WebDAV server we cannot provide in this harness, so we only assert
  // the *reachable* guard/error paths.

  it('runAdminBackupNow rejects a wrong master password hash (user-verification guard, before any remote work)', async () => {
    // The worker verifies the master-password hash before delegating to the
    // backup-transfer Durable Object, so this exercises the real guard and
    // returns the server's "Invalid password" error.
    await expect(runAdminBackupNow(ctx.authedFetch, 'definitely-not-the-hash')).rejects.toThrow();
  });

  it('listRemoteBackups against the unconfigured default destination fails (empty WebDAV URL guard)', async () => {
    // The default seeded destination is a webdav entry with an empty baseUrl,
    // so listing rejects with "WebDAV server URL is required" — a real reachable
    // guard, not a network attempt.
    const settings = await getAdminBackupSettings(ctx.authedFetch);
    const destId = settings.destinations[0]?.id ?? 'missing';
    await expect(listRemoteBackups(ctx.authedFetch, destId)).rejects.toThrow();
  });

  // NOTE (skipped): the *valid-credentials* runAdminBackupNow happy path cannot
  // be covered here. With correct verification the request is delegated to the
  // BackupTransferRunner Durable Object, which fails in this Miniflare harness
  // with "window is not defined" (it expects a browser/runtime global that the
  // test pool does not provide) rather than reaching a meaningful remote-storage
  // guard. Asserting on that incidental error would not be a real contract, so
  // it is intentionally omitted. Likewise downloadRemoteBackup / restore /
  // delete / inspect remote integrity are omitted: they all require a live
  // S3/WebDAV destination that this harness cannot stand up.
});
