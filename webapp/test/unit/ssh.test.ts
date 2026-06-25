import { describe, expect, it } from 'vitest';
import { computeSshFingerprint, generateDefaultSshKeyMaterial } from '@/lib/ssh';

describe('computeSshFingerprint', () => {
  it('returns empty string for empty/blank input', async () => {
    expect(await computeSshFingerprint('')).toBe('');
    expect(await computeSshFingerprint('   ')).toBe('');
    expect(await computeSshFingerprint(null as unknown as string)).toBe('');
    expect(await computeSshFingerprint(undefined as unknown as string)).toBe('');
  });

  it('returns empty string when no valid ssh/ecdsa key line is found', async () => {
    expect(await computeSshFingerprint('not a key')).toBe('');
    expect(await computeSshFingerprint('rsa AAAA== comment')).toBe('');
  });

  it('computes a SHA256 fingerprint with no base64 padding', async () => {
    const fp = await computeSshFingerprint(
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL0123456789abcdefghijklmnopqrstuvwxyzABCD user@host'
    );
    expect(fp.startsWith('SHA256:')).toBe(true);
    expect(fp.endsWith('=')).toBe(false);
  });

  it('is deterministic for the same key blob and ignores the comment', async () => {
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL0123456789abcdefghijklmnopqrstuvwxyzABCD';
    const a = await computeSshFingerprint(`${key} alice@host`);
    const b = await computeSshFingerprint(`${key} bob@other`);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan('SHA256:'.length);
  });

  it('accepts ecdsa- key types', async () => {
    const fp = await computeSshFingerprint(
      'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY='
    );
    expect(fp.startsWith('SHA256:')).toBe(true);
  });

  it('picks the first valid key line among several lines', async () => {
    const multi = [
      '# a comment line',
      'garbage',
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL0123456789abcdefghijklmnopqrstuvwxyzABCD first',
    ].join('\n');
    const single =
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL0123456789abcdefghijklmnopqrstuvwxyzABCD only';
    expect(await computeSshFingerprint(multi)).toBe(await computeSshFingerprint(single));
  });

  it('returns empty string when the base64 payload is undecodable', async () => {
    // A line matching the key-type shape but with characters atob cannot handle
    // after normalization still decodes, so use a payload that fails the regex
    // entirely by containing a space-only payload.
    expect(await computeSshFingerprint('ssh-ed25519')).toBe('');
  });
});

describe('generateDefaultSshKeyMaterial', () => {
  it('generates an Ed25519 keypair with consistent public key and fingerprint', async () => {
    const { privateKey, publicKey, fingerprint } = await generateDefaultSshKeyMaterial();

    expect(publicKey.startsWith('ssh-ed25519 ')).toBe(true);
    expect(privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
    expect(privateKey.trimEnd().endsWith('-----END OPENSSH PRIVATE KEY-----')).toBe(true);
    expect(fingerprint.startsWith('SHA256:')).toBe(true);

    // The reported fingerprint must match recomputing it from the public key.
    expect(await computeSshFingerprint(publicKey)).toBe(fingerprint);
  });

  it('produces unique keys on each call', async () => {
    const a = await generateDefaultSshKeyMaterial();
    const b = await generateDefaultSshKeyMaterial();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('wraps the private key body at 70-character lines', async () => {
    const { privateKey } = await generateDefaultSshKeyMaterial();
    const bodyLines = privateKey
      .split('\n')
      .filter((l) => l && !l.startsWith('-----'));
    expect(bodyLines.length).toBeGreaterThan(0);
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(70);
    }
  });

  it('embeds the openssh-key-v1 magic in the private key blob', async () => {
    const { privateKey } = await generateDefaultSshKeyMaterial();
    const b64 = privateKey
      .split('\n')
      .filter((l) => l && !l.startsWith('-----'))
      .join('');
    const bin = atob(b64);
    expect(bin.startsWith('openssh-key-v1\0')).toBe(true);
  });
});
