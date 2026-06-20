import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { RateLimitService } from '../../src/services/ratelimit';
import { LIMITS } from '../../src/config/limits';

// Rate limiting is a security control; exercise it against the real D1
// (login lockout) and Cache API (fixed-window budget) bindings.
const rl = new RateLimitService(env.DB);

beforeAll(async () => {
  // Login attempts use a dedicated table created on demand; trigger it once.
  await rl.checkLoginAttempt('warmup');
});

describe('login lockout (D1-backed)', () => {
  it('locks an IP after the max failed attempts and clears on success', async () => {
    const ip = `ip4:${crypto.randomUUID().slice(0, 8)}`;
    expect((await rl.checkLoginAttempt(ip)).allowed).toBe(true);

    // Record failures up to the threshold.
    for (let i = 0; i < LIMITS.rateLimit.loginMaxAttempts; i++) {
      await rl.recordFailedLogin(ip);
    }

    const locked = await rl.checkLoginAttempt(ip);
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);

    // A successful login clears the counter.
    await rl.clearLoginAttempts(ip);
    expect((await rl.checkLoginAttempt(ip)).allowed).toBe(true);
  });

  it('reports decreasing remaining attempts before lockout', async () => {
    const ip = `ip4:${crypto.randomUUID().slice(0, 8)}`;
    await rl.recordFailedLogin(ip);
    const after = await rl.checkLoginAttempt(ip);
    expect(after.allowed).toBe(true);
    expect(after.remainingAttempts).toBe(LIMITS.rateLimit.loginMaxAttempts - 1);
  });
});

describe('fixed-window budget (Cache API-backed)', () => {
  it('allows up to the budget then blocks within the window', async () => {
    const id = `budget-${crypto.randomUUID()}`;
    const max = 3;

    for (let i = 0; i < max; i++) {
      const res = await rl.consumeBudget(id, max);
      expect(res.allowed).toBe(true);
    }

    const blocked = await rl.consumeBudget(id, max);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks separate identifiers independently', async () => {
    const a = `budget-${crypto.randomUUID()}`;
    const b = `budget-${crypto.randomUUID()}`;
    expect((await rl.consumeBudget(a, 1)).allowed).toBe(true);
    expect((await rl.consumeBudget(a, 1)).allowed).toBe(false);
    // A different identifier still has its full budget.
    expect((await rl.consumeBudget(b, 1)).allowed).toBe(true);
  });
});
