import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { baseHeaders, url } from './helpers';

// The website-icon proxy fetches favicons from upstream services. Rather than
// mock its responses, we stand up a real in-memory upstream by swapping
// globalThis.fetch in this isolate (the same technique used for the WebDAV/S3
// backup tests) — the worker's own fetch hits it, so the proxy logic runs for
// real against controllable upstreams.

type UpstreamHandler = (u: URL) => Response;

// Per-test routing table for the two upstream hosts the proxy queries.
let routes: Record<string, UpstreamHandler>;
let originalFetch: typeof fetch;

const FAVICON_IM = 'favicon.im';
const BITWARDEN = 'icons.bitwarden.net';

function notFound(): Response {
  return new Response('nope', { status: 404 });
}

function pngResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
}

// A large body delivered as a stream so it carries no Content-Length header,
// forcing the proxy down the streaming size-guard path.
function streamingBody(totalBytes: number, contentType = 'image/png'): Response {
  const chunk = new Uint8Array(16 * 1024);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': contentType } });
}

function requestIcon(host: string, query = ''): Promise<Response> {
  return SELF.fetch(url(`/icons/${host}/icon.png${query}`), { headers: baseHeaders() });
}

beforeAll(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return originalFetch(input as any, init);
    }
    const handler = routes[parsed.host];
    if (handler) return handler(parsed);
    return originalFetch(input as any, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  routes = { [FAVICON_IM]: notFound, [BITWARDEN]: notFound };
});

describe('website icon proxy', () => {
  it('serves an image from the primary upstream', async () => {
    const img = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    routes[FAVICON_IM] = () => pngResponse(img);

    const res = await requestIcon('example.com');
    expect(res.status).toBe(200);
    expect((res.headers.get('Content-Type') || '').toLowerCase()).toContain('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(img);
  });

  it('falls back to the secondary upstream when the primary 404s', async () => {
    const img = new Uint8Array([10, 20, 30, 40, 50]);
    routes[BITWARDEN] = () => pngResponse(img);

    const res = await requestIcon('fallback.example');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(img);
  });

  it('skips a non-image upstream response', async () => {
    routes[FAVICON_IM] = () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    const img = new Uint8Array([7, 7, 7]);
    routes[BITWARDEN] = () => pngResponse(img);

    const res = await requestIcon('htmlfirst.example');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(img);
  });

  it('skips an upstream whose Content-Length exceeds the buffer cap', async () => {
    // 300 KB fixed body -> Content-Length > 256 KB cap -> rejected before read.
    routes[FAVICON_IM] = () => pngResponse(new Uint8Array(300 * 1024));
    const img = new Uint8Array([1, 1, 1, 1]);
    routes[BITWARDEN] = () => pngResponse(img);

    const res = await requestIcon('toolarge.example');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(img);
  });

  it('skips an upstream that streams more than the buffer cap (no Content-Length)', async () => {
    routes[FAVICON_IM] = () => streamingBody(300 * 1024);
    const img = new Uint8Array([2, 2]);
    routes[BITWARDEN] = () => pngResponse(img);

    const res = await requestIcon('streambig.example');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(img);
  });

  it('returns the built-in globe SVG when all upstreams fail (default fallback)', async () => {
    const res = await requestIcon('allfail.example');
    expect(res.status).toBe(200);
    expect((res.headers.get('Content-Type') || '').toLowerCase()).toContain('svg');
  });

  it('returns 404 when all upstreams fail and fallback=404 is requested', async () => {
    const res = await requestIcon('allfail.example', '?fallback=404');
    expect(res.status).toBe(404);
  });

  it('rejects an invalid host (encoded slash) with the 404 fallback', async () => {
    const res = await requestIcon('%2f', '?fallback=404');
    expect(res.status).toBe(404);
  });
});
