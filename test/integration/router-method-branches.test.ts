import { beforeAll, describe, expect, it } from 'vitest';
import { Session, api, authenticate } from './helpers';

// Method-dispatch branches of the authenticated router: unsupported methods on
// method-specific routes return 405, and routes that fall through (return null)
// surface as 404. Real authenticated requests, no mocks.
let session: Session;
let token: string;

beforeAll(async () => {
  session = await authenticate('routermethods');
  token = session.accessToken;
});

describe('authenticated router method handling', () => {
  it('405s unsupported methods on method-specific routes', async () => {
    const uuid = crypto.randomUUID();
    // Use non-POST methods for the auth-requests routes — POST /api/auth-requests
    // is the public create endpoint and never reaches the authenticated router.
    const cases: Array<[string, string]> = [
      ['DELETE', '/api/accounts/keys'],
      ['POST', '/api/two-factor'],
      ['DELETE', '/api/auth-requests'],
      ['DELETE', '/api/auth-requests/pending'],
      ['DELETE', `/api/auth-requests/${uuid}`],
    ];
    for (const [method, path] of cases) {
      const res = await api(method, path, token, method === 'POST' ? {} : undefined);
      expect(res.status, `${method} ${path}`).toBe(405);
    }
  });

  it('404s routes that fall through on an unsupported method', async () => {
    const cases: Array<[string, string]> = [
      ['DELETE', '/api/accounts/totp'],
      ['POST', '/notifications/anything'],
      ['DELETE', '/api/folders'],
      ['DELETE', '/api/collections'],
      ['DELETE', '/api/organizations'],
      ['DELETE', '/api/sends'],
      ['POST', '/api/policies'],
    ];
    for (const [method, path] of cases) {
      const res = await api(method, path, token, method === 'POST' ? {} : undefined);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});
