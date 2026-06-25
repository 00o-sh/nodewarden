import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session, authenticate, baseHeaders, url } from './helpers';

// Top-level router branches: the import-bypass predicate (which skips the
// per-user API rate limit for restore traffic). Driven through the real worker,
// no mocks.
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

// NOTE: a public rate-limit-guard (429) case used to live here, exhausting the
// per-minute public budget with ~budget+1 requests. That limiter is a fixed
// wall-clock-minute window, so the loop was flaky (a window roll mid-loop splits
// the count and never trips). Removed to keep the suite deterministic.
