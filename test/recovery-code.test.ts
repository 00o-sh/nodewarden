import { describe, expect, it } from 'vitest';
import { createRecoveryCode, recoveryCodeEquals } from '../src/utils/recovery-code';

describe('createRecoveryCode', () => {
  it('produces 32 base32 chars grouped into 8 blocks of 4', () => {
    const code = createRecoveryCode();
    expect(code).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    expect(code.replace(/ /g, '')).toHaveLength(32);
  });

  it('only uses the RFC 4648 base32 alphabet (no 0/1/8/9)', () => {
    for (let i = 0; i < 50; i++) {
      expect(createRecoveryCode().replace(/ /g, '')).toMatch(/^[A-Z2-7]{32}$/);
    }
  });

  it('is overwhelmingly likely to be unique across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(createRecoveryCode());
    expect(seen.size).toBe(100);
  });
});

describe('recoveryCodeEquals', () => {
  it('matches a code against itself', () => {
    const code = createRecoveryCode();
    expect(recoveryCodeEquals(code, code)).toBe(true);
  });

  it('ignores formatting, case and separators', () => {
    const stored = 'ABCD EFGH 2345 6789 ABCD EFGH 2345 6789';
    expect(recoveryCodeEquals('abcdefgh23456789abcdefgh23456789', stored)).toBe(true);
    expect(recoveryCodeEquals('abcd-efgh-2345-6789-abcd-efgh-2345-6789', stored)).toBe(true);
  });

  it('returns false for a different code (within the base32 alphabet)', () => {
    const stored = 'ABCD EFGH 2345 6722 ABCD EFGH 2345 6722';
    expect(recoveryCodeEquals('ABCD EFGH 2345 6722 ABCD EFGH 2345 6723', stored)).toBe(false);
  });

  it('returns false when the stored code is missing', () => {
    expect(recoveryCodeEquals('ABCDEFGH', null)).toBe(false);
    expect(recoveryCodeEquals('ABCDEFGH', undefined)).toBe(false);
    expect(recoveryCodeEquals('ABCDEFGH', '')).toBe(false);
  });

  it('returns false when normalized lengths differ', () => {
    expect(recoveryCodeEquals('ABCD', 'ABCDEFGH')).toBe(false);
  });
});
