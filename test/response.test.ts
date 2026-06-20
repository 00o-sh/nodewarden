import { describe, expect, it } from 'vitest';
import {
  applyCors,
  errorResponse,
  handleCors,
  htmlResponse,
  identityErrorResponse,
  jsonResponse,
} from '../src/utils/response';

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe('jsonResponse', () => {
  it('serializes the body and sets the content type', async () => {
    const res = jsonResponse({ ok: true }, 201, { 'X-Test': '1' });
    expect(res.status).toBe(201);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('X-Test')).toBe('1');
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('errorResponse', () => {
  it('wraps a message in the Bitwarden error envelope', async () => {
    const res = errorResponse('Bad input', 422);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'Bad input',
      error_description: 'Bad input',
      ErrorModel: { Message: 'Bad input', Object: 'error' },
    });
  });

  it('defaults to status 400', () => {
    expect(errorResponse('x').status).toBe(400);
  });
});

describe('identityErrorResponse', () => {
  it('uses invalid_grant by default and includes the description', async () => {
    const res = identityErrorResponse('No good');
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_grant');
    expect(body.error_description).toBe('No good');
  });

  it('honors a custom error code and status', async () => {
    const res = identityErrorResponse('Slow down', 'invalid_request', 429);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('invalid_request');
  });
});

describe('htmlResponse', () => {
  it('sets an HTML content type', () => {
    const res = htmlResponse('<h1>hi</h1>');
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });
});

describe('handleCors', () => {
  it('answers preflight with 204 and allow headers', () => {
    const res = handleCors(request('https://example.com/api/sync'));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('reflects requested headers in Allow-Headers', () => {
    const res = handleCors(
      request('https://example.com/api/sync', {
        'Access-Control-Request-Headers': 'X-Custom-Thing',
      })
    );
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Custom-Thing');
  });
});

describe('applyCors', () => {
  it('always adds security headers', () => {
    const res = applyCors(request('https://example.com/api/sync'), jsonResponse({}));
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('reflects a same-origin Origin with credentials', () => {
    const req = request('https://example.com/api/sync', { Origin: 'https://example.com' });
    const res = applyCors(req, jsonResponse({}));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('reflects a browser extension origin with credentials', () => {
    const req = request('https://example.com/api/sync', { Origin: 'chrome-extension://abcdef' });
    const res = applyCors(req, jsonResponse({}));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abcdef');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('does not allow an unrelated cross-origin on a non-wildcard path', () => {
    const req = request('https://example.com/api/sync', { Origin: 'https://evil.example' });
    const res = applyCors(req, jsonResponse({}));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows a wildcard origin on public config paths', () => {
    const req = request('https://example.com/config', { Origin: 'https://anything.example' });
    const res = applyCors(req, jsonResponse({}));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('leaves websocket upgrade responses untouched', () => {
    // Workers attaches a `webSocket` property to upgrade responses; applyCors
    // must pass them through without copying (which would drop the socket).
    const original = new Response(null, { status: 200 });
    (original as Response & { webSocket?: unknown }).webSocket = {};
    const res = applyCors(request('https://example.com/'), original);
    expect(res).toBe(original);
    expect(res.headers.get('X-Frame-Options')).toBeNull();
  });

  it('preserves the original status and body', async () => {
    const res = applyCors(request('https://example.com/'), jsonResponse({ a: 1 }, 418));
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ a: 1 });
  });
});
