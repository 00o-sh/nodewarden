import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import { prepareImportPayloadForTarget } from '../src/services/backup-import';
import { KV_MAX_OBJECT_BYTES } from '../src/services/blob-store';

// prepareImportPayloadForTarget decides how restored attachments are handled per
// blob backend. Pure decision logic — no bindings beyond a marker on env to
// select the storage kind (R2 preferred, then KV, else none).

function payloadWith(attachments: Array<{ id: string; cipher_id: string; size?: number }>) {
  return {
    manifest: {} as any,
    db: {
      config: [],
      users: [],
      domain_settings: [],
      user_revisions: [],
      trusted_two_factor_device_tokens: [],
      webauthn_credentials: [],
      folders: [],
      ciphers: [],
      attachments,
    },
  } as any;
}

const blobKey = (cipherId: string, attachmentId: string) => `attachments/${cipherId}/${attachmentId}.bin`;

describe('prepareImportPayloadForTarget', () => {
  it('passes attachments through unchanged on R2', () => {
    const env = { ATTACHMENTS: {} } as unknown as Env;
    const result = prepareImportPayloadForTarget(env, payloadWith([{ id: 'a1', cipher_id: 'c1', size: 10 }]), {});
    expect(result.payload.db.attachments).toHaveLength(1);
    expect(result.skipped.attachments).toBe(0);
    expect(result.skipped.reason).toBeNull();
  });

  it('skips all attachments when no blob storage is configured', () => {
    const env = {} as unknown as Env;
    const result = prepareImportPayloadForTarget(env, payloadWith([
      { id: 'a1', cipher_id: 'c1', size: 10 },
      { id: 'a2', cipher_id: 'c2', size: 20 },
    ]), {});
    expect(result.payload.db.attachments).toHaveLength(0);
    expect(result.skipped.attachments).toBe(2);
    expect(result.skipped.reason).toMatch(/not configured/i);
    expect(result.skipped.items.map((i) => i.path)).toContain(blobKey('c1', 'a1'));
  });

  it('keeps within-limit attachments on KV', () => {
    const env = { ATTACHMENTS_KV: {} } as unknown as Env;
    const files = { [blobKey('c1', 'a1')]: new Uint8Array(1024) };
    const result = prepareImportPayloadForTarget(env, payloadWith([{ id: 'a1', cipher_id: 'c1', size: 1024 }]), files);
    expect(result.payload.db.attachments).toHaveLength(1);
    expect(result.skipped.attachments).toBe(0);
  });

  it('skips an oversized attachment on KV (25 MB object limit)', () => {
    const env = { ATTACHMENTS_KV: {} } as unknown as Env;
    const oversizedKey = blobKey('c1', 'big');
    const okKey = blobKey('c2', 'small');
    const files: Record<string, Uint8Array> = {
      [oversizedKey]: new Uint8Array(KV_MAX_OBJECT_BYTES + 1),
      [okKey]: new Uint8Array(16),
    };
    const result = prepareImportPayloadForTarget(env, payloadWith([
      { id: 'big', cipher_id: 'c1', size: KV_MAX_OBJECT_BYTES + 1 },
      { id: 'small', cipher_id: 'c2', size: 16 },
    ]), files);

    // The oversized one is dropped; the small one survives.
    expect(result.payload.db.attachments.map((a: any) => a.id)).toEqual(['small']);
    expect(result.skipped.attachments).toBe(1);
    expect(result.skipped.reason).toMatch(/25 MB/i);
    expect(result.skipped.items[0].path).toBe(oversizedKey);
  });
});
