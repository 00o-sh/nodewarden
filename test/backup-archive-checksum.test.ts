import { describe, expect, it } from 'vitest';
import {
  extractBackupFileChecksumPrefix,
  inspectBackupArchiveFileNameChecksum,
  verifyBackupArchiveFileNameChecksum,
} from '../src/services/backup-archive';

// Pure backup-archive filename checksum helpers, with real SHA-256 — no mocks.

describe('extractBackupFileChecksumPrefix', () => {
  it('extracts a lower-cased 5-hex prefix from the filename', () => {
    expect(extractBackupFileChecksumPrefix('nodewarden_backup_2026_ABCDE.zip')).toBe('abcde');
    expect(extractBackupFileChecksumPrefix('x_0f9a1.zip')).toBe('0f9a1');
  });

  it('returns null when there is no checksum suffix', () => {
    expect(extractBackupFileChecksumPrefix('nodewarden_backup.zip')).toBeNull();
    expect(extractBackupFileChecksumPrefix('')).toBeNull();
    expect(extractBackupFileChecksumPrefix('name_xyz12.zip')).toBeNull(); // not hex
  });
});

describe('inspectBackupArchiveFileNameChecksum', () => {
  const bytes = new TextEncoder().encode('backup-archive-bytes');

  it('treats a filename with no checksum as a pass', async () => {
    const result = await inspectBackupArchiveFileNameChecksum(bytes, 'plain.zip');
    expect(result.hasChecksumPrefix).toBe(false);
    expect(result.expectedPrefix).toBeNull();
    expect(result.matches).toBe(true);
    expect(result.actualPrefix).toMatch(/^[0-9a-f]{5}$/);
  });

  it('matches when the embedded prefix equals the content hash', async () => {
    const { actualPrefix } = await inspectBackupArchiveFileNameChecksum(bytes, 'x.zip');
    const goodName = `archive_${actualPrefix}.zip`;
    const ok = await inspectBackupArchiveFileNameChecksum(bytes, goodName);
    expect(ok.hasChecksumPrefix).toBe(true);
    expect(ok.expectedPrefix).toBe(actualPrefix);
    expect(ok.matches).toBe(true);
    expect(await verifyBackupArchiveFileNameChecksum(bytes, goodName)).toBe(true);
  });

  it('fails when the embedded prefix does not match the content', async () => {
    const { actualPrefix } = await inspectBackupArchiveFileNameChecksum(bytes, 'x.zip');
    const wrong = actualPrefix === 'fffff' ? '00000' : 'fffff';
    const badName = `archive_${wrong}.zip`;
    expect((await inspectBackupArchiveFileNameChecksum(bytes, badName)).matches).toBe(false);
    expect(await verifyBackupArchiveFileNameChecksum(bytes, badName)).toBe(false);
  });
});
