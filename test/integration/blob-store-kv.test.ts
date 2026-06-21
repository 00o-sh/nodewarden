import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Env } from '../../src/types';
import {
  KV_MAX_OBJECT_BYTES,
  deleteBlobObject,
  getAttachmentObjectKey,
  getBlobObject,
  getBlobStorageKind,
  getBlobStorageMaxBytes,
  getSendFileObjectKey,
  putBlobObject,
} from '../../src/services/blob-store';

// The KV-backed blob storage path, exercised against a real in-memory KV
// namespace (ATTACHMENTS_KV) bound by the test runtime. R2 is the worker's
// preferred backend, so we construct KV-only / R2-only / empty env views to
// drive each branch deterministically — no mocks.
const kvEnv = () => ({ ATTACHMENTS_KV: (env as any).ATTACHMENTS_KV } as unknown as Env);
const r2Env = () => ({ ATTACHMENTS: (env as any).ATTACHMENTS } as unknown as Env);
const emptyEnv = () => ({} as unknown as Env);

function key(): string {
  return getAttachmentObjectKey(crypto.randomUUID(), crypto.randomUUID());
}

describe('blob storage selection', () => {
  it('prefers R2, falls back to KV, else null', () => {
    expect(getBlobStorageKind({ ATTACHMENTS: (env as any).ATTACHMENTS, ATTACHMENTS_KV: (env as any).ATTACHMENTS_KV } as unknown as Env)).toBe('r2');
    expect(getBlobStorageKind(kvEnv())).toBe('kv');
    expect(getBlobStorageKind(emptyEnv())).toBeNull();
  });

  it('clamps the KV max object size but leaves R2 untouched', () => {
    expect(getBlobStorageMaxBytes(kvEnv(), KV_MAX_OBJECT_BYTES * 4)).toBe(KV_MAX_OBJECT_BYTES);
    expect(getBlobStorageMaxBytes(kvEnv(), 1024)).toBe(1024);
    expect(getBlobStorageMaxBytes(r2Env(), KV_MAX_OBJECT_BYTES * 4)).toBe(KV_MAX_OBJECT_BYTES * 4);
  });

  it('builds attachment and send object keys', () => {
    expect(getAttachmentObjectKey('c1', 'a1')).toBe('c1/a1');
    expect(getSendFileObjectKey('s1', 'f1')).toBe('sends/s1/f1');
  });
});

describe('KV blob round-trip', () => {
  it('stores and reads back a blob with its metadata', async () => {
    const k = key();
    const bytes = new TextEncoder().encode('hello kv world');
    await putBlobObject(kvEnv(), k, bytes, {
      size: bytes.byteLength,
      contentType: 'text/plain',
      customMetadata: { cipherId: 'c1' },
    });

    const obj = await getBlobObject(kvEnv(), k);
    expect(obj).not.toBeNull();
    expect(obj!.size).toBe(bytes.byteLength);
    expect(obj!.contentType).toBe('text/plain');
    const read = new Uint8Array(await new Response(obj!.body).arrayBuffer());
    expect(new TextDecoder().decode(read)).toBe('hello kv world');
  });

  it('defaults the content type and derives size from bytes when metadata is absent', async () => {
    const k = key();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    // size 0 in metadata forces the byteLength fallback on read.
    await putBlobObject(kvEnv(), k, bytes, { size: 0 });

    const obj = await getBlobObject(kvEnv(), k);
    expect(obj!.size).toBe(5);
    expect(obj!.contentType).toBe('application/octet-stream');
  });

  it('returns null for a missing key', async () => {
    expect(await getBlobObject(kvEnv(), key())).toBeNull();
  });

  it('deletes a stored blob', async () => {
    const k = key();
    await putBlobObject(kvEnv(), k, new Uint8Array([9]), { size: 1 });
    expect(await getBlobObject(kvEnv(), k)).not.toBeNull();
    await deleteBlobObject(kvEnv(), k);
    expect(await getBlobObject(kvEnv(), k)).toBeNull();
  });

  it('rejects a KV object that exceeds the hard limit', async () => {
    await expect(
      putBlobObject(kvEnv(), key(), new Uint8Array([0]), { size: KV_MAX_OBJECT_BYTES + 1 })
    ).rejects.toThrow(/too large/i);
  });
});

describe('unconfigured storage', () => {
  it('throws when putting with no backend bound', async () => {
    await expect(putBlobObject(emptyEnv(), key(), new Uint8Array([0]), { size: 1 })).rejects.toThrow(/not configured/i);
  });

  it('returns null when getting with no backend bound', async () => {
    expect(await getBlobObject(emptyEnv(), key())).toBeNull();
  });

  it('is a no-op when deleting with no backend bound', async () => {
    await expect(deleteBlobObject(emptyEnv(), key())).resolves.toBeUndefined();
  });
});
