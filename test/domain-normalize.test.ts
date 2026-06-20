import { describe, expect, it } from 'vitest';
import {
  isValidEquivalentDomain,
  normalizeEquivalentDomain,
} from '../shared/domain-normalize';

describe('normalizeEquivalentDomain', () => {
  it('reduces a simple host to its registrable domain', () => {
    expect(normalizeEquivalentDomain('example.com')).toBe('example.com');
    expect(normalizeEquivalentDomain('www.example.com')).toBe('example.com');
    expect(normalizeEquivalentDomain('a.b.c.example.com')).toBe('example.com');
  });

  it('strips scheme, path, query, port and userinfo', () => {
    expect(normalizeEquivalentDomain('https://www.example.com/login?x=1')).toBe('example.com');
    expect(normalizeEquivalentDomain('http://example.com:8080')).toBe('example.com');
    expect(normalizeEquivalentDomain('user:pass@sub.example.com')).toBe('example.com');
  });

  it('handles uppercase, whitespace and backslashes', () => {
    expect(normalizeEquivalentDomain('  WWW.Example.COM  ')).toBe('example.com');
    expect(normalizeEquivalentDomain('example.com\\path')).toBe('example.com');
  });

  it('strips wildcard and leading/trailing dots', () => {
    expect(normalizeEquivalentDomain('*.example.com')).toBe('example.com');
    expect(normalizeEquivalentDomain('.example.com')).toBe('example.com');
    expect(normalizeEquivalentDomain('example.com.')).toBe('example.com');
  });

  it('respects multi-label public suffixes', () => {
    expect(normalizeEquivalentDomain('foo.co.uk')).toBe('foo.co.uk');
    expect(normalizeEquivalentDomain('www.foo.co.uk')).toBe('foo.co.uk');
    expect(normalizeEquivalentDomain('a.b.example.com.cn')).toBe('example.com.cn');
    expect(normalizeEquivalentDomain('myapp.pages.dev')).toBe('myapp.pages.dev');
  });

  it('returns empty when the host is only a public suffix', () => {
    expect(normalizeEquivalentDomain('co.uk')).toBe('');
    expect(normalizeEquivalentDomain('pages.dev')).toBe('');
  });

  it('rejects invalid hosts', () => {
    expect(normalizeEquivalentDomain('')).toBe('');
    expect(normalizeEquivalentDomain('localhost')).toBe('');
    expect(normalizeEquivalentDomain('no-dot')).toBe('');
    expect(normalizeEquivalentDomain('a..b.com')).toBe('');
    expect(normalizeEquivalentDomain('exa mple.com')).toBe('');
  });

  it('rejects bare IPv4 addresses', () => {
    expect(normalizeEquivalentDomain('192.168.1.1')).toBe('');
    expect(normalizeEquivalentDomain('http://10.0.0.1:9000')).toBe('');
  });

  it('rejects IPv6 literals', () => {
    expect(normalizeEquivalentDomain('[::1]')).toBe('');
    expect(normalizeEquivalentDomain('http://[2001:db8::1]')).toBe('');
  });

  it('rejects labels longer than 63 chars and hosts longer than 253', () => {
    const longLabel = 'a'.repeat(64);
    expect(normalizeEquivalentDomain(`${longLabel}.com`)).toBe('');
    const longHost = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com`;
    expect(normalizeEquivalentDomain(longHost)).toBe('');
  });

  it('coerces non-string input safely', () => {
    expect(normalizeEquivalentDomain(null)).toBe('');
    expect(normalizeEquivalentDomain(undefined)).toBe('');
    expect(normalizeEquivalentDomain(12345)).toBe('');
  });
});

describe('isValidEquivalentDomain', () => {
  it('returns true for normalizable hosts', () => {
    expect(isValidEquivalentDomain('www.example.com')).toBe(true);
    expect(isValidEquivalentDomain('foo.co.uk')).toBe(true);
  });

  it('returns false for invalid hosts', () => {
    expect(isValidEquivalentDomain('localhost')).toBe(false);
    expect(isValidEquivalentDomain('co.uk')).toBe(false);
    expect(isValidEquivalentDomain('')).toBe(false);
  });
});
