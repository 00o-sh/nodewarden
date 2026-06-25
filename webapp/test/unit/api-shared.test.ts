import { describe, expect, it } from 'vitest';
import {
  BULK_API_CHUNK_SIZE,
  chunkArray,
  createApiError,
  parseContentDispositionFileName,
  parseErrorMessage,
  parseJson,
} from '@/lib/api/shared';

describe('chunkArray', () => {
  it('returns a single chunk when under the limit', () => {
    expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('splits into fixed-size chunks', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('uses a 200-item default bulk chunk size', () => {
    expect(BULK_API_CHUNK_SIZE).toBe(200);
  });
});

describe('parseJson', () => {
  it('parses a JSON response body', async () => {
    const resp = new Response(JSON.stringify({ a: 1 }));
    expect(await parseJson<{ a: number }>(resp)).toEqual({ a: 1 });
  });

  it('returns null for an empty body', async () => {
    expect(await parseJson(new Response(''))).toBeNull();
  });

  it('returns null for invalid JSON instead of throwing', async () => {
    expect(await parseJson(new Response('not json'))).toBeNull();
  });
});

describe('parseContentDispositionFileName', () => {
  it('prefers the RFC 5987 filename* value', () => {
    const resp = new Response(null, {
      headers: { 'Content-Disposition': "attachment; filename*=UTF-8''my%20export.json" },
    });
    expect(parseContentDispositionFileName(resp, 'fallback.json')).toBe('my export.json');
  });

  it('falls back to a quoted plain filename', () => {
    const resp = new Response(null, {
      headers: { 'Content-Disposition': 'attachment; filename="export.csv"' },
    });
    expect(parseContentDispositionFileName(resp, 'fallback.csv')).toBe('export.csv');
  });

  it('uses the fallback when no header is present', () => {
    expect(parseContentDispositionFileName(new Response(null), 'fallback.json')).toBe('fallback.json');
  });
});

describe('createApiError', () => {
  it('attaches a status code to the error', () => {
    const error = createApiError('boom', 404);
    expect(error.message).toBe('boom');
    expect(error.status).toBe(404);
  });
});

describe('parseErrorMessage', () => {
  it('extracts a server error description', async () => {
    const resp = new Response(JSON.stringify({ error_description: 'Invalid credentials' }), {
      status: 400,
    });
    expect(await parseErrorMessage(resp, 'fallback')).toBe('Invalid credentials');
  });

  it('returns the fallback when no error field exists', async () => {
    expect(await parseErrorMessage(new Response('{}', { status: 500 }), 'fallback')).toBe('fallback');
  });
});
