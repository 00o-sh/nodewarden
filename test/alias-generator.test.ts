import { describe, expect, it } from 'vitest';
import {
  buildAliasAddress,
  isAliasGeneratorReady,
  sanitizeAliasSettings,
} from '../src/services/alias-generator';
import type { AliasGeneratorSettings, Env } from '../src/types';

const fakeEnv = {} as Env;

describe('sanitizeAliasSettings', () => {
  it('normalizes domains/recipients and derives defaults', () => {
    const s = sanitizeAliasSettings({
      enabled: true,
      // Mix in invalid entries to exercise every validation branch: no dot,
      // illegal label char, single-char TLD, over-length, and bad emails
      // (no '@', leading '@', multiple '@', whitespace local, invalid domain).
      domains: [
        'Alias.Test', '@mail.test', 'bad', 'alias.test',
        'foo_x.com', 'foo.c', `${'x'.repeat(260)}.com`,
      ],
      recipients: [
        'ME@Vault.Test', 'nope', 'two@vault.test',
        '@x.com', 'a@b@c.com', 'a b@c.com', 'a@bad',
      ],
    });
    expect(s.enabled).toBe(true);
    expect(s.domains).toEqual(['alias.test', 'mail.test']);
    expect(s.defaultDomain).toBe('alias.test');
    expect(s.recipients).toEqual(['me@vault.test', 'two@vault.test']);
    expect(s.defaultDestination).toBe('me@vault.test');
  });

  it('keeps an explicit default domain only if it is in the list', () => {
    const s = sanitizeAliasSettings({
      domains: ['a.test', 'b.test'],
      defaultDomain: 'b.test',
      defaultDestination: 'x@y.test',
    });
    expect(s.defaultDomain).toBe('b.test');
    expect(s.defaultDestination).toBe('x@y.test');
    expect(s.enabled).toBe(false);
  });

  it('falls back gracefully on empty/garbage input', () => {
    const s = sanitizeAliasSettings(null);
    expect(s.domains).toEqual([]);
    expect(s.defaultDomain).toBeNull();
    expect(s.defaultDestination).toBeNull();
  });
});

const settings: AliasGeneratorSettings = {
  enabled: true,
  domains: ['alias.test', 'mail.test'],
  defaultDomain: 'alias.test',
  defaultDestination: 'inbox@vault.test',
  recipients: ['inbox@vault.test'],
};

describe('buildAliasAddress', () => {
  it('uses the default domain with random characters by default', () => {
    const { address, domain } = buildAliasAddress(settings, {});
    expect(domain).toBe('alias.test');
    expect(address.endsWith('@alias.test')).toBe(true);
    expect(address.split('@')[0]).toMatch(/^[a-f0-9]{16}$/);
  });

  it('honors an allowed requested domain and uuid format', () => {
    const { address } = buildAliasAddress(settings, { domain: 'mail.test', format: 'uuid' });
    expect(address.endsWith('@mail.test')).toBe(true);
  });

  it('supports random_words format', () => {
    const { address } = buildAliasAddress(settings, { format: 'random_words' });
    expect(address.split('@')[0]).toMatch(/^[a-z]+\.[a-z]+\.\d+$/);
  });

  it('accepts a sanitized custom local part', () => {
    const { address } = buildAliasAddress(settings, { format: 'custom', localPart: 'My.Alias_1' });
    expect(address).toBe('my.alias_1@alias.test');
  });

  it('rejects a disallowed domain', () => {
    expect(() => buildAliasAddress(settings, { domain: 'evil.example' })).toThrow(/not in the configured/);
  });

  it('rejects custom format without a local part', () => {
    expect(() => buildAliasAddress(settings, { format: 'custom' })).toThrow(/local part is required/);
  });

  it('rejects an invalid custom local part', () => {
    expect(() => buildAliasAddress(settings, { format: 'custom', localPart: 'has space!' })).toThrow(/Invalid local part/);
  });

  it('throws when no domain is configured', () => {
    const empty: AliasGeneratorSettings = { ...settings, domains: [], defaultDomain: null };
    expect(() => buildAliasAddress(empty, {})).toThrow(/No alias domain/);
  });
});

describe('isAliasGeneratorReady', () => {
  it('is ready when enabled with a default domain', () => {
    expect(isAliasGeneratorReady(fakeEnv, settings)).toBe(true);
  });
  it('is not ready when disabled or domainless', () => {
    expect(isAliasGeneratorReady(fakeEnv, { ...settings, enabled: false })).toBe(false);
    expect(isAliasGeneratorReady(fakeEnv, { ...settings, domains: [], defaultDomain: null })).toBe(false);
  });
});
