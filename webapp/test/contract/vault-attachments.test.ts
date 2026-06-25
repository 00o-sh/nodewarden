import { beforeAll, describe, expect, it } from 'vitest';
import {
  createCipher,
  deleteCipherAttachment,
  downloadCipherAttachmentDecrypted,
  getAttachmentDownloadInfo,
  getCipherById,
  getCiphers,
  repairCipherAttachmentMetadata,
  repairCipherKeyMismatches,
  repairCipherUriChecksums,
  uploadCipherAttachment,
} from '@/lib/api/vault';
import { importCipherToDraft } from '@/lib/app-support';
import type { Cipher, VaultDraft } from '@/lib/types';
import { type ContractSession, freshCacheKey, registerAndLogin } from './helpers';

// Attachment + repair contract coverage for the vault api client driven through
// the REAL webapp crypto against the REAL worker (workerd/Miniflare with an R2
// ATTACHMENTS bucket + KV bound). These exercise the full encrypted-attachment
// round trip the app performs in a browser:
//   uploadCipherAttachment -> (worker stores ciphertext in R2/KV)
//   getAttachmentDownloadInfo + downloadCipherAttachmentDecrypted -> bytes back
//   deleteCipherAttachment
// plus the three vault "repair" sweeps (repairCipherUriChecksums,
// repairCipherKeyMismatches, repairCipherAttachmentMetadata) against real
// ciphers, proving the frontend's encrypt -> POST -> direct-upload -> download
// -> decrypt loop agrees with the backend handlers end to end.
//
// NOTE on the upload transport: uploadCipherAttachment posts attachment
// metadata to /attachment/v2 (the worker returns fileUploadType: 1 + a same-
// origin direct-upload URL), then PUTs the ciphertext bytes via
// uploadDirectEncryptedPayload -> uploadWithProgress. Under workerd there is no
// XMLHttpRequest, so uploadWithProgress falls back to global fetch, which the
// contract setup routes to SELF — so the real Azure-style direct-upload path is
// fully exercised here, not stubbed.
let ctx: ContractSession;

function loginDraft(over: Partial<Record<string, unknown>> = {}): VaultDraft {
  return importCipherToDraft(
    {
      type: 1,
      name: 'Attachment Host',
      login: { username: 'octocat', password: 'hunter2', uris: [{ uri: 'https://github.com' }] },
      ...over,
    },
    null
  );
}

function makeFile(name: string, bytes: Uint8Array): File {
  const copy = new Uint8Array(bytes);
  return new File([copy], name, { type: 'application/octet-stream' });
}

beforeAll(async () => {
  ctx = await registerAndLogin('vault-attachments');
});

describe('cipher attachment round-trip contract', () => {
  it('uploads an encrypted attachment, downloads + decrypts the exact bytes, then deletes it', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Has Attachment' }));
    expect(created.id).toBeTruthy();

    const fileName = 'secret-note.txt';
    const plaintext = new TextEncoder().encode('the launch codes are 0000 0000 — definitely real bytes');
    const file = makeFile(fileName, plaintext);

    // Drives /attachment/v2 (metadata) -> direct upload PUT of the ciphertext.
    await expect(
      uploadCipherAttachment(ctx.authedFetch, ctx.session, created.id, file, created)
    ).resolves.toBeUndefined();

    // The cipher now carries an attachment with a server-assigned id.
    const fetched = await getCipherById(ctx.authedFetch, created.id);
    expect(Array.isArray(fetched.attachments)).toBe(true);
    expect(fetched.attachments!.length).toBe(1);
    const attachmentId = String(fetched.attachments![0].id || '').trim();
    expect(attachmentId).toBeTruthy();

    // getAttachmentDownloadInfo returns a usable, same-origin download URL + the
    // wrapped attachment key the client needs to decrypt.
    const info = await getAttachmentDownloadInfo(ctx.authedFetch, created.id, attachmentId);
    expect(info.id).toBe(attachmentId);
    expect(info.url).toContain('/api/attachments/');
    expect(info.key).toBeTruthy();

    // Full decrypt round trip: bytes back out must equal the original plaintext,
    // and the file name must decrypt back to the original.
    const result = await downloadCipherAttachmentDecrypted(
      ctx.authedFetch,
      ctx.session,
      fetched,
      attachmentId
    );
    expect(result.fileName).toBe(fileName);
    expect(Array.from(result.bytes)).toEqual(Array.from(plaintext));

    // Clean up: delete the attachment; it should vanish from the cipher.
    await expect(
      deleteCipherAttachment(ctx.authedFetch, created.id, attachmentId)
    ).resolves.toBeUndefined();

    const afterDelete = await getCipherById(ctx.authedFetch, created.id);
    expect((afterDelete.attachments || []).some((a) => a.id === attachmentId)).toBe(false);

    // The download token endpoint should now 404 for the removed attachment.
    await expect(
      getAttachmentDownloadInfo(ctx.authedFetch, created.id, attachmentId)
    ).rejects.toThrow();
  });

  it('downloads attachments larger than one stream chunk intact', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Big Attachment' }));

    // ~40KB of pseudo-random bytes so a truncated/garbled round trip would fail.
    const plaintext = new Uint8Array(40 * 1024);
    for (let i = 0; i < plaintext.length; i += 1) plaintext[i] = (i * 31 + 7) & 0xff;
    const file = makeFile('blob.bin', plaintext);

    await uploadCipherAttachment(ctx.authedFetch, ctx.session, created.id, file, created);

    const fetched = await getCipherById(ctx.authedFetch, created.id);
    const attachmentId = String(fetched.attachments![0].id || '').trim();

    const result = await downloadCipherAttachmentDecrypted(
      ctx.authedFetch,
      ctx.session,
      fetched,
      attachmentId
    );
    expect(result.bytes.byteLength).toBe(plaintext.byteLength);
    expect(Array.from(result.bytes)).toEqual(Array.from(plaintext));

    await deleteCipherAttachment(ctx.authedFetch, created.id, attachmentId);
  });
});

