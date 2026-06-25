import { beforeAll, describe, expect, it } from 'vitest';
import { getDomainRules, saveDomainRules } from '@/lib/api/domains';
import { type ContractSession, registerAndLogin } from './helpers';

// Domain (equivalent-domains) rules driven through the real webapp api client
// against the real worker. Proves the frontend getDomainRules/saveDomainRules
// contract agrees with the backend: defaults on a fresh account, and a
// save -> get round-trip preserving the custom equivalent-domain groups.
let ctx: ContractSession;

beforeAll(async () => {
  ctx = await registerAndLogin('domains');
});

describe('domain rules contract', () => {
  it('returns the default/empty rule state for a fresh account', async () => {
    const rules = await getDomainRules(ctx.authedFetch);

    expect(rules.object).toBe('domains');
    // A brand-new account has no custom rules, so no derived equivalent groups.
    expect(rules.customEquivalentDomains).toEqual([]);
    expect(rules.equivalentDomains).toEqual([]);
    // The backend always ships the built-in global equivalent-domain catalogue,
    // none of which are excluded by default.
    expect(Array.isArray(rules.globalEquivalentDomains)).toBe(true);
    expect(rules.globalEquivalentDomains.length).toBeGreaterThan(0);
    expect(rules.globalEquivalentDomains.every((g) => g.excluded === false)).toBe(true);
  });

  it('round-trips a saved custom equivalent-domain group (save then get)', async () => {
    const group = ['example.com', 'example.net', 'example.org'];

    const saved = await saveDomainRules(ctx.authedFetch, {
      customEquivalentDomains: [{ id: '', domains: group, excluded: false }],
      equivalentDomains: [],
      excludedGlobalEquivalentDomains: [],
    });

    expect(saved.object).toBe('domains');
    expect(saved.customEquivalentDomains).toHaveLength(1);
    const savedRule = saved.customEquivalentDomains[0];
    expect(savedRule.domains).toEqual(group);
    expect(savedRule.excluded).toBe(false);
    expect(savedRule.id).toBeTruthy();

    // A fresh GET must reflect exactly what was persisted.
    const fetched = await getDomainRules(ctx.authedFetch);
    expect(fetched.customEquivalentDomains).toHaveLength(1);
    expect(fetched.customEquivalentDomains[0].domains).toEqual(group);
    expect(fetched.customEquivalentDomains[0].excluded).toBe(false);
    // Non-excluded custom rules are derived into the active equivalent groups.
    expect(fetched.equivalentDomains.some((eg) => group.every((d) => eg.includes(d)))).toBe(true);
  });

  it('round-trips excluding a global equivalent-domain type', async () => {
    const before = await getDomainRules(ctx.authedFetch);
    const target = before.globalEquivalentDomains[0];

    const saved = await saveDomainRules(ctx.authedFetch, {
      customEquivalentDomains: before.customEquivalentDomains,
      equivalentDomains: [],
      excludedGlobalEquivalentDomains: [target.type],
    });

    const excludedEntry = saved.globalEquivalentDomains.find((g) => g.type === target.type);
    expect(excludedEntry?.excluded).toBe(true);

    const fetched = await getDomainRules(ctx.authedFetch);
    expect(fetched.globalEquivalentDomains.find((g) => g.type === target.type)?.excluded).toBe(true);
  });
});
