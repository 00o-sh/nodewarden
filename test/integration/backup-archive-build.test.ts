import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildBackupArchive,
  parseBackupArchive,
  verifyBackupArchiveFileNameChecksum,
} from '../../src/services/backup-archive';
import { ENC_STRING, Session, api, authenticate } from './helpers';

// buildBackupArchive driven directly against the real D1 binding, with a real
// progress reporter — no mocks. Covers the progress callbacks, the attachment
// blob-manifest mapping, the include/exclude-attachments split, and the
// filename checksum, with a round-trip back through parseBackupArchive.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('bkbuild');
  token = session.accessToken;
});

function progressCollector() {
  const steps: string[] = [];
  return {
    steps,
    report: async (event: { step: string }) => {
      steps.push(event.step);
    },
  };
}

describe('buildBackupArchive', () => {
  it('builds an attachmentless archive, reports progress, and round-trips', async () => {
    await api('POST', '/api/ciphers', token, {
      type: 1, name: ENC_STRING, notes: ENC_STRING, favorite: false,
      login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    });

    const { steps, report } = progressCollector();
    const bundle = await buildBackupArchive(env as any, new Date(), { includeAttachments: false, progress: report });

    // Progress reporter is invoked across the build stages.
    expect(steps).toEqual(expect.arrayContaining(['collect_data', 'package_archive', 'archive_ready']));

    // The filename embeds a checksum of the bytes that verifies.
    expect(await verifyBackupArchiveFileNameChecksum(bundle.bytes, bundle.fileName)).toBe(true);
    expect(bundle.manifest.includes.attachments).toBe(false);
    expect(bundle.manifest.attachmentBlobs).toEqual([]);

    // The archive parses and reflects the exported vault.
    const parsed = parseBackupArchive(bundle.bytes);
    expect(parsed.payload.manifest.formatVersion).toBe(bundle.manifest.formatVersion);
    expect(bundle.manifest.tableCounts.ciphers).toBeGreaterThanOrEqual(1);
  });

  it('maps attachment blobs into the manifest when attachments are included', async () => {
    const cipher = (await (await api('POST', '/api/ciphers', token, {
      type: 1, name: ENC_STRING, login: { username: ENC_STRING, password: ENC_STRING, uris: [] },
    })).json()) as any;
    const reserve = await api('POST', `/api/ciphers/${cipher.id}/attachment/v2`, token, {
      fileName: ENC_STRING, key: ENC_STRING, fileSize: 16,
    });
    expect(reserve.status).toBe(200);

    const bundle = await buildBackupArchive(env as any, new Date(), { includeAttachments: true });
    expect(bundle.manifest.includes.attachments).toBe(true);
    expect(bundle.manifest.attachmentBlobs.length).toBeGreaterThanOrEqual(1);
    expect(bundle.manifest.blobSummary.attachmentFiles).toBe(bundle.manifest.attachmentBlobs.length);
    const blob = bundle.manifest.attachmentBlobs[0];
    expect(blob.blobName).toBe(`${blob.cipherId}/${blob.attachmentId}`);

    // The archive references attachments but carries no .bin entries (those are
    // streamed separately), so a default parse rejects it while the
    // external-blob option accepts it.
    expect(() => parseBackupArchive(bundle.bytes)).toThrow(/missing required file/i);
    const parsed = parseBackupArchive(bundle.bytes, { allowExternalAttachmentBlobs: true });
    expect(parsed.payload.db.attachments.length).toBeGreaterThanOrEqual(1);
  });
});
