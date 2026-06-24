import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// The worker auto-initializes its D1 schema on the first request. Schema drift
// is the single biggest risk when merging upstream, so assert the bootstrap
// produces the tables the app depends on and records the expected version.
describe('database bootstrap', () => {
  it('creates the full table set on first request', async () => {
    // Any worker-handled path triggers ensureDatabaseInitialized().
    const res = await SELF.fetch(url('/api/version'), { headers: baseHeaders() });
    expect(res.status).toBe(200);

    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all<{ name: string }>();
    const tables = new Set(results.map((r) => r.name));

    const expected = [
      'attachments',
      'audit_logs',
      'auth_requests',
      'ciphers',
      'config',
      'devices',
      'domain_settings',
      'folders',
      'invites',
      'login_attempts_ip',
      'refresh_tokens',
      'sends',
      'trusted_two_factor_device_tokens',
      'used_attachment_download_tokens',
      'user_revisions',
      'users',
      'webauthn_challenges',
      'webauthn_credentials',
    ];
    for (const table of expected) {
      expect(tables, `missing table: ${table}`).toContain(table);
    }
  });

  it('records the storage schema version in config', async () => {
    await SELF.fetch(url('/api/version'), { headers: baseHeaders() });
    const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'schema.version'")
      .first<{ value: string }>();
    // Pinning the version makes an upstream schema bump a deliberate, visible
    // change rather than a silent one.
    expect(row?.value).toBe('2026-06-23-totp-login-replay');
  });
});