describe('repairCipherAttachmentMetadata contract', () => {
  it('rewrites the stored fileName + key for a real attachment', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Metadata Repair' }));
    const file = makeFile('original.txt', new TextEncoder().encode('payload'));
    await uploadCipherAttachment(ctx.authedFetch, ctx.session, created.id, file, created);

    const fetched = await getCipherById(ctx.authedFetch, created.id);
    const attachmentId = String(fetched.attachments![0].id || '').trim();
    const before = await getAttachmentDownloadInfo(ctx.authedFetch, created.id, attachmentId);

    // The metadata endpoint accepts already-encrypted (cipher-string) values; we
    // just prove the PUT path round-trips by reusing the attachment's own
    // fileName/key (a valid no-data-loss repair) and re-reading them.
    const newFileName = String(fetched.attachments![0].fileName || '');
    await expect(
      repairCipherAttachmentMetadata(ctx.authedFetch, created.id, attachmentId, {
        fileName: newFileName,
        key: before.key,
      })
    ).resolves.toBeUndefined();

    const after = await getAttachmentDownloadInfo(ctx.authedFetch, created.id, attachmentId);
    expect(after.fileName).toBe(newFileName);
    expect(after.key).toBe(before.key);

    await deleteCipherAttachment(ctx.authedFetch, created.id, attachmentId);
  });

  it('rejects metadata updates for a non-existent attachment', async () => {
    const created = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Metadata Miss' }));
    await expect(
      repairCipherAttachmentMetadata(ctx.authedFetch, created.id, crypto.randomUUID(), { fileName: 'x.txt' })
    ).rejects.toThrow();
  });
});

describe('cipher repair sweeps contract', () => {
  it('repairCipherUriChecksums is a clean no-op for app-created ciphers (checksums already valid)', async () => {
    // createCipher already writes a correct uriChecksum for each login URI, so the
    // sweep must find nothing to fix and return 0 without erroring.
    const a = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'URI A' }));
    const b = await createCipher(
      ctx.authedFetch,
      ctx.session,
      loginDraft({ name: 'URI B', login: { username: 'u', password: 'p', uris: [{ uri: 'https://example.org' }] } })
    );

    const fresh = await getCiphers(ctx.authedFetch, freshCacheKey());
    const subset = fresh.filter((c): c is Cipher => c.id === a.id || c.id === b.id);
    expect(subset.length).toBe(2);

    const repaired = await repairCipherUriChecksums(ctx.authedFetch, ctx.session, subset);
    expect(repaired).toBe(0);
  });

  it('repairCipherUriChecksums returns 0 for empty input (guard)', async () => {
    await expect(repairCipherUriChecksums(ctx.authedFetch, ctx.session, [])).resolves.toBe(0);
  });

  it('repairCipherKeyMismatches is a clean no-op for app-created ciphers (no item-level key)', async () => {
    // App-created ciphers have no per-item key (cipher.key is null), so the
    // mismatch scan skips them all and returns 0.
    const a = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Key A' }));
    const b = await createCipher(ctx.authedFetch, ctx.session, loginDraft({ name: 'Key B' }));

    const fresh = await getCiphers(ctx.authedFetch, freshCacheKey());
    const subset = fresh.filter((c): c is Cipher => c.id === a.id || c.id === b.id);
    expect(subset.length).toBe(2);
    expect(subset.every((c) => !c.key)).toBe(true);

    const repaired = await repairCipherKeyMismatches(ctx.authedFetch, ctx.session, subset);
    expect(repaired).toBe(0);
  });

  it('repairCipherKeyMismatches returns 0 for empty input (guard)', async () => {
    await expect(repairCipherKeyMismatches(ctx.authedFetch, ctx.session, [])).resolves.toBe(0);
  });
});
