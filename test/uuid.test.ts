import { describe, expect, it } from 'vitest';
import { generateUUID } from '../src/utils/uuid';

describe('generateUUID', () => {
  it('returns a valid RFC 4122 v4 UUID', () => {
    expect(generateUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('returns unique values', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateUUID()));
    expect(set.size).toBe(1000);
  });
});
