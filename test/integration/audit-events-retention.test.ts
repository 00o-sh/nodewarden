import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  applyAuditLogRetention,
  getAuditLogSettings,
  saveAuditLogSettings,
  writeAuditEvent,
} from '../../src/services/audit-events';
import { StorageService } from '../../src/services/storage';
import { url } from './helpers';

// The storage-backed audit-event paths exercised against real D1: metadata
// sanitization on write, the settings round-trip (including the invalid-JSON
// fallback), and retention pruning. No mocks — a live StorageService over the
// test runtime's D1 binding.
function storage(): StorageService {
  return new StorageService((env as any).DB);
}

async function findByAction(action: string) {
  const { logs } = await storage().listAuditLogs({ limit: 50, offset: 0, q: action });
  return logs.filter((l) => l.action === action);
}

beforeAll(async () => {
  // Ensure the D1 schema is initialized before touching audit tables directly.
  await SELF.fetch(url('/config'));
});

describe('writeAuditEvent metadata sanitization', () => {
  it('keeps allow-listed scalars, collapses arrays, and drops the rest', async () => {
    const action = `test.sanitize.${crypto.randomUUID()}`;
    await writeAuditEvent(storage(), {
      actorUserId: null,
      action,
      category: 'system',
      metadata: {
        path: '/api/x', // allow-listed scalar -> kept
        ciphers: [1, 2, 3], // allow-listed array -> length
        secret: 'super-secret', // sensitive key -> dropped
        password: 'hunter2', // sensitive key -> dropped
        notAllowed: 'nope', // not allow-listed -> dropped
        reason: '', // empty -> dropped
      },
    });

    const [log] = await findByAction(action);
    expect(log).toBeTruthy();
    const meta = JSON.parse(log.metadata || '{}');
    expect(meta).toEqual({ path: '/api/x', ciphers: 3 });
  });

  it('truncates oversized metadata', async () => {
    const action = `test.truncate.${crypto.randomUUID()}`;
    await writeAuditEvent(storage(), {
      action,
      category: 'system',
      // "reason" is allow-listed and non-sensitive; an oversized value forces
      // the >2048-byte truncation path.
      metadata: { reason: 'x'.repeat(4000) },
    });

    const [log] = await findByAction(action);
    expect(JSON.parse(log.metadata || '{}')).toEqual({ truncated: true });
  });
});

describe('audit log settings', () => {
  it('round-trips normalized settings and falls back on invalid JSON', async () => {
    const s = storage();
    const saved = await saveAuditLogSettings(s, { retentionDays: 30, maxEntries: 5000 });
    expect(saved).toEqual({ retentionDays: 30, maxEntries: null });
    expect(await getAuditLogSettings(s)).toEqual({ retentionDays: 30, maxEntries: null });

    // Corrupt the stored value -> getAuditLogSettings returns defaults.
    await s.setConfigValue('audit.logs.settings.v1', '{not json');
    expect(await getAuditLogSettings(s)).toEqual({ retentionDays: 90, maxEntries: null });
  });
});

describe('applyAuditLogRetention', () => {
  it('prunes entries older than the retention window', async () => {
    const s = storage();
    const action = `test.retention.${crypto.randomUUID()}`;
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();

    await s.createAuditLog({
      id: crypto.randomUUID(), actorUserId: null, action, category: 'system', level: 'info',
      targetType: null, targetId: null, metadata: null, createdAt: old,
    });
    await s.createAuditLog({
      id: crypto.randomUUID(), actorUserId: null, action, category: 'system', level: 'info',
      targetType: null, targetId: null, metadata: null, createdAt: recent,
    });
    expect((await findByAction(action)).length).toBe(2);

    await applyAuditLogRetention(s, { retentionDays: 7, maxEntries: null });
    const remaining = await findByAction(action);
    expect(remaining.length).toBe(1);
    expect(remaining[0].createdAt).toBe(recent);
  });

  it('runs the maxEntries prune path without error', async () => {
    // Few rows, high cap -> no-op, but exercises the maxEntries branch.
    await expect(applyAuditLogRetention(storage(), { retentionDays: null, maxEntries: 5000 })).resolves.toBeUndefined();
  });
});
