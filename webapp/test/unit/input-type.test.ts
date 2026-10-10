import { describe, expect, it } from 'vitest';
import { inputTypeProps } from '@/lib/input-type';

describe('inputTypeProps', () => {
  it('returns the first type when the condition holds', () => {
    expect(inputTypeProps(true, 'text', 'password')).toEqual({ type: 'text' });
  });

  it('returns the second type when the condition does not hold', () => {
    expect(inputTypeProps(false, 'text', 'password')).toEqual({ type: 'password' });
  });
});
