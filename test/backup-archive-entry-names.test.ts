import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  isSafeBackupAttachmentBlobName,
  parseBackupArchive,
} from '../src/services/backup-archive';

// The archive entry-name allow-list is the anti-path-traversal / anti-zip-slip
// gate applied to every ZIP entry during unzip. Only manifest.json, db.json, and
// attachments/<cipher>/<attachment>.bin (two safe path segments) are permitted.
// Pure logic — deterministic, no bindings.

const enc = new TextEncoder();

function db(overrides: Record<string, unknown> = {}) {
  return {
    config: [],
    users: [],
    user_revisions: [],
    domain_settings: [],
    folders: [],
    ciphers: [],
    attachments: [],
    webauthn_credentials: [],
    trusted_two_factor_device_tokens: [],
    ...overrides,
  };
}

function withCore(extra: Record<string, Uint8Array>, manifest: unknown = { formatVersion: 1 }): Uint8Array {
  return zipSync({
    'manifest.json': enc.encode(JSON.stringify(manifest)),
    'db.json': enc.encode(JSON.stringify(db())),
    ...extra,
  });
}

describe('isSafeBackupAttachmentBlobName', () => {
  it('accepts exactly two safe path segments', () => {
    expect(isSafeBackupAttachmentBlobName('cipher1/attach1')).toBe(true);
    expect(isSafeBackupAttachmentBlobName('a_b.c-1/x.bin')).toBe(true);
  });

  it('rejects the wrong number of segments', () => {
    expect(isSafeBackupAttachmentBlobName('single')).toBe(false);
    expect(isSafeBackupAttachmentBlobName('a/b/c')).toBe(false);
    expect(isSafeBackupAttachmentBlobName('')).toBe(false);
  });

  it('rejects traversal, empty, and disallowed characters in a segment', () => {
    expect(isSafeBackupAttachmentBlobName('a/..')).toBe(false);
    expect(isSafeBackupAttachmentBlobName('../a')).toBe(false);
    expect(isSafeBackupAttachmentBlobName('a/')).toBe(false); // empty second segment
    expect(isSafeBackupAttachmentBlobName('a/b c')).toBe(false); // space is not allowed
    expect(isSafeBackupAttachmentBlobName('a/b?c')).toBe(false);
  });

  it('rejects a segment longer than the 128-char cap', () => {
    expect(isSafeBackupAttachmentBlobName(`a/${'x'.repeat(129)}`)).toBe(false);
    expect(isSafeBackupAttachmentBlobName(`a/${'x'.repeat(128)}`)).toBe(true);
  });

  it('rejects non-string input', () => {
    expect(isSafeBackupAttachmentBlobName(null)).toBe(false);
    expect(isSafeBackupAttachmentBlobName(undefined)).toBe(false);
    expect(isSafeBackupAttachmentBlobName(123)).toBe(false);
  });
});

describe('parseBackupArchive — unsafe entry names', () => {
  it('rejects an unsupported top-level file', () => {
    expect(() => parseBackupArchive(withCore({ 'evil.txt': enc.encode('x') }))).toThrow(/unsupported file: evil\.txt/i);
  });

  it('rejects an entry with a leading slash', () => {
    expect(() => parseBackupArchive(withCore({ '/db.json': enc.encode('{}') }))).toThrow(/unsafe file name/i);
  });

  it('rejects an entry with a doubled slash', () => {
    expect(() => parseBackupArchive(withCore({ 'attachments//a.bin': enc.encode('x') }))).toThrow(/unsafe file name/i);
  });

  it('rejects an entry containing a backslash', () => {
    expect(() => parseBackupArchive(withCore({ 'attachments\\c\\a.bin': enc.encode('x') }))).toThrow(/unsafe file name/i);
  });

  it('rejects an attachment entry with too many path segments', () => {
    expect(() => parseBackupArchive(withCore({ 'attachments/c/sub/a.bin': enc.encode('x') }))).toThrow(/unsupported file/i);
  });

  it('rejects an attachment entry whose segment is not extension-.bin', () => {
    // attachments/<...> that does not end with .bin is unsupported.
    expect(() => parseBackupArchive(withCore({ 'attachments/c/a.txt': enc.encode('x') }))).toThrow(/unsupported file/i);
  });
});

describe('parseBackupArchive — external attachment blobs option', () => {
  const user = { id: 'u1', email: 'a@b.test' };

  it('does not require the inline .bin when the manifest lists it as an external blob', () => {
    const value = db({
      users: [user],
      ciphers: [{ id: 'c1', user_id: 'u1' }],
      attachments: [{ id: 'a1', cipher_id: 'c1' }],
    });
    const manifest = {
      formatVersion: 1,
      attachmentBlobs: [{ cipherId: 'c1', attachmentId: 'a1', blobName: 'c1/a1', sizeBytes: 4 }],
    };
    const bytes = zipSync({
      'manifest.json': enc.encode(JSON.stringify(manifest)),
      'db.json': enc.encode(JSON.stringify(value)),
    });
    // Without the option the missing inline file is fatal.
    expect(() => parseBackupArchive(bytes)).toThrow(/missing required file/i);
    // With the option the attachment is expected to arrive out-of-band.
    const parsed = parseBackupArchive(bytes, { allowExternalAttachmentBlobs: true });
    expect(parsed.payload.db.attachments).toHaveLength(1);
  });
});
