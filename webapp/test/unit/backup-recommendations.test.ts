import { describe, expect, it } from 'vitest';
import {
  RECOMMENDED_PROVIDERS,
  hasLinkedStorages,
} from '@/lib/backup-recommendations';
import type {
  KoofrProvider,
  RecommendedProvider,
} from '@/lib/backup-recommendations';

describe('RECOMMENDED_PROVIDERS', () => {
  it('includes the core providers and keeps ids unique', () => {
    const ids = RECOMMENDED_PROVIDERS.map((p) => p.id);
    // Assert the established providers are present without re-pinning the exact
    // list, so adding new recommended providers upstream doesn't break this.
    expect(ids).toEqual(expect.arrayContaining(['infinicloud', 'koofr', 'pcloud']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every provider the required base fields', () => {
    for (const provider of RECOMMENDED_PROVIDERS) {
      expect(typeof provider.name).toBe('string');
      expect(provider.name.length).toBeGreaterThan(0);
      expect(provider.capacity).toMatch(/^\d+G$/);
      expect(['webdav', 's3']).toContain(provider.protocol);
      expect(provider.signupUrl).toMatch(/^https:\/\//);
    }
  });

  it('configures the InfiniCLOUD provider with a referral code', () => {
    const infini = RECOMMENDED_PROVIDERS.find((p) => p.id === 'infinicloud');
    expect(infini).toMatchObject({
      id: 'infinicloud',
      name: 'InfiniCLOUD',
      capacity: '25G',
      protocol: 'webdav',
      referralCode: '2HC5E',
    });
  });

  it('configures Koofr with linked storages and admin urls', () => {
    const koofr = RECOMMENDED_PROVIDERS.find(
      (p): p is KoofrProvider => p.id === 'koofr'
    );
    expect(koofr).toBeDefined();
    expect(koofr?.passwordUrl).toContain('koofr.net');
    expect(koofr?.storageUrl).toContain('koofr.net');
    expect(koofr?.linkedStorages).toEqual([
      { name: 'Google Drive', capacity: '15G' },
      { name: 'OneDrive', capacity: '5G' },
      { name: 'Dropbox', capacity: '2G' },
    ]);
  });

  it('marks pCloud as having an affiliate link', () => {
    const pcloud = RECOMMENDED_PROVIDERS.find((p) => p.id === 'pcloud');
    expect(pcloud?.hasAffiliateLink).toBe(true);
  });
});

describe('hasLinkedStorages', () => {
  it('returns true only for the koofr provider', () => {
    for (const provider of RECOMMENDED_PROVIDERS) {
      expect(hasLinkedStorages(provider)).toBe(provider.id === 'koofr');
    }
  });

  it('narrows the type so linkedStorages is accessible', () => {
    const koofr = RECOMMENDED_PROVIDERS.find((p) => p.id === 'koofr') as RecommendedProvider;
    if (hasLinkedStorages(koofr)) {
      // Type guard narrows to KoofrProvider; this access is type-safe.
      expect(Array.isArray(koofr.linkedStorages)).toBe(true);
    } else {
      throw new Error('expected koofr to have linked storages');
    }
  });

  it('returns false for a non-koofr provider object', () => {
    const fake = { id: 'infinicloud' } as RecommendedProvider;
    expect(hasLinkedStorages(fake)).toBe(false);
  });
});
