import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';

// The cron entry point. Invoked directly with a fake controller/ctx and the real
// test env — deterministic because no backup destination is due, so the
// scheduled scan initializes the DB, runs the (empty) due-scan, and returns
// without error. Covers the scheduled() handler and runScheduledBackupIfDue.
describe('worker scheduled (cron) handler', () => {
  it('runs the scheduled backup scan without error when nothing is due', async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const controller = {
      scheduledTime: Date.now(),
      cron: '*/30 * * * *',
      noRetry: () => {},
    } as unknown as ScheduledController;

    await worker.scheduled!(controller, env, ctx);

    // The handler scheduled the backup scan via ctx.waitUntil; it resolves cleanly.
    expect(pending.length).toBe(1);
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });
});
