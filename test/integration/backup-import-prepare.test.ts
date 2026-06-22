import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { prepareImportPayloadForTarget } from '../../src/services/backup-import';

// prepareImportPayloadForTarget decides what to do with a backup's attachments
// based on the target blob storage backend (R2 keeps everything; KV filters
// oversized blobs; no backend skips them entirely). getBlobStorageKind only
// reads env.ATTACHMENTS / env.ATTACHMENTS_KV, so each backend is driven with a
// crafted env. No mocks — the real preparation logic runs.

function payloadWithAttachments(): any {
  return {
    manifest: { formatVersion: 1, attachmentBlobs: [] },
    db: {
      config: [],
      users: [{ id: 'u1', email: 'a@example.com' }],
      ciphers: [{ id: 'c1', user_id: 'u1' }],
      attachments: [
        { id: 'a1', cipher_id: 'c1', size: 128 },
        { id: 'a2', cipher_id: 'c1', size: 256 },
        { id: '', cipher_id: '' }, // invalid row -> filtered out under KV
      ],
    },
  };
}

describe('prepareImportPayloadForTarget', () => {
  it('keeps all attachments on an R2 backend', () => {
    const result = prepareImportPayloadForTarget(env as any, payloadWithAttachments(), {});
    expect(result.skipped.reason).toBeNull();
    expect(result.skipped.attachments).toBe(0);
    // R2 path returns the payload untouched.
    expect(result.payload.db.attachments).toHaveLength(3);
  });

  it('skips all attachments when no blob backend is configured', () => {
    const result = prepareImportPayloadForTarget({} as any, payloadWithAttachments(), {});
    expect(result.skipped.attachments).toBe(3);
    expect(result.skipped.reason).toBeTruthy();
    expect(result.payload.db.attachments).toHaveLength(0);
    expect(result.skipped.items[0].kind).toBe('attachment');
  });

  it('keeps valid attachments on a KV backend (dropping invalid rows)', () => {
    const kvEnv = { ATTACHMENTS_KV: {} } as any;
    const result = prepareImportPayloadForTarget(kvEnv, payloadWithAttachments(), {});
    // No oversized blobs supplied, so nothing is skipped...
    expect(result.skipped.attachments).toBe(0);
    expect(result.skipped.reason).toBeNull();
    // ...but the row with empty ids is dropped by the validity filter.
    expect(result.payload.db.attachments).toHaveLength(2);
  });

  it('skips an oversized blob on a KV backend', () => {
    const kvEnv = { ATTACHMENTS_KV: {} } as any;
    // KV objects are capped at 25 MiB; a larger inline blob must be skipped.
    const oversized = new Uint8Array(26 * 1024 * 1024);
    const files = { 'attachments/c1/a1.bin': oversized };
    const result = prepareImportPayloadForTarget(kvEnv, payloadWithAttachments(), files);
    expect(result.skipped.attachments).toBe(1);
    expect(result.skipped.reason).toBeTruthy();
    expect(result.skipped.items[0].path).toBe('attachments/c1/a1.bin');
    // The oversized attachment row is filtered out; the other valid row remains.
    expect(result.payload.db.attachments.map((r: any) => r.id)).toEqual(['a2']);
  });
});
