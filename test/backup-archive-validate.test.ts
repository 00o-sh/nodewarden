import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseBackupArchive, validateBackupPayloadContents } from '../src/services/backup-archive';

// Pure validation logic for restore: archive parsing and referential-integrity
// checks on the decoded payload. Deterministic — no bindings, no I/O.

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
  } as any;
}

const user = { id: 'u1', email: 'a@b.test' };

function payload(dbOverrides: Record<string, unknown> = {}) {
  return { manifest: { formatVersion: 1 } as any, db: db(dbOverrides) } as any;
}

function archive(manifest: unknown, dbValue: unknown, extra: Record<string, Uint8Array> = {}): Uint8Array {
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = { ...extra };
  if (manifest !== undefined) files['manifest.json'] = enc.encode(typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  if (dbValue !== undefined) files['db.json'] = enc.encode(typeof dbValue === 'string' ? dbValue : JSON.stringify(dbValue));
  return zipSync(files);
}

describe('validateBackupPayloadContents', () => {
  it('accepts an empty, well-formed payload', () => {
    expect(() => validateBackupPayloadContents(payload(), {})).not.toThrow();
  });

  it('rejects a non-array table', () => {
    expect(() => validateBackupPayloadContents(payload({ config: 'nope' }), {})).toThrow(/table config is invalid/i);
  });

  it('rejects invalid and duplicate user rows', () => {
    expect(() => validateBackupPayloadContents(payload({ users: [{ id: '', email: '' }] }), {})).toThrow(/invalid user row/i);
    expect(() => validateBackupPayloadContents(payload({ users: [user, { id: 'u1', email: 'c@d.test' }] }), {})).toThrow(/duplicate user id/i);
  });

  it('rejects an invalid config row', () => {
    expect(() => validateBackupPayloadContents(payload({ config: [{ key: '' }] }), {})).toThrow(/invalid config row/i);
  });

  it('rejects revisions and domain settings referencing unknown users', () => {
    expect(() => validateBackupPayloadContents(payload({ user_revisions: [{ user_id: 'ghost' }] }), {})).toThrow(/revision for an unknown user/i);
    expect(() => validateBackupPayloadContents(payload({ domain_settings: [{ user_id: 'ghost' }] }), {})).toThrow(/domain settings for an unknown user/i);
  });

  it('rejects invalid folder, cipher, and attachment rows', () => {
    expect(() => validateBackupPayloadContents(payload({ users: [user], folders: [{ id: 'f1', user_id: 'ghost' }] }), {})).toThrow(/invalid folder row/i);
    expect(() => validateBackupPayloadContents(payload({ users: [user], ciphers: [{ id: 'c1', user_id: 'ghost' }] }), {})).toThrow(/invalid cipher row/i);
    expect(() => validateBackupPayloadContents(payload({
      users: [user],
      ciphers: [{ id: 'c1', user_id: 'u1' }],
      attachments: [{ id: '', cipher_id: 'c1' }],
    }), {})).toThrow(/invalid attachment row/i);
  });

  it('rejects a duplicate cipher id', () => {
    expect(() => validateBackupPayloadContents(payload({
      users: [user],
      ciphers: [{ id: 'c1', user_id: 'u1' }, { id: 'c1', user_id: 'u1' }],
    }), {})).toThrow(/duplicate cipher id/i);
  });
});

describe('parseBackupArchive', () => {
  it('parses a well-formed archive', () => {
    const bytes = archive({ formatVersion: 1 }, db());
    const parsed = parseBackupArchive(bytes);
    expect(parsed.payload.manifest.formatVersion).toBe(1);
    expect(parsed.files['db.json']).toBeTruthy();
  });

  it('rejects non-zip bytes', () => {
    expect(() => parseBackupArchive(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/Invalid backup archive/i);
  });

  it('rejects an archive missing manifest.json or db.json', () => {
    const bytes = zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify({ formatVersion: 1 })) });
    expect(() => parseBackupArchive(bytes)).toThrow(/missing manifest.json or db.json/i);
  });

  it('rejects invalid JSON metadata', () => {
    expect(() => parseBackupArchive(archive('{bad', db()))).toThrow(/invalid JSON metadata/i);
  });

  it('rejects an unsupported format version', () => {
    expect(() => parseBackupArchive(archive({ formatVersion: 2 }, db()))).toThrow(/Unsupported backup format version/i);
  });

  it('rejects an archive missing a required attachment file', () => {
    const value = db({
      users: [user],
      ciphers: [{ id: 'c1', user_id: 'u1' }],
      attachments: [{ id: 'a1', cipher_id: 'c1' }],
    });
    // db.json references an attachment but the .bin entry is absent.
    expect(() => parseBackupArchive(archive({ formatVersion: 1 }, value))).toThrow(/missing required file: attachments\/c1\/a1\.bin/i);
  });
});
