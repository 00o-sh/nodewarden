import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseBackupArchive, validateBackupPayloadContents } from '../../src/services/backup-archive';

// parseBackupArchive + validateBackupPayloadContents are pure functions, so each
// structural / referential-integrity guard is exercised directly with a crafted
// archive or payload. Real fflate zips, no mocks.

type Row = Record<string, unknown>;

function emptyDb(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
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

function zip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries);
}

function jsonEntry(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value));
}

const validManifest = { formatVersion: 1, attachmentBlobs: [] as unknown[] };

function validArchive(db: Record<string, unknown> = emptyDb()): Uint8Array {
  return zip({ 'manifest.json': jsonEntry(validManifest), 'db.json': jsonEntry({ ...db }) });
}

describe('parseBackupArchive structural guards', () => {
  it('parses a minimal valid archive', () => {
    const { payload, files } = parseBackupArchive(validArchive());
    expect(payload.manifest.formatVersion).toBe(1);
    expect(files['db.json']).toBeTruthy();
  });

  it('rejects bytes that are not a zip', () => {
    expect(() => parseBackupArchive(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/Invalid backup archive/);
  });

  it('rejects an archive missing db.json', () => {
    expect(() => parseBackupArchive(zip({ 'manifest.json': jsonEntry(validManifest) }))).toThrow(/missing manifest.json or db.json/);
  });

  it('rejects invalid JSON metadata', () => {
    expect(() => parseBackupArchive(zip({ 'manifest.json': strToU8('not json{'), 'db.json': jsonEntry(emptyDb()) }))).toThrow(/invalid JSON metadata/);
  });

  it('rejects an unsupported format version', () => {
    expect(() => parseBackupArchive(zip({ 'manifest.json': jsonEntry({ formatVersion: 99 }), 'db.json': jsonEntry(emptyDb()) }))).toThrow(/Unsupported backup format version/);
  });

  it('rejects a non-object database payload', () => {
    expect(() => parseBackupArchive(zip({ 'manifest.json': jsonEntry(validManifest), 'db.json': strToU8('null') }))).toThrow(/database payload is invalid/);
  });

  it('rejects an archive missing a referenced attachment blob', () => {
    const db = emptyDb({ attachments: [{ id: 'att1', cipher_id: 'cip1' }] });
    expect(() => parseBackupArchive(validArchive(db))).toThrow(/missing required file: attachments\/cip1\/att1.bin/);
  });
});

describe('validateBackupPayloadContents referential integrity', () => {
  const user: Row = { id: 'u1', email: 'a@example.com' };
  function check(db: Record<string, unknown>, files: Record<string, Uint8Array> = {}): () => void {
    return () => validateBackupPayloadContents({ manifest: validManifest as any, db: db as any }, files);
  }

  it('accepts a consistent payload', () => {
    expect(check(emptyDb({ users: [user], folders: [{ id: 'f1', user_id: 'u1' }], ciphers: [{ id: 'c1', user_id: 'u1', folder_id: 'f1' }] }))).not.toThrow();
  });

  it('rejects a non-array table', () => {
    expect(check(emptyDb({ config: 'oops' }))).toThrow(/table config is invalid/);
  });

  it('rejects an invalid user row', () => {
    expect(check(emptyDb({ users: [{ id: '', email: '' }] }))).toThrow(/invalid user row/);
  });

  it('rejects a duplicate user id', () => {
    expect(check(emptyDb({ users: [user, { id: 'u1', email: 'b@example.com' }] }))).toThrow(/duplicate user id/);
  });

  it('rejects an invalid config row', () => {
    expect(check(emptyDb({ config: [{ key: '' }] }))).toThrow(/invalid config row/);
  });

  it('rejects a revision for an unknown user', () => {
    expect(check(emptyDb({ user_revisions: [{ user_id: 'ghost' }] }))).toThrow(/revision for an unknown user/);
  });

  it('rejects domain settings for an unknown user', () => {
    expect(check(emptyDb({ domain_settings: [{ user_id: 'ghost' }] }))).toThrow(/domain settings for an unknown user/);
  });

  it('rejects duplicate domain settings for a user', () => {
    expect(check(emptyDb({ users: [user], domain_settings: [{ user_id: 'u1' }, { user_id: 'u1' }] }))).toThrow(/duplicate domain settings/);
  });

  it('rejects an invalid folder row', () => {
    expect(check(emptyDb({ users: [user], folders: [{ id: '', user_id: 'u1' }] }))).toThrow(/invalid folder row/);
  });

  it('rejects a duplicate folder id', () => {
    expect(check(emptyDb({ users: [user], folders: [{ id: 'f1', user_id: 'u1' }, { id: 'f1', user_id: 'u1' }] }))).toThrow(/duplicate folder id/);
  });

  it('rejects an invalid cipher row', () => {
    expect(check(emptyDb({ users: [user], ciphers: [{ id: '', user_id: 'u1' }] }))).toThrow(/invalid cipher row/);
  });

  it('rejects a cipher for an unknown folder', () => {
    expect(check(emptyDb({ users: [user], ciphers: [{ id: 'c1', user_id: 'u1', folder_id: 'ghost' }] }))).toThrow(/cipher for an unknown folder/);
  });

  it('rejects a duplicate cipher id', () => {
    expect(check(emptyDb({ users: [user], ciphers: [{ id: 'c1', user_id: 'u1' }, { id: 'c1', user_id: 'u1' }] }))).toThrow(/duplicate cipher id/);
  });

  it('rejects an invalid attachment row', () => {
    expect(check(emptyDb({ users: [user], attachments: [{ id: '', cipher_id: '' }] }))).toThrow(/invalid attachment row/);
  });

  it('rejects an attachment missing its blob file', () => {
    expect(check(emptyDb({ users: [user], ciphers: [{ id: 'c1', user_id: 'u1' }], attachments: [{ id: 'a1', cipher_id: 'c1' }] }))).toThrow(/missing required file/);
  });

  it('rejects an invalid account passkey row', () => {
    expect(check(emptyDb({ users: [user], webauthn_credentials: [{ id: '', user_id: 'u1', credential_id: '', public_key: '' }] }))).toThrow(/invalid account passkey row/);
  });

  it('rejects an invalid trusted two-factor token row', () => {
    expect(check(emptyDb({ users: [user], trusted_two_factor_device_tokens: [{ token: '', user_id: 'u1', device_identifier: '', expires_at: 0 }] }))).toThrow(/invalid trusted two-factor device token row/);
  });
});
