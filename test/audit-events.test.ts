import { describe, expect, it } from 'vitest';
import { auditRequestMetadata, normalizeAuditLogSettings } from '../src/services/audit-events';

// Pure audit-log helpers: settings normalization (allow-listed values, the
// retention-vs-maxEntries precedence, explicit "off" sentinels, and the
// default fallback) and request-metadata extraction. Deterministic — real
// Request objects, no mocks.

describe('normalizeAuditLogSettings', () => {
  it('accepts an allow-listed retentionDays and nulls maxEntries', () => {
    expect(normalizeAuditLogSettings({ retentionDays: 30, maxEntries: 5000 })).toEqual({
      retentionDays: 30,
      maxEntries: null,
    });
  });

  it('accepts an allow-listed maxEntries when no retention is set', () => {
    expect(normalizeAuditLogSettings({ maxEntries: 5000 })).toEqual({
      retentionDays: null,
      maxEntries: 5000,
    });
  });

  it('treats explicit null/0/"0" retentionDays as fully disabled', () => {
    for (const off of [null, 0, '0']) {
      expect(normalizeAuditLogSettings({ retentionDays: off })).toEqual({ retentionDays: null, maxEntries: null });
    }
  });

  it('treats explicit null/0 maxEntries (no retention) as fully disabled', () => {
    expect(normalizeAuditLogSettings({ maxEntries: 0 })).toEqual({ retentionDays: null, maxEntries: null });
  });

  it('falls back to defaults for unrecognised values and non-objects', () => {
    expect(normalizeAuditLogSettings({ retentionDays: 999, maxEntries: 7 })).toEqual({ retentionDays: 90, maxEntries: null });
    expect(normalizeAuditLogSettings('nope')).toEqual({ retentionDays: 90, maxEntries: null });
    expect(normalizeAuditLogSettings(undefined)).toEqual({ retentionDays: 90, maxEntries: null });
  });

  it('accepts the "forever"/"unlimited" sentinels as disabled', () => {
    expect(normalizeAuditLogSettings({ retentionDays: 'forever', maxEntries: 'unlimited' })).toEqual({
      retentionDays: 90,
      maxEntries: null,
    });
  });
});

describe('auditRequestMetadata', () => {
  function req(headers: Record<string, string>): Request {
    return new Request('https://vault.test/api/admin/thing?x=1', { method: 'DELETE', headers });
  }

  it('captures method, path, CF-Connecting-IP and User-Agent', () => {
    expect(auditRequestMetadata(req({ 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'nw-test' }))).toEqual({
      method: 'DELETE',
      path: '/api/admin/thing',
      ip: '203.0.113.9',
      userAgent: 'nw-test',
    });
  });

  it('falls back to X-Forwarded-For and nulls a missing User-Agent', () => {
    expect(auditRequestMetadata(req({ 'X-Forwarded-For': '198.51.100.4' }))).toEqual({
      method: 'DELETE',
      path: '/api/admin/thing',
      ip: '198.51.100.4',
      userAgent: null,
    });
  });

  it('nulls the ip when neither header is present', () => {
    const meta = auditRequestMetadata(req({}));
    expect(meta.ip).toBeNull();
    expect(meta.userAgent).toBeNull();
  });
});
