import { env } from 'cloudflare:test';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getConfigValue,
  isRegistered,
  setConfigValue,
  setRegistered,
} from '../../src/services/storage-config-repo';
import {
  consumeAttachmentDownloadToken,
  ensureUsedAttachmentDownloadTokenTable,
} from '../../src/services/storage-attachment-token-repo';

// Low-level storage repos driven directly against the real D1 binding — the
// config key/value + registration flag, and the used-download-token table
// including its periodic-cleanup branch. No mocks.
function db(): D1Database {
  return (env as any).DB;
}

beforeAll(async () => {
  // Trigger the worker's schema bootstrap so the config table exists.
  await SELF.fetch('https://vault.test/config');
});

describe('storage-config-repo', () => {
  it('round-trips config values and the registration flag', async () => {
    expect(await getConfigValue(db(), `missing-${crypto.randomUUID()}`)).toBeNull();

    const key = `k-${crypto.randomUUID()}`;
    await setConfigValue(db(), key, 'first');
    expect(await getConfigValue(db(), key)).toBe('first');
    // Upsert overwrites.
    await setConfigValue(db(), key, 'second');
    expect(await getConfigValue(db(), key)).toBe('second');

    await setRegistered(db());
    expect(await isRegistered(db())).toBe(true);
  });
});

describe('storage-attachment-token-repo', () => {
  it('consumes a token once and runs the periodic cleanup branch', async () => {
    await ensureUsedAttachmentDownloadTokenTable(db());
    const exp = Math.floor(Date.now() / 1000) + 3600;

    // First, seed an already-expired token directly.
    const expiredJti = `exp-${crypto.randomUUID()}`;
    await db().prepare('INSERT INTO used_attachment_download_tokens(jti, expires_at) VALUES(?, ?)')
      .bind(expiredJti, Date.now() - 10_000).run();

    // Consume a fresh token with cleanup forced on -> the expired row is purged.
    const jti = `jti-${crypto.randomUUID()}`;
    const first = await consumeAttachmentDownloadToken(db(), () => true, 0, 1000, jti, exp);
    expect(first.consumed).toBe(true);
    expect(typeof first.cleanedUpAt).toBe('number');

    // The expired token was removed, so its jti is free to be consumed again.
    const expiredRow = await db().prepare('SELECT jti FROM used_attachment_download_tokens WHERE jti = ?')
      .bind(expiredJti).first();
    expect(expiredRow).toBeNull();

    // Re-consuming the same jti (cleanup off) is a no-op: already used.
    const second = await consumeAttachmentDownloadToken(db(), () => false, Date.now(), 1000, jti, exp);
    expect(second.consumed).toBe(false);
    expect(second.cleanedUpAt).toBeNull();

    // A brand-new jti with cleanup off consumes successfully.
    const third = await consumeAttachmentDownloadToken(db(), () => false, Date.now(), 1000, `jti-${crypto.randomUUID()}`, exp);
    expect(third.consumed).toBe(true);
    expect(third.cleanedUpAt).toBeNull();
  });
});
