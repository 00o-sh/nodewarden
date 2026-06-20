import { describe, expect, it } from 'vitest';
import {
  decodeContinuationToken,
  encodeContinuationToken,
  parsePagination,
} from '../src/utils/pagination';
import { LIMITS } from '../src/config/limits';

function url(query: string): URL {
  return new URL(`https://example.com/api/ciphers${query}`);
}

describe('parsePagination', () => {
  it('returns null when neither pageSize nor continuationToken is present', () => {
    expect(parsePagination(url(''))).toBeNull();
  });

  it('uses the default page size when only a continuation token is present', () => {
    const token = encodeContinuationToken(40);
    const result = parsePagination(url(`?continuationToken=${token}`));
    expect(result).toEqual({ limit: LIMITS.pagination.defaultPageSize, offset: 40 });
  });

  it('parses an explicit page size', () => {
    expect(parsePagination(url('?pageSize=25'))).toEqual({ limit: 25, offset: 0 });
  });

  it('clamps page size to the server maximum', () => {
    const result = parsePagination(url('?pageSize=100000'));
    expect(result).toEqual({ limit: LIMITS.pagination.maxPageSize, offset: 0 });
  });

  it('rejects non-positive or non-integer page sizes', () => {
    expect(parsePagination(url('?pageSize=0'))).toBeNull();
    expect(parsePagination(url('?pageSize=-5'))).toBeNull();
    expect(parsePagination(url('?pageSize=abc'))).toBeNull();
    expect(parsePagination(url('?pageSize=1.5'))).toBeNull();
  });

  it('combines page size and continuation token', () => {
    const token = encodeContinuationToken(200);
    expect(parsePagination(url(`?pageSize=50&continuationToken=${token}`))).toEqual({
      limit: 50,
      offset: 200,
    });
  });
});

describe('continuation token round-trip', () => {
  it('encodes then decodes back to the same offset', () => {
    for (const offset of [0, 1, 100, 999999]) {
      expect(decodeContinuationToken(encodeContinuationToken(offset))).toBe(offset);
    }
  });

  it('decodes null/empty/garbage tokens to 0', () => {
    expect(decodeContinuationToken(null)).toBe(0);
    expect(decodeContinuationToken('')).toBe(0);
    expect(decodeContinuationToken('not-base64-$$$')).toBe(0);
  });

  it('decodes negative or non-integer offsets to 0', () => {
    expect(decodeContinuationToken(encodeContinuationToken(-10))).toBe(0);
    expect(decodeContinuationToken(btoa('3.7'))).toBe(0);
    expect(decodeContinuationToken(btoa('abc'))).toBe(0);
  });
});
