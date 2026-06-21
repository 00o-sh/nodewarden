import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';
import { addSearchIndexHeaders, isWorkerHandledPath, maybeServeAsset, normalizeRequestUrl } from '../../src/index';

// Worker-entry helpers: URL normalization, the worker-vs-asset path gate,
// search-index header injection, and static-asset serving. maybeServeAsset is
// driven with a real in-memory asset fetcher (a genuine Fetcher stand-in for the
// ASSETS binding, returning real responses) so the gating + header logic runs
// for real — the assertions are about our code, not a fabricated response.

const ORIGIN = 'https://vault.test';

function assetEnv(handler: (req: Request) => Response | Promise<Response>): Env {
  return { ASSETS: { fetch: (req: Request) => Promise.resolve(handler(req)) } } as unknown as Env;
}

describe('normalizeRequestUrl', () => {
  it('strips a trailing slash but preserves root and slash-free paths', () => {
    expect(new URL(normalizeRequestUrl(new Request(`${ORIGIN}/api/version/`)).url).pathname).toBe('/api/version');
    // Root is left as-is.
    expect(new URL(normalizeRequestUrl(new Request(`${ORIGIN}/`)).url).pathname).toBe('/');
    // No trailing slash -> same request object (no rebuild).
    const r = new Request(`${ORIGIN}/api/sync`);
    expect(normalizeRequestUrl(r)).toBe(r);
  });
});

describe('isWorkerHandledPath', () => {
  it('classifies worker-owned vs asset paths', () => {
    for (const p of ['/api/sync', '/identity/connect/token', '/icons/x/icon.png', '/notifications/hub', '/.well-known/x', '/config', '/api/config', '/api/version']) {
      expect(isWorkerHandledPath(p), p).toBe(true);
    }
    for (const p of ['/', '/index.html', '/robots.txt', '/assets/app.js']) {
      expect(isWorkerHandledPath(p), p).toBe(false);
    }
  });
});

describe('addSearchIndexHeaders', () => {
  it('adds noindex for html and robots.txt, leaves other responses alone', () => {
    const html = addSearchIndexHeaders(new Request(`${ORIGIN}/index.html`), new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }));
    expect(html.headers.get('X-Robots-Tag')).toContain('noindex');

    const robots = addSearchIndexHeaders(new Request(`${ORIGIN}/robots.txt`), new Response('User-agent: *', { headers: { 'Content-Type': 'text/plain' } }));
    expect(robots.headers.get('X-Robots-Tag')).toContain('noindex');

    const png = addSearchIndexHeaders(new Request(`${ORIGIN}/logo.png`), new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } }));
    expect(png.headers.get('X-Robots-Tag')).toBeNull();
  });
});

describe('maybeServeAsset', () => {
  it('returns null when no ASSETS binding is present', async () => {
    expect(await maybeServeAsset(new Request(`${ORIGIN}/index.html`), {} as Env)).toBeNull();
  });

  it('returns null for non-GET/HEAD methods and for worker-handled paths', async () => {
    const env = assetEnv(() => new Response('asset'));
    expect(await maybeServeAsset(new Request(`${ORIGIN}/index.html`, { method: 'POST' }), env)).toBeNull();
    expect(await maybeServeAsset(new Request(`${ORIGIN}/api/sync`), env)).toBeNull();
  });

  it('serves an asset (with noindex headers for html) for a non-worker GET path', async () => {
    const env = assetEnv(() => new Response('<html>home</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const res = await maybeServeAsset(new Request(`${ORIGIN}/`), env);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(await res!.text()).toBe('<html>home</html>');
  });

  it('serves a non-html asset unchanged (no noindex header)', async () => {
    const env = assetEnv(() => new Response('console.log(1)', { status: 200, headers: { 'Content-Type': 'application/javascript' } }));
    const res = await maybeServeAsset(new Request(`${ORIGIN}/assets/app.js`), env);
    expect(res!.status).toBe(200);
    expect(res!.headers.get('X-Robots-Tag')).toBeNull();
  });
});
