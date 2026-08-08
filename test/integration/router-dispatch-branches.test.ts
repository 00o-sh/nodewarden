import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { handleRequest } from '../../src/router';
import { baseHeaders, url } from './helpers';

beforeAll(async () => {
  // The worker entry wrapper runs the D1 migrations on its first invocation;
  // direct handleRequest() calls bypass that, so prime the schema via SELF once
  // (mirrors push-relay.test.ts) before the allow-listed routes touch storage.
  await SELF.fetch(url('/config'), { headers: baseHeaders() });
});

// Top-level router branches not reached by the guard/flow suites: the
// JWT-secret misconfiguration gate (500 for protected paths, allow-list bypass
// for a handful of GET paths) and the streaming body-size cap (no Content-Length
// -> the router drains the stream itself). The REAL router runs against an env
// whose JWT_SECRET genuinely has each value, and against real streamed bodies —
// no mocks.
// Override only JWT_SECRET while forwarding every real binding (DB, R2, DOs) so
// the allow-listed routes that touch storage still work end-to-end.
const withSecret = (secret: string) =>
  new Proxy(env as any, {
    get(target, prop) {
      return prop === 'JWT_SECRET' ? secret : (target as any)[prop];
    },
  }) as any;

function streamRequest(path: string, method: string, byteLength: number): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(byteLength));
      controller.close();
    },
  });
  return new Request(url(path), {
    method,
    headers: baseHeaders(),
    body: stream,
    // Required to send a streaming request body in the Workers runtime.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('JWT secret misconfiguration gate', () => {
  it('500s a protected route when the JWT secret is missing', async () => {
    const res = await handleRequest(new Request(url('/api/sync'), { headers: baseHeaders() }), withSecret(''));
    expect(res.status).toBe(500);
  });

  it('500s a protected route when the JWT secret is too short', async () => {
    const res = await handleRequest(new Request(url('/api/sync'), { headers: baseHeaders() }), withSecret('short'));
    expect(res.status).toBe(500);
  });

  it('still serves the allow-listed /config route with an unsafe JWT secret', async () => {
    const res = await handleRequest(new Request(url('/config'), { headers: baseHeaders() }), withSecret(''));
    expect(res.status).toBe(200);
    expect((await res.json() as any).object).toBe('config');
  });

  it('still serves the allow-listed /api/web-bootstrap route with an unsafe JWT secret', async () => {
    const res = await handleRequest(new Request(url('/api/web-bootstrap'), { headers: baseHeaders() }), withSecret(''));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // The bootstrap payload reports the very misconfiguration that let it through.
    expect(body.jwtUnsafeReason).toBe('missing');
  });
});

describe('streaming request body cap (no Content-Length)', () => {
  it('413s a streamed body that exceeds the cap', async () => {
    const res = await handleRequest(streamRequest('/api/web-bootstrap', 'POST', 26 * 1024 * 1024), env as any);
    expect(res.status).toBe(413);
  });

  it('passes a small streamed body through the cap to routing (401, not 413)', async () => {
    // A tiny streamed POST body is drained, reconstructed, and forwarded. With no
    // Authorization header it falls through to the 401, proving it cleared the cap.
    const res = await handleRequest(streamRequest('/api/sync', 'POST', 16), env as any);
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(401);
  });
});

describe('public route dispatch', () => {
  it('serves the chrome devtools well-known probe as empty JSON', async () => {
    const res = await SELF.fetch(url('/.well-known/appspecific/com.chrome.devtools.json'), {
      headers: baseHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('serves the plain server version string', async () => {
    const res = await SELF.fetch(url('/api/version'), { headers: baseHeaders() });
    expect(res.status).toBe(200);
    expect(typeof (await res.json())).toBe('string');
  });

  it('exposes the icon-service template in the config payload', async () => {
    const res = await SELF.fetch(url('/config'), { headers: baseHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body._icon_service_url).toContain('/icons/{}/icon.png');
    expect(body._icon_service_csp).toContain('img-src');
  });
});
