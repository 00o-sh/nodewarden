import { SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate, baseHeaders, url } from './helpers';

// Listing a remote WebDAV backup directory parses the PROPFIND XML, decoding
// HTML/XML entities in element text. This drives the real listWebDavEntries ->
// extractXmlFirst -> decodeXmlText path against an in-memory WebDAV server whose
// PROPFIND response carries entity-laden values. No mocks.
let session: Session;
let token: string;
let originalFetch: typeof fetch;

// One file entry under the configured remotePath whose getlastmodified value
// contains &lt; &gt; &quot; &#39; (and &amp;), forcing every entity branch.
const PROPFIND_XML = `<?xml version="1.0"?><multistatus xmlns="DAV:">` +
  `<response><href>/nodewarden/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>` +
  `<response><href>/nodewarden/backup_2025.zip</href><propstat><prop><resourcetype/>` +
  `<getcontentlength>1024</getcontentlength>` +
  `<getlastmodified>Wed &amp;&lt;&gt;&quot;&#39; 2025</getlastmodified>` +
  `</prop><status>HTTP/1.1 200 OK</status></propstat></response>` +
  `</multistatus>`;

beforeAll(async () => {
  session = await authenticate('webdavxml');
  token = session.accessToken;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    let host: string;
    try { host = new URL(raw).host; } catch { return originalFetch(input as any, init); }
    if (host !== 'dav.test') return originalFetch(input as any, init);
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'PROPFIND') return new Response(PROPFIND_XML, { status: 207 });
    if (method === 'MKCOL') return new Response(null, { status: 201 });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  await api('PUT', '/api/admin/backup/settings', token, {
    destinations: [{
      type: 'webdav', includeAttachments: false,
      destination: { baseUrl: 'https://dav.test', username: 'u', password: 'p', remotePath: 'nodewarden' },
      schedule: { enabled: false, intervalHours: 24, startTime: '03:00', timezone: 'UTC', retentionCount: 30 },
    }],
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('remote WebDAV listing decodes XML entities', () => {
  it('lists an entity-laden directory entry', async () => {
    const res = await SELF.fetch(url('/api/admin/backup/remote'), {
      method: 'GET',
      headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const names = (body.items || []).map((i: any) => i.name);
    expect(names).toContain('backup_2025.zip');
  });
});
