import { describe, expect, it } from 'vitest';
import { Env } from '../src/types';
import {
  buildDirectUploadUrl,
  getSafeJwtSecret,
  parseDirectUploadPayload,
} from '../src/utils/direct-upload';

// Direct-upload helpers driven with real Request/File/FormData objects (no
// mocks): URL building, the JWT-secret safety gate, and the multipart vs
// raw-body upload parsing with its size/name validation branches.

describe('buildDirectUploadUrl', () => {
  it('builds an SAS-style URL preserving origin and encoding params', () => {
    const req = new Request('https://vault.test/api/ciphers/1/attachment/2');
    const url = buildDirectUploadUrl(req, '/api/ciphers/1/attachment/2', 'tok en/+');
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://vault.test');
    expect(parsed.pathname).toBe('/api/ciphers/1/attachment/2');
    expect(parsed.searchParams.get('token')).toBe('tok en/+');
    expect(parsed.searchParams.get('sv')).toBe('2023-11-03');
  });
});

describe('getSafeJwtSecret', () => {
  const env = (secret: unknown) => ({ JWT_SECRET: secret } as unknown as Env);

  it('returns null for empty, short, or the default dev secret', () => {
    expect(getSafeJwtSecret(env(''))).toBeNull();
    expect(getSafeJwtSecret(env('   '))).toBeNull();
    expect(getSafeJwtSecret(env('too-short'))).toBeNull();
    expect(getSafeJwtSecret(env('Enter-your-JWT-key-here-at-least-32-characters'))).toBeNull();
  });

  it('returns the trimmed secret when it is strong enough', () => {
    const strong = 'x'.repeat(48);
    expect(getSafeJwtSecret(env(`  ${strong}  `))).toBe(strong);
  });
});

const OPTS = {
  maxFileSize: 1024,
  tooLargeMessage: 'too big',
  sizeMismatchMessage: 'size mismatch',
  fileNameMismatchMessage: 'name mismatch',
};

function multipart(file: File | null): Request {
  const fd = new FormData();
  if (file) fd.set('data', file);
  return new Request('https://vault.test/upload', { method: 'POST', body: fd });
}

describe('parseDirectUploadPayload — multipart', () => {
  it('accepts a valid multipart upload', async () => {
    const file = new File([new Uint8Array(10)], 'a.bin', { type: 'application/octet-stream' });
    const result = await parseDirectUploadPayload(multipart(file), {
      ...OPTS,
      expectedSize: 10,
      expectedFileName: 'a.bin',
    });
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error('unexpected');
    expect(result.size).toBe(10);
    expect(result.contentType).toBe('application/octet-stream');
  });

  it('400s when no file part is present', async () => {
    const res = await parseDirectUploadPayload(multipart(null), OPTS);
    expect((res as Response).status).toBe(400);
  });

  it('413s when the file exceeds the max size', async () => {
    const file = new File([new Uint8Array(2048)], 'big.bin');
    const res = await parseDirectUploadPayload(multipart(file), OPTS);
    expect((res as Response).status).toBe(413);
  });

  it('400s on a file-name mismatch', async () => {
    const file = new File([new Uint8Array(4)], 'actual.bin');
    const res = await parseDirectUploadPayload(multipart(file), { ...OPTS, expectedFileName: 'wanted.bin' });
    expect((res as Response).status).toBe(400);
  });

  it('400s on a size mismatch', async () => {
    const file = new File([new Uint8Array(4)], 'a.bin');
    const res = await parseDirectUploadPayload(multipart(file), { ...OPTS, expectedSize: 99 });
    expect((res as Response).status).toBe(400);
  });
});

function raw(body: BodyInit | null, headers: Record<string, string>): Request {
  return new Request('https://vault.test/upload', { method: 'POST', body, headers });
}

describe('parseDirectUploadPayload — raw body', () => {
  it('accepts a raw upload with a content-length', async () => {
    const result = await parseDirectUploadPayload(
      raw('hello', { 'content-length': '5', 'content-type': 'text/plain' }),
      OPTS
    );
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error('unexpected');
    expect(result.size).toBe(5);
    expect(result.contentType).toBe('text/plain');
  });

  it('falls back to expectedSize and octet-stream when no content-length/type is given', async () => {
    // A byte body carries no auto content-type, so the octet-stream fallback applies.
    const result = await parseDirectUploadPayload(raw(new Uint8Array(5), {}), { ...OPTS, expectedSize: 5 });
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error('unexpected');
    expect(result.size).toBe(5);
    expect(result.contentType).toBe('application/octet-stream');
  });

  it('400s with no body', async () => {
    const res = await parseDirectUploadPayload(raw(null, {}), OPTS);
    expect((res as Response).status).toBe(400);
  });

  it('400s when neither content-length nor expectedSize resolves a size', async () => {
    const res = await parseDirectUploadPayload(raw('hello', {}), OPTS);
    expect((res as Response).status).toBe(400);
  });

  it('413s when the declared size exceeds the max', async () => {
    const res = await parseDirectUploadPayload(raw('x', { 'content-length': '99999' }), OPTS);
    expect((res as Response).status).toBe(413);
  });

  it('400s when the declared size does not match expectedSize', async () => {
    const res = await parseDirectUploadPayload(
      raw('hello', { 'content-length': '5' }),
      { ...OPTS, expectedSize: 6 }
    );
    expect((res as Response).status).toBe(400);
  });
});
