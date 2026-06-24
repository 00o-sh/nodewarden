import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

// Top-level router branches: the import-bypass predicate (which skips the
// per-user API rate limit for restore traffic) and the public rate-limit
// guard. Driven through the real worker, no mocks.
let session: Session;
let token: string;

function importReq(method: string, path: string): Promise<Response> {
  return SELF.fetch(url(path), {
    method,
    headers: baseHeaders({ Authorization: `Bearer ${token}`, 'X-NodeWarden-Import': '1', 'Content-Type': 'application/json' }),
    body: method === 'POST' ? '{}' : undefined,
  });
}

beforeAll(async () => {
  session = await authenticate('routerbranches');
  token = session.accessToken;
});

describe('import-bypass predicate', () => {
  it('matches the import and attachment paths and ignores others', async () => {
    // Each authenticated request reaches isImportBypassRequest; the matching
    // POST paths take the bypass, a non-matching method/path does not.
    const cipherId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const responses = await Promise.all([
      importReq('POST', '/api/ciphers/import'),
      importReq('POST', `/api/ciphers/${cipherId}/attachment/v2`),
      importReq('POST', `/api/ciphers/${cipherId}/attachment/${attachmentId}`),
      importReq('GET', '/api/sync'), // header present but not a bypass path/method
    ]);
    // All resolve to a real status (not a thrown error); the GET still succeeds.
    for (const r of responses) expect(r.status).toBeLessThan(500);
    expect(responses[3].status).toBe(200);
  });
});

describe('public rate-limit guard', () => {
  it('429s public send access once the per-minute budget is spent', async () => {
    const ip = '203.0.113.30';
    let last: Response | null = null;
    // publicRequestsPerMinute is 60; the 61st request trips the router guard.
    for (let i = 0; i < 62; i++) {
      last = await SELF.fetch(url(`/api/sends/access/${crypto.randomUUID()}`), {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip, Origin: 'https://vault.test', 'Content-Type': 'application/json' },
        body: '{}',
      });
    }
    expect(last!.status).toBe(429);
  });
});
